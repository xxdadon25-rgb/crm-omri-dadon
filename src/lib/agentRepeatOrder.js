import { buildAgentLine, agentProductCanBeOrdered } from "./agentOrderForm.js";

/**
 * Make a REVIEWABLE repeat-order draft from a visible historic order.
 * Never reuse historical purchase costs or trust historical stock/pack metadata.
 * The existing server margin/order RPCs independently recheck every line.
 * Fail as a whole rather than silently omitting blocked/unknown products.
 */
export function repeatAgentOrderDraft(order, availableProducts) {
  if (!Array.isArray(order?.items) || !order.items.length) {
    return { items: null, reason: "missing_order_items" };
  }
  const catalog = new Map((availableProducts ?? []).map(p => [p.id,p]));
  const draft = [];
  for (const old of order.items) {
    const product = catalog.get(old?.product_id);
    if (!agentProductCanBeOrdered(product)) return {items:null,reason:"unavailable_product"};
    if (old.sale_level_review === true ||
        (old.sale_level && old.buy_level && old.sale_level !== old.buy_level) ||
        (old.price_basis && old.price_basis !== "catalog_same_sold_unit_v1")) {
      return {items:null,reason:"unverified_packaging"};
    }
    const line = buildAgentLine({
      product,quantity:old.quantity,unitPrice:old.unit_price,
      discount:old.discount ?? 0,
    });
    if (!line || !Number.isFinite(Number(old.total)) ||
        Math.abs(line.total - Number(old.total)) > 0.01) {
      return {items:null,reason:"changed_line_amount"};
    }
    draft.push(line);
  }
  return {items:draft,reason:null};
}
