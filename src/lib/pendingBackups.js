const PENDING_KEY = "pendingBackups";

export function addPendingBackup(backup) {
  try {
    const existing = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    existing.push(backup);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error("[pendingBackups] addPendingBackup error:", e);
  }
}

export function mergePendingBackups(serverBackups) {
  try {

    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");

    if (pending.length === 0) {
      return serverBackups;
    }

    pending.forEach((p, i) => {
    });

    const serverUrls = new Set(serverBackups.map((b) => b.data_url).filter(Boolean));

    const unconfirmed = pending.filter((p) => !serverUrls.has(p.data_url));

    return [...unconfirmed, ...serverBackups];
  } catch (e) {
    console.error("[pendingBackups] mergePendingBackups error:", e);
    return serverBackups;
  }
}