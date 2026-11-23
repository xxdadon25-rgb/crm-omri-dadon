import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

async function loadPendingAgentDeliveries() {
  const {data:alerts,error:alertError}=await supabase
    .from("sales_agent_delivery_alerts")
    .select("order_id,agent_auth_id,created_at")
    .is("closed_at",null)
    .order("created_at",{ascending:false})
    .limit(50);
  if(alertError)throw alertError;
  if(!alerts?.length)return [];

  const [orders,agents]=await Promise.all([
    supabase.from("orders")
      .select("id,order_number,customer_name,total,fulfilled,status")
      .in("id",alerts.map(a=>a.order_id)),
    supabase.from("sales_agent_profiles")
      .select("auth_user_id,display_name")
      .in("auth_user_id",[...new Set(alerts.map(a=>a.agent_auth_id))]),
  ]);
  if(orders.error)throw orders.error;
  if(agents.error)throw agents.error;

  const orderMap=Object.fromEntries((orders.data??[]).map(o=>[o.id,o]));
  const agentMap=Object.fromEntries((agents.data??[]).map(a=>[a.auth_user_id,a.display_name]));
  return alerts.filter(a=>orderMap[a.order_id]).map(a=>({
    ...a,order:orderMap[a.order_id],agentName:agentMap[a.agent_auth_id]??"סוכן",
  }));
}

/**
 * Informational manager queue. Delivery is completed using the EXISTING
 * inventory-aware order fulfillment flow. Never closes an alert directly.
 * The database trigger closes it only when orders.fulfilled becomes true.
 */
export default function AgentDeliveryQueue() {
  const {crmRole}=useAuth();
  const enabled=AGENT_FEATURES_ENABLED && crmRole==="manager";
  const {data:deliveries=[],error,isLoading}=useQuery({
    queryKey:["sales-agent-delivery-alerts"],
    queryFn:loadPendingAgentDeliveries,
    enabled,
    refetchInterval:enabled?30000:false,
  });
  if(!enabled)return null;
  return (
    <section dir="rtl" className="mb-5 rounded-2xl bg-white p-5 border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-bold text-lg">הזמנות סוכנים — ממתין לאספקה</h2>
        <span className="text-sm text-slate-600">{deliveries.length} הזמנות ממתינות</span>
      </div>
      {isLoading && <p className="text-slate-500 text-sm">טוען הזמנות סוכנים...</p>}
      {error && <p className="text-red-700 text-sm" role="alert">לא ניתן לטעון התראות אספקה.</p>}
      {!isLoading && !error && deliveries.length===0 &&
        <p className="text-slate-500 text-sm">אין הזמנות סוכנים הממתינות לאספקה.</p>}
      {deliveries.map(({order_id,order,agentName})=>(
        <div key={order_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3 text-sm">
          <div>
            <strong>הזמנה #{order.order_number}</strong>
            <span className="text-slate-500"> · {order.customer_name} · {agentName}</span>
          </div>
          <div className="flex items-center gap-4">
            <strong>₪{Number(order.total??0).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>
            <Link className="text-blue-700 underline" to="/orders">פתיחת הזמנות</Link>
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500 mt-3">
        ההתראה נסגרת לאחר סימון אספקה בתהליך ההזמנה הקיים, ולא בעקבות תשלום חשבונית.
      </p>
    </section>
  );
}
