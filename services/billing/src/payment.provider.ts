import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ChargeRequest {
  invoiceId: string;
  amount: number;
  currency: string;
  method: string;
}

export interface ChargeResult {
  reference: string;
}

/** Fournisseur de paiement (Mobile Money, carte...). À brancher via le token PAYMENT_PROVIDER. */
export abstract class PaymentProvider {
  abstract charge(req: ChargeRequest): Promise<ChargeResult>;
}

/** Fournisseur factice : accepte tout paiement. */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return { reference: `MOCK-${req.method}-${randomUUID().slice(0, 8).toUpperCase()}` };
  }
}
