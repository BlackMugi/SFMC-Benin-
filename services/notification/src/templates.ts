import { EventEnvelope } from '@sfmc/common';

export interface Rendered {
  recipient: 'customer' | 'ops';
  subject: string;
  body: string;
}

const fmt = (n: number, currency = 'XOF') => `${new Intl.NumberFormat('fr-FR').format(n)} ${currency}`;
const short = (id: string) => id.slice(0, 8);

/** Transforme un événement en message (français). Retourne null pour les événements sans notification. */
export function render(e: EventEnvelope<any>): Rendered | null {
  const p = e.payload;
  switch (e.type) {
    case 'OrderCreated':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} reçue`, body: `Nous avons bien reçu votre commande ${short(p.orderId)} d'un montant de ${fmt(p.total)}. Nous vérifions le stock.` };
    case 'StockInsufficient':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} : production en cours`, body: `Le stock est insuffisant pour votre commande ${short(p.orderId)}. Une production a été lancée, nous vous tiendrons informé.` };
    case 'ProductionCompleted':
      return p.orderId
        ? { recipient: 'customer', subject: `Commande ${short(p.orderId)} : production terminée`, body: `La fabrication de ${p.quantity} × ${p.productName} est terminée.` }
        : { recipient: 'ops', subject: `Production terminée : ${p.productName}`, body: `Ordre ${short(p.workOrderId)} terminé (${p.quantity} unités).` };
    case 'ProductionFailed':
      return { recipient: 'ops', subject: `Échec de production`, body: `Commande ${p.orderId ? short(p.orderId) : '-'} : ${p.reason}` };
    case 'StockLow':
      return { recipient: 'ops', subject: `ALERTE seuil critique`, body: `Produit ${short(p.productId)} (entrepôt ${short(p.warehouseId)}) : ${p.available} disponible(s) pour un seuil de ${p.threshold}. Réapprovisionnement ou production à prévoir.` };
    case 'OrderValidated':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} validée`, body: `Votre commande ${short(p.orderId)} est validée. Montant HT : ${fmt(p.total)}.` };
    case 'InvoiceIssued':
      return { recipient: 'customer', subject: `Facture ${p.number}`, body: `Votre facture ${p.number} est disponible : ${fmt(p.amount, p.currency)} TTC.` };
    case 'InvoicePaid':
      return { recipient: 'customer', subject: `Paiement reçu`, body: `Nous avons reçu votre paiement de ${fmt(p.amount)} (${p.method}). Merci.` };
    case 'OrderShipped':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} expédiée`, body: `Votre commande ${short(p.orderId)} a été expédiée.` };
    case 'OrderRejected':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} refusée`, body: `Nous ne pouvons pas honorer votre commande : ${p.reason}` };
    case 'OrderCancelled':
      return { recipient: 'customer', subject: `Commande ${short(p.orderId)} annulée`, body: `Votre commande ${short(p.orderId)} est annulée.` };
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
