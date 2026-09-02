import { supabase } from "@/api/supabaseClient";

// All revach-plus admin traffic goes through the QuickStock 'revach-proxy' Edge Function,
// which holds the revach-plus URL + admin key as server-side secrets. The browser never
// sees the key. Both failure channels are normalized: invoke()'s own error, and a
// { ok: false, error } body from the proxy.
async function callProxy(body) {
  const { data, error } = await supabase.functions.invoke("revach-proxy", { body });
  if (error) throw new Error(error.message || "שגיאה בקריאה לשרת רווח פלוס");
  if (!data?.ok) throw new Error(data?.error || "שגיאה מהשרת");
  return data;
}

export const listCustomers = () => callProxy({ action: "list_customers" });
export const approveCustomer = (business_id) => callProxy({ action: "approve", business_id });
export const blockCustomer = (business_id) => callProxy({ action: "block", business_id });
export const cancelCustomer = (business_id) => callProxy({ action: "cancel", business_id });
export const deleteCustomer = (business_id) => callProxy({ action: "delete_customer", business_id });
// Removes a single support message from the "הודעות תמיכה" panel. The customer
// it came from is untouched.
export const deleteSupportMessage = (id) => callProxy({ action: "delete_support_message", id });
// Attaches a Grow standing order to a business after the admin has confirmed
// the match in Grow. The business is always chosen by a human — the system
// never infers it from the amount or the payer's details.
export const bindRecurringContract = (charge_id, business_id) =>
  callProxy({ action: "bind_recurring_contract", charge_id, business_id });
