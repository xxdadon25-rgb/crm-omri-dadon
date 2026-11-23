import { customerPosition } from "./invoiceBalance.js";

/**
 * Single source of truth for the agent collection screen:
 * the existing QuickStock invoiceBalance rules. No new payment or debt formula.
 * Inputs must already be server-authorized (RLS), and complete/paginated.
 * Payments are entered ONLY by the manager; this function is read-only.
 */
export function agentCollectionPosition(customer, invoices, payments, creditNotes) {
  if (!customer?.id) return null;
  const mine = rows => (rows ?? []).filter(row => row?.customer_id === customer.id);
  const ownedInvoices = mine(invoices);
  const invoiceIds = new Set(ownedInvoices.map(i => i.id));
  // Keep only entries attached to a visible invoice, so a stray unlinked
  // receipt cannot inflate paid amounts or hide an open debt.
  const paymentRows = mine(payments).filter(p => invoiceIds.has(p.invoice_id));
  const creditRows = mine(creditNotes).filter(c => invoiceIds.has(c.invoice_id));
  return {
    customer,
    invoiceCount: ownedInvoices.length,
    paymentCount: paymentRows.length,
    ...customerPosition(ownedInvoices, creditRows, paymentRows),
  };
}

export function rankCollections(customers, invoices, payments, creditNotes) {
  if (!Array.isArray(customers)) return [];
  return customers
    .map(c => agentCollectionPosition(c, invoices, payments, creditNotes))
    .filter(Boolean)
    .sort((a,b) => b.debtAg - a.debtAg || a.customer.name.localeCompare(b.customer.name,"he"));
}
