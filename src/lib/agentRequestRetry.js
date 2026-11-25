// Persist the idempotency key for an unacknowledged agent action across
// refreshes of the SAME browser tab. No backend writes or new agent powers.
// The server still verifies the original payload, customer and owner.
const storageKey=(userId,kind)=>`quickstock-agent-retry-v1:${userId}:${kind}`;

export function getOrCreateAgentRequestId({storage,userId,kind,signature,createId}) {
  if(!userId||!kind||!signature)throw Error("invalid_agent_retry_identity");
  const key=storageKey(userId,kind);
  try {
    const saved=JSON.parse(storage?.getItem(key)??"null");
    if(saved?.signature===signature &&
       typeof saved.id==="string" &&
       /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.id)) {
      return saved.id;
    }
  } catch {
    // Private browsing/storage unavailable: server idempotency still protects
    // repeated in-page requests via the component's in-memory fallback.
  }
  const id=createId();
  try { storage?.setItem(key,JSON.stringify({signature,id})); } catch {}
  return id;
}

export function clearAgentRequestId({storage,userId,kind,signature,id}) {
  if(!userId||!kind) return;
  const key=storageKey(userId,kind);
  try {
    const saved=JSON.parse(storage?.getItem(key)??"null");
    if(saved?.signature===signature&&saved?.id===id) storage?.removeItem(key);
  } catch {}
}
