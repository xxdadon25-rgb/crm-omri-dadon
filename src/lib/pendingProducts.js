/**
 * Shared helper: merge sessionStorage pending creates & updates into a Product.list result.
 * Call this inside every queryFn that uses queryKey ["products"].
 *
 * pendingProducts       — new products not yet confirmed by backend (create guard)
 * pendingProductUpdates — updated products whose fields may still be stale on backend (update guard)
 *
 * Both use _confirmCount: removed after 2 consecutive backend confirmations.
 */
export async function fetchProductsWithPending(listFn, callerLabel) {
  const result = await listFn();

  // ── CREATE guard ────────────────────────────────────────────────────────────
  const rawCreate = sessionStorage.getItem("pendingProducts");
  if (rawCreate) {
    let pending = JSON.parse(rawCreate);
    const backendIds = new Set(result.map(p => p.id));

    pending = pending
      .map(p => backendIds.has(p.id) ? { ...p, _confirmCount: (p._confirmCount || 0) + 1 } : p)
      .filter(p => (p._confirmCount || 0) < 2);

    if (pending.length === 0) {
      sessionStorage.removeItem("pendingProducts");
    } else {
      sessionStorage.setItem("pendingProducts", JSON.stringify(pending));
    }

    const stillMissing = pending.filter(p => !backendIds.has(p.id));
    // eslint-disable-next-line no-unused-vars
    const cleanMissing = stillMissing.map(({ _confirmCount, ...p }) => p);
    result.unshift(...cleanMissing);
  }

  // ── UPDATE guard ────────────────────────────────────────────────────────────
  const rawUpdate = sessionStorage.getItem("pendingProductUpdates");
  console.log("[UPDATE GUARD] pendingProductUpdates in sessionStorage:", rawUpdate ? JSON.parse(rawUpdate).map(p => ({ id: p.id, name: p.name, sell_price: p.sell_price, _savedAt: p._savedAt, _confirmCount: p._confirmCount })) : "NONE");

  if (rawUpdate) {
    let pendingUpdates = JSON.parse(rawUpdate);

    pendingUpdates = pendingUpdates.map(pending => {
      const idx = result.findIndex(p => p.id === pending.id);
      if (idx === -1) {
        console.log(`[UPDATE GUARD] id=${pending.id} NOT FOUND in backend result — keeping pending`);
        return pending;
      }
      const backendProduct = result[idx];
      console.log(`[UPDATE GUARD] id=${pending.id} | backend name="${backendProduct.name}" price=${backendProduct.sell_price} updated_date=${backendProduct.updated_date}`);
      console.log(`[UPDATE GUARD] id=${pending.id} | pending name="${pending.name}" price=${pending.sell_price} _savedAt=${pending._savedAt}`);

      const backendCaughtUp = backendProduct.updated_date && pending._savedAt &&
        new Date(backendProduct.updated_date).getTime() >= pending._savedAt;
      console.log(`[UPDATE GUARD] id=${pending.id} | backendCaughtUp=${backendCaughtUp} (backend_ts=${backendProduct.updated_date ? new Date(backendProduct.updated_date).getTime() : "N/A"} vs _savedAt=${pending._savedAt})`);

      if (backendCaughtUp) {
        console.log(`[UPDATE GUARD] id=${pending.id} | backend caught up — counting confirmation, _confirmCount=${(pending._confirmCount || 0) + 1}`);
        return { ...pending, _confirmCount: (pending._confirmCount || 0) + 1 };
      }
      // Backend still stale — replace with our saved version
      // eslint-disable-next-line no-unused-vars
      const { _confirmCount, _savedAt, ...cleanPending } = pending;
      result[idx] = cleanPending;
      console.log(`[UPDATE GUARD] id=${pending.id} | REPLACED backend product with pending. final name="${cleanPending.name}" price=${cleanPending.sell_price}`);
      return pending;
    }).filter(p => (p._confirmCount || 0) < 2);

    if (pendingUpdates.length === 0) {
      sessionStorage.removeItem("pendingProductUpdates");
      console.log("[UPDATE GUARD] all updates confirmed — sessionStorage cleared");
    } else {
      sessionStorage.setItem("pendingProductUpdates", JSON.stringify(pendingUpdates));
    }
  }

  return result;
}