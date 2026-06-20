const PENDING_KEY = "pendingBackups";

export function addPendingBackup(backup) {
  try {
    console.log("[pendingBackups] addPendingBackup called with:", JSON.stringify(backup, null, 2));
    const existing = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    existing.push(backup);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(existing));
    console.log("[pendingBackups] sessionStorage now has", existing.length, "pending backup(s)");
    console.log("[pendingBackups] full sessionStorage:", sessionStorage.getItem(PENDING_KEY));
  } catch (e) {
    console.error("[pendingBackups] addPendingBackup error:", e);
  }
}

export function mergePendingBackups(serverBackups) {
  try {
    console.log("[pendingBackups] mergePendingBackups — serverBackups count:", serverBackups.length);
    console.log("[pendingBackups] serverBackups ids:", serverBackups.map((b) => b.id));
    console.log("[pendingBackups] serverBackups data_urls:", serverBackups.map((b) => b.data_url));

    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    console.log("[pendingBackups] sessionStorage pending count:", pending.length);

    if (pending.length === 0) {
      console.log("[pendingBackups] no pending — returning server as-is");
      return serverBackups;
    }

    pending.forEach((p, i) => {
      console.log(`[pendingBackups] pending[${i}]: id=${p.id} data_url=${p.data_url}`);
    });

    const serverUrls = new Set(serverBackups.map((b) => b.data_url).filter(Boolean));
    console.log("[pendingBackups] serverUrls set:", [...serverUrls]);

    const unconfirmed = pending.filter((p) => !serverUrls.has(p.data_url));
    console.log("[pendingBackups] unconfirmed (pending NOT in server):", unconfirmed.length);
    console.log("[pendingBackups] final result count:", unconfirmed.length + serverBackups.length);

    return [...unconfirmed, ...serverBackups];
  } catch (e) {
    console.error("[pendingBackups] mergePendingBackups error:", e);
    return serverBackups;
  }
}