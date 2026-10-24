/** Supplier comparison packaging rules. No inventory side effects. */
export const SALE_LEVELS = ["unit", "pack", "carton"];
export function validPositive(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
}
export function baseUnitsForSale({ units_per_pack, packs_per_carton, sale_level }) {
  if (sale_level === "unit") return 1;
  const units = validPositive(units_per_pack);
  if (!units) return null;
  if (sale_level === "pack") return units;
  if (sale_level === "carton") {
    const packs = validPositive(packs_per_carton);
    return packs ? units * packs : null;
  }
  return null;
}
export function saleLevelLabel(level) {
  return ({ unit: "יחידה בודדת", pack: "חבילה", carton: "קרטון" })[level] || "לא נקבע";
}
