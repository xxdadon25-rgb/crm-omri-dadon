/**
 * Agent order form has no client-side approval or cost override.
 * It prepares only the same-unit source fields used by QuickStock; the
 * server RPC independently checks products, pricing, margin, and membership.
 */
export const agentMoney = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
};

export function buildAgentLine({ product, quantity, unitPrice, discount = 0 }) {
  const q = Number(quantity);
  const price = Number(unitPrice);
  const d = Number(discount);
  if (!product?.id || !Number.isFinite(q) || q <= 0 || q > 1000000
      || !Number.isFinite(price) || price < 0 || price > 100000000
      || !Number.isFinite(d) || d < 0 || d > 100) return null;
  // packagingMath rounds the quoted unit_price to whole agorot before
  // extending a discounted line; compute exactly as that function does.
  const total = Math.round(Math.round(price * 100) * q * (1 - d / 100)) / 100;
  if (total <= 0) return null;
  return {
    product_id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    quantity: q,
    unit_price: price,
    discount: d,
    total,
    price_basis: "catalog_same_sold_unit_v1",
    sale_level: "unit",
    buy_level: "unit",
  };
}

export const agentOrderSignature = (customerId, items) =>
  JSON.stringify({ customerId, items });
