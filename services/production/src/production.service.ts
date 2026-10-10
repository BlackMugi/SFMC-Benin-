import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject, defer, filter, from, map, merge, concat, interval } from 'rxjs';
import { In, Repository } from 'typeorm';
import { EVENTS, EventBus, EventEnvelope, ProductCategory, ProductionRequestedPayload, envBool, envInt } from '@sfmc/common';
import { Machine, WorkOrder } from './entities';
import { PlanEntry, buildPlan, durationMs, priorityScore } from './planning';

export interface ProgressEvent {
  workOrderId: string;
  orderId: string | null;
  productName: string;
  quantity: number;
  status: string;
  progress: number;
  machine: string | null;
  at: string;
}

export interface SseMessage {
  type: string;
  data: unknown;
}

@Injectable()
export class ProductionService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(ProductionService.name);
  private readonly progress$ = new Subject<ProgressEvent>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @InjectRepository(Machine) private readonly machines: Repository<Machine>,
    @InjectRepository(WorkOrder) private readonly workOrders: Repository<WorkOrder>,
    private readonly bus: EventBus,
  ) {}

  private get speed() {
    return envInt('PRODUCTION_SPEED_FACTOR', 120);
  }
  private get minSeconds() {
    return envInt('PRODUCTION_MIN_SECONDS', 6);
  }
  private get maxQty() {
    return envInt('MAX_WORK_ORDER_QTY', 100_000);
  }

  async onModuleInit() {
    if ((await this.machines.count()) === 0 && envBool('SEED_DEMO_DATA', true)) {
      await this.machines.save(
        [
          ['Four cimenterie A', 'cement', 10],
          ['Four cimenterie B', 'cement', 8],
          ['Laminoir HA', 'iron', 6],
          ['Presse à briques', 'brick', 120],
          ['Concasseur granulats', 'aggregate', 5],
        ].map(([name, category, ratePerMinute]) => this.machines.create({ name: name as string, category: category as ProductCategory, ratePerMinute: ratePerMinute as number, status: 'IDLE' })),
      );
      this.log.log('Machines de démonstration créées');
    }
    // Reprise après redémarrage : les machines "BUSY" sans ordre en cours redeviennent libres.
    await this.releaseOrphanMachines();
    await this.bus.subscribe('production.requests', [EVENTS.ProductionRequested], (e: EventEnvelope<ProductionRequestedPayload>) => this.onProductionRequested(e.payload));
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ Événements

  async onProductionRequested(p: ProductionRequestedPayload) {
    const reason = await this.rejectionReason(p.category, p.quantity);
    if (reason) {
      await this.bus.publish(EVENTS.ProductionFailed, { orderId: p.orderId, productId: p.productId, reason });
      return;
    }
    if (await this.workOrders.exists({ where: { orderId: p.orderId, productId: p.productId } })) return; // rejeu
    const wo = await this.createWorkOrder({ orderId: p.orderId, productId: p.productId, productName: p.productName, category: p.category, quantity: p.quantity, urgency: p.urgency, requiredBy: p.requiredBy ? new Date(p.requiredBy) : null });
    this.log.log(`Ordre de fabrication ${wo.id} créé (${p.quantity} × ${p.productName}, urgence ${p.urgency})`);
  }

  private async rejectionReason(category: ProductCategory, quantity: number): Promise<string | null> {
    if (quantity > this.maxQty) return `quantité ${quantity} supérieure à la capacité maximale d'un ordre (${this.maxQty})`;
    const capable = await this.machines.count({ where: { category, status: In(['IDLE', 'BUSY']) } });
    return capable ? null : `aucune machine disponible pour la catégorie « ${category} »`;
  }

  // ------------------------------------------------------------------ API

  async createWorkOrder(d: { orderId: string | null; productId: string; productName: string; category: ProductCategory; quantity: number; urgency: number; requiredBy: Date | null }) {
    const now = new Date();
    return this.workOrders.save(
      this.workOrders.create({ ...d, status: 'QUEUED', progress: 0, machineId: null, priorityScore: priorityScore({ urgency: d.urgency, createdAt: now, requiredBy: d.requiredBy }, now) }),
    );
  }

  async createManual(d: { productId: string; productName: string; category: ProductCategory; quantity: number; urgency: number; requiredBy?: string }) {
    const reason = await this.rejectionReason(d.category, d.quantity);
    if (reason) throw new BadRequestException(reason);
    return this.createWorkOrder({ ...d, orderId: null, requiredBy: d.requiredBy ? new Date(d.requiredBy) : null });
  }

  listMachines() {
    return this.machines.find({ order: { category: 'ASC', name: 'ASC' } });
  }

  createMachine(d: { name: string; category: ProductCategory; ratePerMinute: number }) {
    return this.machines.save(this.machines.create({ ...d, status: 'IDLE' }));
  }

  async setMachineStatus(id: string, status: 'IDLE' | 'MAINTENANCE') {
    const m = await this.machines.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Machine introuvable');
    if (m.status === 'BUSY') throw new BadRequestException('Machine occupée : attendre la fin de l\'ordre en cours');
    m.status = status;
    return this.machines.save(m);
  }

  listWorkOrders(status?: string, orderId?: string) {
    return this.workOrders.find({ where: { ...(status && { status: status as WorkOrder['status'] }), ...(orderId && { orderId }) }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async getWorkOrder(id: string) {
    const wo = await this.workOrders.findOne({ where: { id } });
    if (!wo) throw new NotFoundException('Ordre de fabrication introuvable');
    return wo;
  }

  async setUrgency(id: string, urgency: number) {
    const wo = await this.getWorkOrder(id);
    if (wo.status !== 'QUEUED') throw new BadRequestException('Seul un ordre en attente peut être repriorisé');
    wo.urgency = urgency;
    wo.priorityScore = priorityScore(wo);
    return this.workOrders.save(wo);
  }

  /** Planning prévisionnel : ordre de passage, machine et créneau estimés pour chaque ordre en attente. */
  async plan(): Promise<(PlanEntry & { productName: string; quantity: number; urgency: number; category: string })[]> {
    const [queued, machines, running] = await Promise.all([
      this.workOrders.find({ where: { status: 'QUEUED' } }),
      this.machines.find(),
      this.workOrders.find({ where: { status: 'IN_PROGRESS' } }),
    ]);
    const now = new Date();
    const busyUntil = new Map(running.filter((r) => r.machineId && r.startedAt && r.durationMs).map((r) => [r.machineId!, new Date(r.startedAt!.getTime() + r.durationMs!)]));
    const out: (PlanEntry & { productName: string; quantity: number; urgency: number; category: string })[] = [];
    for (const category of new Set(queued.map((q) => q.category))) {
      const group = queued.filter((q) => q.category === category);
      const ms = machines.filter((m) => m.category === category).map((m) => ({ id: m.id, ratePerMinute: m.ratePerMinute, status: m.status, busyUntil: busyUntil.get(m.id) }));
      for (const entry of buildPlan(group, ms, now, this.speed, this.minSeconds)) {
        const wo = group.find((g) => g.id === entry.workOrderId)!;
        out.push({ ...entry, productName: wo.productName, quantity: wo.quantity, urgency: wo.urgency, category });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Flux SSE : instantané des ordres en cours, puis progression en temps réel + heartbeat. */
  stream(workOrderId?: string): Observable<SseMessage> {
    const snapshot = defer(() => from(this.workOrders.find({ where: { status: In(['QUEUED', 'IN_PROGRESS']) } }))).pipe(
      map((rows) => rows.filter((r) => !workOrderId || r.id === workOrderId)),
      map((rows) => ({ type: 'snapshot', data: rows.map((r) => this.toEvent(r, null)) })),
    );
    const live = this.progress$.pipe(
      filter((e) => !workOrderId || e.workOrderId === workOrderId),
      map((e) => ({ type: e.status === 'COMPLETED' ? 'completed' : 'progress', data: e })),
    );
    const heartbeat = interval(15_000).pipe(map(() => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })));
    return concat(snapshot, merge(live, heartbeat));
  }

  // ------------------------------------------------------------------ Planificateur (1 s)

  /**
   * Chaque tick : (1) affecte les ordres en attente aux machines libres selon la priorité,
   * (2) fait avancer les ordres en cours, (3) termine ceux qui ont atteint 100 %.
   * Toutes les transitions sont des compare-and-set SQL : plusieurs instances peuvent tourner sans doublon.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.assign();
      await this.advance();
    } catch (e) {
      this.log.error(`Erreur du planificateur : ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async assign() {
    const idle = await this.machines.find({ where: { status: 'IDLE' } });
    for (const machine of idle) {
      const queued = await this.workOrders.find({ where: { status: 'QUEUED', category: machine.category } });
      if (!queued.length) continue;
      const now = new Date();
      const best = queued.map((q) => ({ q, score: priorityScore(q, now) })).sort((a, b) => b.score - a.score || a.q.createdAt.getTime() - b.q.createdAt.getTime())[0];
      // 1) réserver la machine, 2) réserver l'ordre ; sinon annuler (une autre instance a gagné)
      const claimedMachine = await this.machines.update({ id: machine.id, status: 'IDLE' }, { status: 'BUSY' });
      if (!claimedMachine.affected) continue;
      const dur = durationMs(best.q.quantity, machine.ratePerMinute, this.speed, this.minSeconds);
      const claimedWo = await this.workOrders.update(
        { id: best.q.id, status: 'QUEUED' },
        { status: 'IN_PROGRESS', machineId: machine.id, startedAt: now, durationMs: dur, priorityScore: best.score, progress: 0 },
      );
      if (!claimedWo.affected) {
        await this.machines.update({ id: machine.id }, { status: 'IDLE' });
        continue;
      }
      this.log.log(`Ordre ${best.q.id} démarré sur « ${machine.name} » (priorité ${best.score.toFixed(1)}, durée ${dur} ms)`);
      this.progress$.next(this.toEvent({ ...best.q, status: 'IN_PROGRESS', progress: 0 } as WorkOrder, machine.name));
    }
  }

  private async advance() {
    const running = await this.workOrders.find({ where: { status: 'IN_PROGRESS' } });
    if (!running.length) return;
    const machines = new Map((await this.machines.find()).map((m) => [m.id, m]));
    const now = Date.now();
    for (const wo of running) {
      const started = wo.startedAt?.getTime() ?? now;
      const pct = Math.min(100, Math.round(((now - started) / (wo.durationMs ?? 1)) * 1000) / 10);
      const machine = wo.machineId ? machines.get(wo.machineId) : undefined;
      if (pct < 100) {
        await this.workOrders.update({ id: wo.id, status: 'IN_PROGRESS' }, { progress: pct });
        this.progress$.next(this.toEvent({ ...wo, progress: pct }, machine?.name ?? null));
        continue;
      }
      const done = await this.workOrders.update({ id: wo.id, status: 'IN_PROGRESS' }, { status: 'COMPLETED', progress: 100, completedAt: new Date() });
      if (!done.affected) continue; // terminé par une autre instance
      if (wo.machineId) await this.machines.update({ id: wo.machineId }, { status: 'IDLE' });
      this.progress$.next(this.toEvent({ ...wo, status: 'COMPLETED', progress: 100 }, machine?.name ?? null));
      await this.bus.publish(EVENTS.ProductionCompleted, { workOrderId: wo.id, orderId: wo.orderId ?? undefined, productId: wo.productId, productName: wo.productName, quantity: wo.quantity, machineId: wo.machineId ?? '' });
      this.log.log(`Ordre ${wo.id} terminé (${wo.quantity} × ${wo.productName})`);
    }
  }

  private async releaseOrphanMachines() {
    const busy = await this.machines.find({ where: { status: 'BUSY' } });
    const running = new Set((await this.workOrders.find({ where: { status: 'IN_PROGRESS' } })).map((w) => w.machineId));
    for (const m of busy) if (!running.has(m.id)) await this.machines.update({ id: m.id }, { status: 'IDLE' });
  }

  private toEvent(wo: WorkOrder, machine: string | null): ProgressEvent {
    return { workOrderId: wo.id, orderId: wo.orderId, productName: wo.productName, quantity: wo.quantity, status: wo.status, progress: wo.progress, machine, at: new Date().toISOString() };
  }
}
