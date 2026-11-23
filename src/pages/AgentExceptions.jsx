import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";
import {
  AGENT_EXCEPTION_APPROVERS,
  canSubmitExceptionDecision,
} from "@/lib/agentExceptionApproval";

async function loadPendingExceptions() {
  const { data, error } = await supabase
    .from("sales_agent_margin_exceptions")
    .select("id,agent_auth_id,customer_id,margin_pct,reason,requested_at,status,request_hash,order_payload")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) throw error;

  const requests = data ?? [];
  if (!requests.length) return { requests: [], customers: {}, agents: {}, products: {} };
  const customerIds = [...new Set(requests.map(r => r.customer_id))];
  const agentIds = [...new Set(requests.map(r => r.agent_auth_id))];
  const productIds=[...new Set(
    requests.flatMap(r=>(r.order_payload?.items??[]).map(item=>item.product_id))
      .filter(Boolean)
  )];
  const [customersResult, agentsResult, productsResult] = await Promise.all([
    supabase.from("customers").select("id,name").in("id",customerIds),
    supabase.from("sales_agent_profiles").select("auth_user_id,display_name").in("auth_user_id",agentIds),
    productIds.length
      ? supabase.from("products").select("id,name").in("id",productIds)
      : Promise.resolve({data:[],error:null}),
  ]);
  if (customersResult.error) throw customersResult.error;
  if (agentsResult.error) throw agentsResult.error;
  if (productsResult.error) throw productsResult.error;
  return {
    requests,
    customers: Object.fromEntries((customersResult.data ?? []).map(c => [c.id,c.name])),
    agents: Object.fromEntries((agentsResult.data ?? []).map(a => [a.auth_user_id,a.display_name])),
    products: Object.fromEntries((productsResult.data ?? []).map(p => [p.id,p.name])),
  };
}

/** Manager-only exception inbox. Server verifies manager business and makes
 * approval an atomic, single-winner decision. A decision does not create an
 * order or deduct stock. The UI is never an authorization boundary. */
export default function AgentExceptions() {
  const { crmRole } = useAuth();
  const queryClient = useQueryClient();
  const [selectedByRequest, setSelectedByRequest] = useState({});
  const [submittingId, setSubmittingId] = useState(null);
  const allowed = AGENT_FEATURES_ENABLED && crmRole === "manager";
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-agent-margin-exceptions"],
    queryFn: loadPendingExceptions,
    enabled: allowed,
    refetchInterval: allowed ? 30000 : false,
  });

  async function decide(request, decision) {
    const selectedApprover = selectedByRequest[request.id];
    if (!allowed || submittingId || !canSubmitExceptionDecision({
      authenticatedManager: true,
      status: request.status,
      selectedApprover,
      decision,
    })) {
      toast.error("יש לבחור מאשר לפני אישור או דחייה");
      return;
    }
    setSubmittingId(request.id);
    try {
      const { data: accepted, error: mutationError } = await supabase.rpc(
        "sales_agent_decide_exception",
        {
          p_exception_id: request.id,
          p_decision: decision,
          p_approver_label: selectedApprover,
        }
      );
      if (mutationError) throw mutationError;
      if (accepted !== true) {
        toast.error("הבקשה כבר טופלה או שאין הרשאה לקבל החלטה");
      } else {
        toast.success(decision === "approved" ? "החריגה אושרה" : "החריגה נדחתה");
      }
      await queryClient.invalidateQueries({ queryKey: ["sales-agent-margin-exceptions"] });
    } catch (err) {
      console.error("Sales agent exception decision failed",err);
      toast.error("לא ניתן לעדכן את הבקשה. לא בוצע שינוי.");
    } finally {
      setSubmittingId(null);
    }
  }

  if (!AGENT_FEATURES_ENABLED) {
    return <div className="p-6" dir="rtl">מודול הסוכנים עדיין אינו פעיל.</div>;
  }
  if (crmRole !== "manager") {
    return <div className="p-6" dir="rtl">אין הרשאה למסך אישורי חריגות.</div>;
  }
  return (
    <main dir="rtl" className="p-4 md:p-7 max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">בקשות חריגה של סוכנים</h1>
        <p className="mt-1 text-sm text-slate-600">
          בכל בקשה בוחרים עומרי או בן. אישור אינו יוצר הזמנה ואינו מפחית מלאי;
          ההזמנה תחויב בבדיקה חוזרת לפני ביצוע.
        </p>
      </header>
      {isLoading && <p>טוען בקשות...</p>}
      {error && <p role="alert" className="text-red-700">לא ניתן לטעון בקשות. נסה לרענן.</p>}
      {!isLoading && !error && data?.requests.length === 0 &&
        <p className="rounded-xl border bg-white p-6 text-slate-600">אין כרגע בקשות חריגה ממתינות.</p>}
      {data?.requests.map(req => (
        <section key={req.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{data.customers[req.customer_id] || "לקוח ללא שם"}</h2>
              <p className="text-sm text-slate-600">סוכן: {data.agents[req.agent_auth_id] || "לא זמין"}</p>
            </div>
            <div className="text-left">
              <strong className="text-red-700">רווחיות: {Number(req.margin_pct).toFixed(2)}%</strong>
              <p className="text-xs text-slate-500">{new Date(req.requested_at).toLocaleString("he-IL",{timeZone:"Asia/Jerusalem"})}</p>
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 space-y-2">
            <p className="text-sm font-semibold">פרטי ההזמנה שממתינים לאישור</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead><tr className="border-b">
                  <th className="p-2">מוצר</th><th className="p-2">כמות</th>
                  <th className="p-2">מחיר ליחידה</th><th className="p-2">הנחה</th>
                  <th className="p-2">סה״כ לפני מע״מ</th>
                </tr></thead>
                <tbody>{(req.order_payload?.items??[]).map((item,index)=>(
                  <tr key={index} className="border-b last:border-0">
                    <td className="p-2">{data.products[item.product_id]??"מוצר לא זמין"}</td>
                    <td className="p-2">{item.quantity}</td>
                    <td className="p-2">₪{Number(item.unit_price).toFixed(2)}</td>
                    <td className="p-2">{item.discount??0}%</td>
                    <td className="p-2">₪{Number(item.total).toFixed(2)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="font-semibold text-sm">
              סך מכירה לפני מע״מ: ₪{(req.order_payload?.items??[])
                .reduce((sum,item)=>sum+Number(item.total??0),0).toFixed(2)}
            </p>
          </div>
          <p className="text-sm">סיבת החריגה: {req.reason}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold" htmlFor={`approver-${req.id}`}>מי מאשר?</label>
            <select
              id={`approver-${req.id}`}
              value={selectedByRequest[req.id] ?? ""}
              onChange={e => setSelectedByRequest(prev => ({...prev,[req.id]:e.target.value}))}
              className="rounded-lg border border-slate-300 p-2 bg-white"
              disabled={submittingId === req.id}
            >
              <option value="">בחר מאשר</option>
              {AGENT_EXCEPTION_APPROVERS.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button"
              className="rounded-lg bg-green-700 px-4 py-2 text-white disabled:opacity-50"
              disabled={!!submittingId || !selectedByRequest[req.id]}
              onClick={() => decide(req,"approved")}>
              אשר חריגה
            </button>
            <button type="button"
              className="rounded-lg border border-red-600 px-4 py-2 text-red-700 disabled:opacity-50"
              disabled={!!submittingId || !selectedByRequest[req.id]}
              onClick={() => decide(req,"rejected")}>
              דחה
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}
