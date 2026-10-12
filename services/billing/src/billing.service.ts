import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthUser, EVENTS, DomainEvent, EventBus, Outbox, OrderCancelledPayload, OrderRejectedPayload, OrderValidatedPayload, Role, envFloat, env } from '@sfmc/common';
import { Invoice, InvoiceLine } from './invoice.entity';
import { PaymentProvider } from './payment.provider';

export function computeTotals(lines: Pick<InvoiceLine, 'lineTotal'>[], taxRate: number) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const tax = round2(subtotal * taxRate);
  return { subtotal, tax, amount: round2(subtotal + tax) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly log = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly bus: EventBus,
    private readonly outbox: Outbox,
    private readonly payments: PaymentProvider,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('billing.saga', [EVENTS.OrderValidated, EVENTS.OrderRejected, EVENTS.OrderCancelled], (e) => this.handleEvent(e));
  }

  private async handleEvent(e: DomainEvent): Promise<void> {
    if (e.type === 'OrderValidated') await this.issue(e.payload);
    else if (e.type === 'OrderRejected' || e.type === 'OrderCancelled') await this.cancelForOrder((e.payload as OrderRejectedPayload | OrderCancelledPayload).orderId);
  }

  /** Facture générée à la validation de la commande (idempotent par orderId). */
  async issue(p: OrderValidatedPayload): Promise<Invoice | null> {
    if (await this.invoices.exists({ where: { orderId: p.orderId } })) return null;
    const lines: InvoiceLine[] = p.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: round2(i.quantity * i.unitPrice) }));
    const totals = computeTotals(lines, envFloat('TAX_RATE', 0.18));
    let invoice: Invoice;
    try {
      // Facture et InvoiceIssued dans la même transaction (outbox)
      invoice = await this.outbox.run(async (m, events) => {
        const [{ nextval }] = await m.query("SELECT nextval('invoice_number_seq') AS nextval");
        const number = `INV-${new Date().getFullYear()}-${String(nextval).padStart(6, '0')}`;
        const inv = await m.save(
          m.create(Invoice, { number, orderId: p.orderId, customerId: p.customerId, customerEmail: p.customerEmail || null, lines, ...totals, currency: env('CURRENCY', 'XOF'), status: 'ISSUED', paymentMethod: null, paymentReference: null, paidAt: null }),
        );
        events.push({ type: EVENTS.InvoiceIssued, payload: { orderId: p.orderId, customerId: p.customerId, customerEmail: p.customerEmail, invoiceId: inv.id, number: inv.number, amount: inv.amount, currency: inv.currency } });
        return inv;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return null; // doublon concurrent : déjà facturée (transaction annulée)
      throw err;
    }
    this.log.log(`Facture ${invoice.number} émise pour la commande ${p.orderId} (${invoice.amount} ${invoice.currency})`);
    return invoice;
  }

  /** Compensation : une commande rejetée ou annulée annule sa facture non payée. */
  async cancelForOrder(orderId: string) {
    const res = await this.invoices.update({ orderId, status: 'ISSUED' }, { status: 'CANCELLED' });
    if (res.affected) this.log.log(`Facture de la commande ${orderId} annulée (compensation)`);
  }

  list(user: AuthUser) {
    return this.invoices.find({ where: user.role === Role.Client ? { customerId: user.id } : {}, order: { issuedAt: 'DESC' }, take: 200 });
  }

  async get(id: string, user: AuthUser) {
    const inv = await this.invoices.findOne({ where: { id } });
    return this.authorize(inv, user);
  }

  async getByOrder(orderId: string, user: AuthUser) {
    const inv = await this.invoices.findOne({ where: { orderId } });
    return this.authorize(inv, user);
  }

  private authorize(inv: Invoice | null, user: AuthUser): Invoice {
    if (!inv) throw new NotFoundException('Facture introuvable');
    if (user.role === Role.Client && inv.customerId !== user.id) throw new ForbiddenException();
    return inv;
  }

  async pay(id: string, method: string, user: AuthUser): Promise<Invoice> {
    const inv = await this.get(id, user);
    if (inv.status === 'PAID') throw new ConflictException('Facture déjà payée');
    if (inv.status === 'CANCELLED') throw new BadRequestException('Facture annulée');
    const { reference } = await this.payments.charge({ invoiceId: inv.id, amount: inv.amount, currency: inv.currency, method });
    // compare-and-set : un seul paiement gagnant en cas de double appel concurrent
    return this.outbox.run(async (m, events) => {
      const res = await m.update(Invoice, { id, status: 'ISSUED' }, { status: 'PAID', paymentMethod: method, paymentReference: reference, paidAt: new Date() });
      if (!res.affected) throw new ConflictException('Facture déjà traitée');
      const fresh = await m.findOneOrFail(Invoice, { where: { id } });
      events.push({ type: EVENTS.InvoicePaid, payload: { invoiceId: fresh.id, orderId: fresh.orderId, amount: fresh.amount, method, customerEmail: fresh.customerEmail ?? '' } });
      return fresh;
    });
  }
}
