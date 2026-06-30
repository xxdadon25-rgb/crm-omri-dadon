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
  let result = await listFn();

  // ── DELETE guard ────────────────────────────────────────────────────────────
  const rawDeleted = sessionStorage.getItem("pendingDeletedProducts");
  if (rawDeleted) {
    const deletedIds = new Set(JSON.parse(rawDeleted));
    result = result.filter(p => !deletedIds.has(p.id));
  }

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
  if (rawUpdate) {
    let pendingUpdates = JSON.parse(rawUpdate);

    pendingUpdates = pendingUpdates.map(pending => {
      const idx = result.findIndex(p => p.id === pending.id);
      if (idx === -1) return pending;

      const backendProduct = result[idx];
      const backendCaughtUp = backendProduct.updated_date && pending._savedAt &&
        new Date(backendProduct.updated_date).getTime() >= pending._savedAt;

      if (backendCaughtUp) {
        return { ...pending, _confirmCount: (pending._confirmCount || 0) + 1 };
      }
      // Backend still stale — replace with our saved version
      // eslint-disable-next-line no-unused-vars
      const { _confirmCount, _savedAt, ...cleanPending } = pending;
      result[idx] = cleanPending;
      return pending;
    }).filter(p => (p._confirmCount || 0) < 2);

    if (pendingUpdates.length === 0) {
      sessionStorage.removeItem("pendingProductUpdates");
    } else {
      sessionStorage.setItem("pendingProductUpdates", JSON.stringify(pendingUpdates));
    }
  }

  return result;
}
