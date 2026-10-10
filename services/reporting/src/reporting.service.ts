import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EVENTS, EventBus, EventEnvelope, EventType } from '@sfmc/common';
import { EventLog, ProductionStat, SaleLine, StockSnapshot } from './entities';
import { applyStockUpdated, orderIdOf, saleLinesFrom } from './projections';

@Injectable()
export class ReportingService implements OnModuleInit {
  private readonly log = new Logger(ReportingService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(EventLog) private readonly events: Repository<EventLog>,
    @InjectRepository(SaleLine) private readonly sales: Repository<SaleLine>,
    @InjectRepository(StockSnapshot) private readonly stocks: Repository<StockSnapshot>,
    @InjectRepository(ProductionStat) private readonly production: Repository<ProductionStat>,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('reporting.projections', Object.keys(EVENTS) as EventType[], (e) => this.project(e));
  }

  // ------------------------------------------------------------------ Projections (événement -> vue de lecture)

  async project(e: EventEnvelope<any>): Promise<void> {
    await this.ds.transaction(async (m) => {
      // Journal : l'unicité de eventId rend toute la projection idempotente (rejeu = rien ne se passe).
      if (await m.exists(EventLog, { where: { eventId: e.id } })) return;
      await m.insert(EventLog, { eventId: e.id, orderId: orderIdOf(e), type: e.type, source: e.source, payload: e.payload, correlationId: e.correlationId, at: new Date(e.occurredAt) });

      switch (e.type) {
        case 'OrderValidated':
          await m.createQueryBuilder().insert().into(SaleLine).values(saleLinesFrom(e)).orIgnore().execute();
          break;
        case 'OrderCancelled':
        case 'OrderRejected':
          await m.delete(SaleLine, { orderId: e.payload.orderId }); // vente annulée : retirée du chiffre d'affaires
          break;
        case 'StockUpdated': {
          const prev = await m.findOne(StockSnapshot, { where: { productId: e.payload.productId, warehouseId: e.payload.warehouseId } });
          await m.save(StockSnapshot, { productId: e.payload.productId, warehouseId: e.payload.warehouseId, ...applyStockUpdated(prev ?? undefined, e.payload) });
          break;
        }
        case 'StockLow': {
          const prev = await m.findOne(StockSnapshot, { where: { productId: e.payload.productId, warehouseId: e.payload.warehouseId } });
          await m.save(StockSnapshot, { productId: e.payload.productId, warehouseId: e.payload.warehouseId, quantity: prev?.quantity ?? 0, reserved: prev?.reserved ?? 0, low: true, lowThreshold: e.payload.threshold });
          break;
        }
        case 'ProductionCompleted':
          await m.save(ProductionStat, { workOrderId: e.payload.workOrderId, orderId: e.payload.orderId ?? null, productId: e.payload.productId, productName: e.payload.productName, quantity: e.payload.quantity });
          break;
      }
    });
  }

  // ------------------------------------------------------------------ Vues de lecture

  async salesReport(from?: string, to?: string) {
    const range = (qb: ReturnType<Repository<SaleLine>['createQueryBuilder']>) => {
      if (from) qb.andWhere('s.day >= :from', { from });
      if (to) qb.andWhere('s.day <= :to', { to });
      return qb;
    };
    const [totals, byProduct, byDay] = await Promise.all([
      range(this.sales.createQueryBuilder('s').select('COALESCE(SUM(s.amount),0)', 'revenue').addSelect('COUNT(DISTINCT s.order_id)', 'orders').addSelect('COALESCE(SUM(s.quantity),0)', 'units')).getRawOne(),
      range(this.sales.createQueryBuilder('s').select('s.product_id', 'productId').addSelect('MAX(s.product_name)', 'productName').addSelect('SUM(s.quantity)', 'units').addSelect('SUM(s.amount)', 'revenue').groupBy('s.product_id').orderBy('revenue', 'DESC')).getRawMany(),
      range(this.sales.createQueryBuilder('s').select("TO_CHAR(s.day, 'YYYY-MM-DD')", 'day').addSelect('SUM(s.amount)', 'revenue').addSelect('COUNT(DISTINCT s.order_id)', 'orders').groupBy('s.day').orderBy('s.day', 'ASC')).getRawMany(),
    ]);
    return {
      revenue: Number(totals.revenue),
      orders: Number(totals.orders),
      units: Number(totals.units),
      byProduct: byProduct.map((r) => ({ ...r, units: Number(r.units), revenue: Number(r.revenue) })),
      byDay: byDay.map((r) => ({ ...r, orders: Number(r.orders), revenue: Number(r.revenue) })),
    };
  }

  async stockReport() {
    const rows = await this.stocks.find({ order: { productId: 'ASC' } });
    return { items: rows.map((r) => ({ ...r, available: r.quantity - r.reserved })), lowStockCount: rows.filter((r) => r.low).length };
  }

  async productionReport() {
    const [byProduct, totals, requested] = await Promise.all([
      this.production.createQueryBuilder('p').select('p.product_id', 'productId').addSelect('MAX(p.product_name)', 'productName').addSelect('SUM(p.quantity)', 'units').addSelect('COUNT(*)', 'workOrders').groupBy('p.product_id').getRawMany(),
      this.production.createQueryBuilder('p').select('COALESCE(SUM(p.quantity),0)', 'units').addSelect('COUNT(*)', 'workOrders').getRawOne(),
      this.events.count({ where: { type: 'ProductionRequested' } }),
    ]);
    const failed = await this.events.count({ where: { type: 'ProductionFailed' } });
    return {
      requested,
      completed: Number(totals.workOrders),
      failed,
      unitsProduced: Number(totals.units),
      byProduct: byProduct.map((r) => ({ ...r, units: Number(r.units), workOrders: Number(r.workOrders) })),
    };
  }

  async summary() {
    const [sales, stock, production] = await Promise.all([this.salesReport(), this.stockReport(), this.productionReport()]);
    const byType = await this.events.createQueryBuilder('e').select('e.type', 'type').addSelect('COUNT(*)', 'count').groupBy('e.type').getRawMany();
    return { sales: { revenue: sales.revenue, orders: sales.orders, units: sales.units }, stock: { references: stock.items.length, lowStockCount: stock.lowStockCount }, production: { requested: production.requested, completed: production.completed, unitsProduced: production.unitsProduced }, events: Object.fromEntries(byType.map((r) => [r.type, Number(r.count)])) };
  }

  orderTimeline(orderId: string) {
    return this.events.find({ where: { orderId }, order: { at: 'ASC' }, select: ['type', 'source', 'at', 'correlationId', 'payload'] });
  }

  recentEvents(type?: string, limit = 100) {
    return this.events.find({ where: type ? { type } : {}, order: { at: 'DESC' }, take: Math.min(Math.max(limit, 1), 500) });
  }
}
