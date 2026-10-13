import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  EVENTS,
  EventBus,
  Outbox,
  DomainEvent,
  EventType,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderRejectedPayload,
  OrderShippedPayload,
  ProductionCompletedPayload,
  env,
  envInt,
} from '@sfmc/common';
import { Allocation as AllocationT, allocate, available, criticalThreshold, mergeItems } from './allocation';
import { Reservation, Stock, StockMovement, Warehouse } from './entities';
import { CreateWarehouseDto, MovementDto, TransferDto } from './inventory.dto';

interface Pending {
  type: EventType;
  payload: unknown;
}

type AllocationOutcome =
  | { kind: 'reserved'; allocations: AllocationT[] }
  | { kind: 'insufficient'; shortages: { productId: string; requested: number; available: number; missing: number }[] }
  | { kind: 'ignored' };

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly log = new Logger(InventoryService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Warehouse) private readonly warehouses: Repository<Warehouse>,
    @InjectRepository(Stock) private readonly stocks: Repository<Stock>,
    @InjectRepository(StockMovement) private readonly movements: Repository<StockMovement>,
    private readonly bus: EventBus,
    private readonly outbox: Outbox,
  ) {}

  async onModuleInit() {
    if ((await this.warehouses.count()) === 0) {
      await this.warehouses.save([
        this.warehouses.create({ code: env('DEFAULT_WAREHOUSE_CODE', 'COTONOU'), name: 'Entrepôt principal', location: 'Cotonou' }),
        this.warehouses.create({ code: 'PARAKOU', name: 'Entrepôt Nord', location: 'Parakou' }),
      ]);
      this.log.log('Entrepôts par défaut créés');
    }
    await this.bus.subscribe(
      'inventory.saga',
      [EVENTS.OrderCreated, EVENTS.ProductionCompleted, EVENTS.OrderRejected, EVENTS.OrderCancelled, EVENTS.OrderShipped],
      (e) => this.handleEvent(e),
    );
  }

  // Saga (chorégraphie)

  private async handleEvent(e: DomainEvent): Promise<void> {
    switch (e.type) {
      case 'OrderCreated':
        return this.onOrderCreated(e.payload);
      case 'ProductionCompleted':
        return this.onProductionCompleted(e.payload);
      case 'OrderRejected':
      case 'OrderCancelled':
        return this.release((e.payload as OrderRejectedPayload | OrderCancelledPayload).orderId);
      case 'OrderShipped':
        return this.onOrderShipped(e.payload);
    }
  }

  /** Réserve atomiquement tous les articles de la commande. */
  private async onOrderCreated(p: OrderCreatedPayload) {
    const items = mergeItems(p.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
    await this.outbox.run(async (m, pending) => {
      await m.createQueryBuilder().insert().into(Reservation).values({ orderId: p.orderId, items, status: 'PENDING', allocations: [] }).orIgnore().execute();
      const res = await m.findOneOrFail(Reservation, { where: { orderId: p.orderId }, lock: { mode: 'pessimistic_write' } });
      let outcome: AllocationOutcome;
      if (res.status === 'RESERVED') outcome = { kind: 'reserved', allocations: res.allocations }; // rejeu : ré-émet StockReserved
      else if (res.status !== 'PENDING') outcome = { kind: 'ignored' };
      else outcome = await this.attemptAllocation(m, res, pending);
      if (outcome.kind === 'reserved') pending.push({ type: EVENTS.StockReserved, payload: { orderId: p.orderId, allocations: outcome.allocations } });
      else if (outcome.kind === 'insufficient') pending.push({ type: EVENTS.StockInsufficient, payload: { orderId: p.orderId, shortages: outcome.shortages } });
    });
  }

  /** Production terminée : entrée de stock, puis nouvelle tentative de réservation. */
  private async onProductionCompleted(p: ProductionCompletedPayload) {
    await this.outbox.run(async (m, pending) => {
      const reference = `wo:${p.workOrderId}`;
      if (await m.exists(StockMovement, { where: { reference } })) return; // idempotence
      const wh = await m.findOneOrFail(Warehouse, { where: { code: env('DEFAULT_WAREHOUSE_CODE', 'COTONOU') } });
      const stock = await this.lockStock(m, p.productId, wh.id);
      await this.applyMovement(m, stock, 'IN', p.quantity, 'PRODUCTION', pending, { orderId: p.orderId ?? null, reference });
      if (!p.orderId) return;
      const res = await m.findOne(Reservation, { where: { orderId: p.orderId }, lock: { mode: 'pessimistic_write' } });
      if (res?.status !== 'PENDING') return;
      const outcome = await this.attemptAllocation(m, res, pending);
      if (outcome.kind === 'reserved') pending.push({ type: EVENTS.StockReserved, payload: { orderId: p.orderId, allocations: outcome.allocations } });
    });
  }

  /** Compensation : libère la réservation d'une commande rejetée ou annulée. */
  async release(orderId: string) {
    await this.outbox.run(async (m, pending) => {
      await m.createQueryBuilder().insert().into(Reservation).values({ orderId, items: [], status: 'PENDING', allocations: [] }).orIgnore().execute();
      const res = await m.findOneOrFail(Reservation, { where: { orderId }, lock: { mode: 'pessimistic_write' } });
      if (res.status === 'RELEASED' || res.status === 'CONSUMED') return;
      if (res.status === 'RESERVED') {
        for (const a of [...res.allocations].sort((x, y) => x.productId.localeCompare(y.productId))) {
          const stock = await this.lockStock(m, a.productId, a.warehouseId);
          stock.reserved = Math.max(0, stock.reserved - a.quantity);
          await m.save(stock);
          await this.checkThreshold(m, stock, pending);
        }
      }
      res.status = 'RELEASED';
      await m.save(res);
      pending.push({ type: EVENTS.StockReleased, payload: { orderId } });
    });
  }

  /** Expédition : la réservation devient une sortie de stock (vente). */
  private async onOrderShipped(p: OrderShippedPayload) {
    await this.outbox.run(async (m, pending) => {
      const res = await m.findOne(Reservation, { where: { orderId: p.orderId }, lock: { mode: 'pessimistic_write' } });
      if (res?.status !== 'RESERVED') return;
      for (const a of [...res.allocations].sort((x, y) => x.productId.localeCompare(y.productId))) {
        const stock = await this.lockStock(m, a.productId, a.warehouseId);
        stock.reserved = Math.max(0, stock.reserved - a.quantity);
        stock.quantity -= a.quantity;
        await m.save(stock);
        await m.save(m.create(StockMovement, { stockId: stock.id, productId: a.productId, warehouseId: a.warehouseId, type: 'OUT', quantity: a.quantity, reason: 'SALE', orderId: p.orderId, reference: `ship:${p.orderId}` }));
        pending.push({ type: EVENTS.StockUpdated, payload: { productId: a.productId, warehouseId: a.warehouseId, quantity: stock.quantity, reserved: stock.reserved, movementType: 'OUT', delta: -a.quantity, reason: 'SALE', orderId: p.orderId } });
        await this.checkThreshold(m, stock, pending);
      }
      res.status = 'CONSUMED';
      await m.save(res);
    });
  }

  // Allocation, mouvements, seuil critique

  private async attemptAllocation(m: EntityManager, res: Reservation, pending: Pending[]): Promise<AllocationOutcome> {
    const ids = [...new Set(res.items.map((i) => i.productId))];
    // Verrous pris dans un ordre fixe (produit, id) pour éviter les interblocages.
    const stocks = await m.find(Stock, { where: { productId: In(ids) }, lock: { mode: 'pessimistic_write' }, order: { productId: 'ASC', id: 'ASC' } });
    const { allocations, shortages } = allocate(stocks, res.items);
    if (shortages.length) return { kind: 'insufficient', shortages };
    const touched = new Map<string, Stock>();
    for (const a of allocations) {
      const stock = stocks.find((s) => s.productId === a.productId && s.warehouseId === a.warehouseId)!;
      stock.reserved += a.quantity;
      touched.set(stock.id, stock);
    }
    for (const s of touched.values()) {
      await m.save(s);
      await this.checkThreshold(m, s, pending);
    }
    res.allocations = allocations;
    res.status = 'RESERVED';
    await m.save(res);
    return { kind: 'reserved', allocations };
  }

  private async lockStock(m: EntityManager, productId: string, warehouseId: string): Promise<Stock> {
    await m.createQueryBuilder().insert().into(Stock).values({ productId, warehouseId }).orIgnore().execute();
    return m.findOneOrFail(Stock, { where: { productId, warehouseId }, lock: { mode: 'pessimistic_write' } });
  }

  private async applyMovement(
    m: EntityManager,
    stock: Stock,
    type: 'IN' | 'OUT',
    quantity: number,
    reason: string,
    pending: Pending[],
    extra: { orderId?: string | null; reference?: string | null } = {},
  ) {
    if (type === 'OUT' && quantity > available(stock)) throw new BadRequestException(`Stock disponible insuffisant (${available(stock)} disponible, ${quantity} demandé)`);
    stock.quantity += type === 'IN' ? quantity : -quantity;
    await m.save(stock);
    await m.save(m.create(StockMovement, { stockId: stock.id, productId: stock.productId, warehouseId: stock.warehouseId, type, quantity, reason, orderId: extra.orderId ?? null, reference: extra.reference ?? null }));
    pending.push({
      type: EVENTS.StockUpdated,
      payload: { productId: stock.productId, warehouseId: stock.warehouseId, quantity: stock.quantity, reserved: stock.reserved, movementType: type, delta: type === 'IN' ? quantity : -quantity, reason, orderId: extra.orderId ?? undefined },
    });
    await this.checkThreshold(m, stock, pending);
  }

  /**
   * Seuil critique : max(seuil configuré, sortie moyenne par jour sur 7 j x délai de réappro).
   * StockLow n'est émis qu'une fois par franchissement, ré-armé quand le stock remonte.
   */
  private async checkThreshold(m: EntityManager, stock: Stock, pending: Pending[]) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const row = await m
      .createQueryBuilder(StockMovement, 'mv')
      .select('COALESCE(SUM(mv.quantity), 0)', 'sum')
      .where('mv.stock_id = :id AND mv.type = :type AND mv.date >= :since', { id: stock.id, type: 'OUT', since })
      .getRawOne<{ sum: string }>();
    const threshold = criticalThreshold(stock.minThreshold, Number(row?.sum ?? 0) / 7, envInt('LEAD_TIME_DAYS', 2));
    const avail = available(stock);
    if (avail <= threshold && !stock.alertActive) {
      stock.alertActive = true;
      await m.save(stock);
      pending.push({ type: EVENTS.StockLow, payload: { productId: stock.productId, warehouseId: stock.warehouseId, available: avail, threshold } });
    } else if (avail > threshold && stock.alertActive) {
      stock.alertActive = false;
      await m.save(stock);
    }
  }

  // API

  async move(dto: MovementDto) {
    const stock = await this.outbox.run(async (m, pending) => {
      await this.assertWarehouse(m, dto.warehouseId);
      const s = await this.lockStock(m, dto.productId, dto.warehouseId);
      await this.applyMovement(m, s, dto.type, dto.quantity, dto.reason, pending);
      return s;
    });
    return stock;
  }

  async transfer(dto: TransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Entrepôts source et destination identiques');
    await this.outbox.run(async (m, pending) => {
      await this.assertWarehouse(m, dto.fromWarehouseId);
      await this.assertWarehouse(m, dto.toWarehouseId);
      const [firstId, secondId] = [dto.fromWarehouseId, dto.toWarehouseId].sort();
      const first = await this.lockStock(m, dto.productId, firstId);
      const second = await this.lockStock(m, dto.productId, secondId);
      const [from, to] = first.warehouseId === dto.fromWarehouseId ? [first, second] : [second, first];
      await this.applyMovement(m, from, 'OUT', dto.quantity, 'TRANSFER', pending);
      await this.applyMovement(m, to, 'IN', dto.quantity, 'TRANSFER', pending);
    });
    return { status: 'ok' };
  }

  private async assertWarehouse(m: EntityManager, id: string) {
    if (!(await m.exists(Warehouse, { where: { id } }))) throw new NotFoundException('Entrepôt introuvable');
  }

  listWarehouses() {
    return this.warehouses.find({ order: { code: 'ASC' } });
  }

  async createWarehouse(dto: CreateWarehouseDto) {
    if (await this.warehouses.exists({ where: { code: dto.code } })) throw new BadRequestException('Code entrepôt déjà utilisé');
    return this.warehouses.save(this.warehouses.create({ code: dto.code, name: dto.name, location: dto.location ?? null }));
  }

  listStocks(productId?: string, warehouseId?: string) {
    return this.stocks.find({ where: { ...(productId && { productId }), ...(warehouseId && { warehouseId }) }, order: { productId: 'ASC' } }).then((rows) => rows.map((s) => ({ ...s, available: available(s) })));
  }

  listAlerts() {
    return this.stocks.find({ where: { alertActive: true } }).then((rows) => rows.map((s) => ({ ...s, available: available(s) })));
  }

  listMovements(productId?: string, warehouseId?: string, limit = 100) {
    return this.movements.find({
      where: { ...(productId && { productId }), ...(warehouseId && { warehouseId }) },
      order: { date: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async setThreshold(stockId: string, minThreshold: number) {
    const stock = await this.stocks.findOne({ where: { id: stockId } });
    if (!stock) throw new NotFoundException('Stock introuvable');
    stock.minThreshold = minThreshold;
    return this.stocks.save(stock);
  }

  /** Disponibilité agrégée, tous entrepôts (appelée en REST par Order). */
  async checkAvailability(items: { productId: string; quantity: number }[]) {
    const merged = mergeItems(items);
    const rows = await this.stocks
      .createQueryBuilder('s')
      .select('s.product_id', 'productId')
      .addSelect('COALESCE(SUM(s.quantity - s.reserved), 0)', 'available')
      .where('s.product_id IN (:...ids)', { ids: merged.map((i) => i.productId) })
      .groupBy('s.product_id')
      .getRawMany<{ productId: string; available: string }>();
    const lines = merged.map((i) => {
      const avail = Math.max(0, Number(rows.find((r) => r.productId === i.productId)?.available ?? 0));
      return { productId: i.productId, requested: i.quantity, available: avail, missing: Math.max(0, i.quantity - avail) };
    });
    return { available: lines.every((l) => l.missing === 0), lines };
  }

  async availabilityOf(productId: string) {
    const r = await this.checkAvailability([{ productId, quantity: 1 }]);
    return { productId, available: r.lines[0].available };
  }
}
