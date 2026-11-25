// Persist the idempotency key for an unacknowledged agent action across
// refreshes of the SAME browser tab. No backend writes or new agent powers.
// The server still verifies the original payload, customer and owner.
const storageKey=(userId,kind)=>`quickstock-agent-retry-v1:${userId}:${kind}`;

export function getOrCreateAgentRequestId({storage,userId,kind,signature,createId,draft}) {
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
  try { storage?.setItem(key,JSON.stringify({signature,id,draft})); } catch {}
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

/**
 * Recover only an unacknowledged form for the SAME signed-in agent and tab.
 * Never invent a request ID; the matching ID stays in the original record.
 * The screen revalidates customer access, prices and margin with Supabase.
 */
export function readPendingAgentDraft({storage,userId}) {
  if(!userId)return null;
  for(const kind of ["order","exception"]) {
    try {
      const saved=JSON.parse(storage?.getItem(storageKey(userId,kind))??"null");
      const draft=saved?.draft;
      if(!draft || typeof draft.customerId!=="string" ||
         !Array.isArray(draft.items) || draft.items.length<1 ||
         draft.items.length>250 ||
         typeof draft.manualGrossTotal!=="string" ||
         typeof draft.reason!=="string")continue;
      const signature=JSON.stringify({customerId:draft.customerId,items:draft.items})+
        ":"+(draft.manualGrossTotal.trim()||"regular");
      if(saved.signature!==signature)continue;
      return {...draft,kind,signature};
    } catch {}
  }
  return null;
}
