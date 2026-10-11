import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  AuthUser,
  EVENTS,
  EventBus,
  EventEnvelope,
  Outbox,
  OrderLine,
  ProductCategory,
  Role,
  ServiceClient,
  StockInsufficientPayload,
  ProductionFailedPayload,
  ProductionCompletedPayload,
  InvoiceIssuedPayload,
} from '@sfmc/common';
import { Order, OrderHistory, OrderPhase, OrderStatus } from './entities';
import { sourcesFor } from './order-state';
import { CreateOrderDto } from './order.dto';

interface ProductDto {
  id: string;
  name: string;
  category: ProductCategory;
  unitPrice: number;
  active: boolean;
}

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly log = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderHistory) private readonly history: Repository<OrderHistory>,
    private readonly bus: EventBus,
    private readonly outbox: Outbox,
    private readonly services: ServiceClient,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe(
      'order.saga',
      [EVENTS.StockReserved, EVENTS.StockInsufficient, EVENTS.ProductionCompleted, EVENTS.ProductionFailed, EVENTS.InvoiceIssued],
      (e) => this.handleEvent(e),
    );
  }

  // ------------------------------------------------------------------ API

  async create(user: AuthUser, dto: CreateOrderDto): Promise<Order> {
    // Fusion des lignes d'un même produit
    const wanted = new Map<string, number>();
    for (const i of dto.items) wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.quantity);

    // REST synchrone vers Product : existence + prix au moment de la commande
    const items: OrderLine[] = [];
    for (const [productId, quantity] of wanted) {
      const p = await this.services.get<ProductDto>('product-service', `/products/${productId}`).catch((e) => {
        if (e?.getStatus?.() === 404) throw new BadRequestException(`Produit inconnu : ${productId}`);
        throw new ServiceUnavailableException('Catalogue indisponible, réessayez');
      });
      if (!p.active) throw new BadRequestException(`Produit indisponible à la vente : ${p.name}`);
      items.push({ productId, productName: p.name, category: p.category, quantity, unitPrice: p.unitPrice });
    }

    // REST synchrone vers Inventory : vérification immédiate (indicative, la réservation fait foi)
    let stockCheck: unknown = null;
    try {
      stockCheck = await this.services.post('inventory-service', '/inventory/availability', { items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) });
    } catch (e) {
      this.log.warn(`Vérification de stock indisponible, la saga tranchera : ${(e as Error).message}`);
    }

    const total = Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
    // Commande, historique et OrderCreated écrits dans la même transaction (outbox) : la saga démarre forcément,
    // même si RabbitMQ est momentanément indisponible.
    return this.outbox.run(async (m, events) => {
      const order = await m.save(
        m.create(Order, {
          customerId: user.id,
          customerEmail: user.email ?? null,
          status: 'pending',
          phase: 'awaiting_stock',
          items,
          total,
          urgency: dto.urgency ?? 3,
          requiredBy: dto.requiredBy ? new Date(dto.requiredBy) : null,
          stockCheck,
          rejectionReason: null,
          invoiceId: null,
        }),
      );
      await this.note(m, order.id, 'pending', 'Commande créée');
      events.push({ type: EVENTS.OrderCreated, payload: { ...this.ref(order), items, total, urgency: order.urgency, requiredBy: order.requiredBy?.toISOString() } });
      return order;
    });
  }

  list(user: AuthUser, status?: OrderStatus) {
    const where: Record<string, unknown> = {};
    if (user.role === Role.Client) where.customerId = user.id;
    if (status) where.status = status;
    return this.orders.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async get(id: string, user: AuthUser): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (user.role === Role.Client && order.customerId !== user.id) throw new ForbiddenException();
    return order;
  }

  async timeline(id: string, user: AuthUser) {
    await this.get(id, user);
    return this.history.find({ where: { orderId: id }, order: { at: 'ASC' } });
  }

  async cancel(id: string, user: AuthUser, reason = 'Annulée par le client'): Promise<Order> {
    const order = await this.get(id, user);
    return this.outbox.run(async (m, events) => {
      const moved = await this.transition(m, id, 'cancelled', { phase: 'closed', rejectionReason: reason });
      if (!moved) throw new BadRequestException(`Annulation impossible depuis le statut « ${order.status} »`);
      await this.note(m, id, 'cancelled', reason);
      const fresh = await m.findOneOrFail(Order, { where: { id } });
      events.push({ type: EVENTS.OrderCancelled, payload: { ...this.ref(fresh), reason } });
      return fresh;
    });
  }

  async ship(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    return this.outbox.run(async (m, events) => {
      const moved = await this.transition(m, id, 'shipped', { phase: 'shipped' });
      if (!moved) throw new BadRequestException(`Expédition impossible depuis le statut « ${order.status} » (commande validée requise)`);
      await this.note(m, id, 'shipped', 'Commande expédiée');
      const fresh = await m.findOneOrFail(Order, { where: { id } });
      events.push({ type: EVENTS.OrderShipped, payload: { ...this.ref(fresh), items: fresh.items } });
      return fresh;
    });
  }

  // ------------------------------------------------------------------ Saga (chorégraphie)

  async handleEvent(e: EventEnvelope<any>): Promise<void> {
    switch (e.type) {
      case 'StockReserved':
        return this.onStockReserved(e.payload.orderId);
      case 'StockInsufficient':
        return this.onStockInsufficient(e.payload);
      case 'ProductionCompleted':
        return this.onProductionCompleted(e.payload);
      case 'ProductionFailed':
        return this.onProductionFailed(e.payload);
      case 'InvoiceIssued':
        return this.onInvoiceIssued(e.payload);
    }
  }

  /** Stock réservé -> commande validée (fin heureuse de la saga). */
  async onStockReserved(orderId: string) {
    await this.outbox.run(async (m, events) => {
      const order = await m.findOne(Order, { where: { id: orderId } });
      if (!order) return;
      if (order.status === 'cancelled' || order.status === 'rejected') {
        // Compensation tardive : la réservation est arrivée après l'annulation -> on redemande la libération (idempotente).
        const type = order.status === 'cancelled' ? EVENTS.OrderCancelled : EVENTS.OrderRejected;
        events.push({ type, payload: { ...this.ref(order), reason: order.rejectionReason ?? 'Commande clôturée' } });
        return;
      }
      if (!(await this.transition(m, orderId, 'validated', { phase: 'validated' }))) return; // déjà validée (rejeu)
      await this.note(m, orderId, 'validated', 'Stock réservé, commande validée');
      const fresh = await m.findOneOrFail(Order, { where: { id: orderId } });
      events.push({ type: EVENTS.OrderValidated, payload: { ...this.ref(fresh), items: fresh.items, total: fresh.total } });
    });
  }

  /** Stock insuffisant -> déclenche la production des quantités manquantes. */
  async onStockInsufficient(p: StockInsufficientPayload) {
    await this.outbox.run(async (m, events) => {
      const order = await m.findOne(Order, { where: { id: p.orderId } });
      if (!order || order.status !== 'pending') return;
      const res = await m.update(Order, { id: order.id, phase: 'awaiting_stock' }, { phase: 'awaiting_production' });
      if (!res.affected) return; // rejeu
      await this.note(m, order.id, 'pending', `Stock insuffisant (${p.shortages.map((s) => `${s.missing} manquant(s)`).join(', ')}) : production demandée`);
      for (const s of p.shortages) {
        const line = order.items.find((i) => i.productId === s.productId);
        if (!line) continue;
        events.push({
          type: EVENTS.ProductionRequested,
          payload: {
            orderId: order.id,
            productId: line.productId,
            productName: line.productName,
            category: line.category,
            quantity: s.missing,
            urgency: order.urgency,
            requiredBy: order.requiredBy?.toISOString(),
          },
        });
      }
    });
  }

  async onProductionCompleted(p: ProductionCompletedPayload) {
    if (!p.orderId) return;
    const orderId = p.orderId;
    await this.outbox.run(async (m) => {
      await m.update(Order, { id: orderId, status: 'pending' }, { phase: 'production_completed' });
      await this.note(m, orderId, 'pending', `Production terminée : ${p.quantity} × ${p.productName}`);
    });
  }

  /** Échec de production -> la commande est rejetée ; Inventory libère la réservation (compensation). */
  async onProductionFailed(p: ProductionFailedPayload) {
    if (!p.orderId) return;
    const reason = `Production impossible : ${p.reason}`;
    const orderId = p.orderId;
    await this.outbox.run(async (m, events) => {
      if (!(await this.transition(m, orderId, 'rejected', { phase: 'closed', rejectionReason: reason }))) return;
      await this.note(m, orderId, 'rejected', reason);
      const order = await m.findOneOrFail(Order, { where: { id: orderId } });
      events.push({ type: EVENTS.OrderRejected, payload: { ...this.ref(order), reason } });
    });
  }

  async onInvoiceIssued(p: InvoiceIssuedPayload) {
    await this.outbox.run(async (m) => {
      await m.update(Order, { id: p.orderId }, { invoiceId: p.invoiceId });
      await this.note(m, p.orderId, 'validated', `Facture ${p.number} émise`);
    });
  }

  // ------------------------------------------------------------------ Helpers

  /** Transition atomique (compare-and-set sur le statut source) : sûre en cas de rejeu ou de concurrence. */
  private async transition(m: EntityManager, id: string, to: OrderStatus, patch: { phase: OrderPhase; rejectionReason?: string }): Promise<boolean> {
    const res = await m.update(Order, { id, status: In(sourcesFor(to)) }, { status: to, ...patch });
    return !!res.affected;
  }

  private note(m: EntityManager, orderId: string, status: string, note: string) {
    return m.save(m.create(OrderHistory, { orderId, status, note }));
  }

  private ref(o: Order) {
    return { orderId: o.id, customerId: o.customerId, customerEmail: o.customerEmail ?? '' };
  }
}
