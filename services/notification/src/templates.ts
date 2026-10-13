import { DomainEvent } from '@sfmc/common';

export interface Rendered {
  recipient: 'customer' | 'ops';
  subject: string;
  body: string;
}

const fmt = (n: number, currency = 'XOF') => `${new Intl.NumberFormat('fr-FR').format(n)} ${currency}`;
const short = (id: string) => id.slice(0, 8);

/** Transforme un événement en message. Null pour les événements sans notification. */
export function render(e: DomainEvent): Rendered | null {
  switch (e.type) {
    case 'OrderCreated':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} reçue`, body: `Nous avons bien reçu votre commande ${short(e.payload.orderId)} d'un montant de ${fmt(e.payload.total)}. Nous vérifions le stock.` };
    case 'StockInsufficient':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} : production en cours`, body: `Le stock est insuffisant pour votre commande ${short(e.payload.orderId)}. Une production a été lancée, nous vous tiendrons informé.` };
    case 'ProductionCompleted':
      return e.payload.orderId
        ? { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} : production terminée`, body: `La fabrication de ${e.payload.quantity} × ${e.payload.productName} est terminée.` }
        : { recipient: 'ops', subject: `Production terminée : ${e.payload.productName}`, body: `Ordre ${short(e.payload.workOrderId)} terminé (${e.payload.quantity} unités).` };
    case 'ProductionFailed':
      return { recipient: 'ops', subject: `Échec de production`, body: `Commande ${e.payload.orderId ? short(e.payload.orderId) : '-'} : ${e.payload.reason}` };
    case 'StockLow':
      return { recipient: 'ops', subject: `ALERTE seuil critique`, body: `Produit ${short(e.payload.productId)} (entrepôt ${short(e.payload.warehouseId)}) : ${e.payload.available} disponible(s) pour un seuil de ${e.payload.threshold}. Réapprovisionnement ou production à prévoir.` };
    case 'OrderValidated':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} validée`, body: `Votre commande ${short(e.payload.orderId)} est validée. Montant HT : ${fmt(e.payload.total)}.` };
    case 'InvoiceIssued':
      return { recipient: 'customer', subject: `Facture ${e.payload.number}`, body: `Votre facture ${e.payload.number} est disponible : ${fmt(e.payload.amount, e.payload.currency)} TTC.` };
    case 'InvoicePaid':
      return { recipient: 'customer', subject: `Paiement reçu`, body: `Nous avons reçu votre paiement de ${fmt(e.payload.amount)} (${e.payload.method}). Merci.` };
    case 'OrderShipped':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} expédiée`, body: `Votre commande ${short(e.payload.orderId)} a été expédiée.` };
    case 'OrderRejected':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} refusée`, body: `Nous ne pouvons pas honorer votre commande : ${e.payload.reason}` };
    case 'OrderCancelled':
      return { recipient: 'customer', subject: `Commande ${short(e.payload.orderId)} annulée`, body: `Votre commande ${short(e.payload.orderId)} est annulée.` };
    default:
      return null;
  }
}

export const NOTIFIED_EVENTS = [
  'OrderCreated',
  'StockInsufficient',
  'ProductionCompleted',
  'ProductionFailed',
  'StockLow',
  'OrderValidated',
  'InvoiceIssued',
  'InvoicePaid',
  'OrderShipped',
  'OrderRejected',
  'OrderCancelled',
] as const;
