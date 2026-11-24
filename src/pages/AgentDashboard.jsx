import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

async function loadAgentDashboard(){
  const [customers,orders,pendingDeliveries,invoices,exceptions,commissions] = await Promise.all([
    supabase.from("customers").select("id",{count:"exact",head:true}),
    supabase.from("orders").select("id",{count:"exact",head:true}),
    // Count ALL outstanding deliveries at the database; do not silently
    // undercount when more than 500 orders are visible to the agent.
    supabase.from("orders").select("id",{count:"exact",head:true})
      .or("fulfilled.is.null,fulfilled.eq.false"),
    supabase.from("invoices").select("id",{count:"exact",head:true}),
    supabase.from("sales_agent_margin_exceptions")
      .select("id,status",{count:"exact"}).eq("status","pending").limit(500),
    supabase.rpc("sales_agent_commission_preview",{}),
  ]);
  for(const r of [customers,orders,pendingDeliveries,invoices,exceptions,commissions]){
    if(r.error)throw r.error;
  }
  const eligible=(commissions.data??[]).filter(x=>x.review_reason===null);
  return {
    customers:customers.count??0,
    orders:orders.count??0,
    invoices:invoices.count??0,
    pendingDeliveries:pendingDeliveries.count??0,
    pendingExceptionRequests:exceptions.count??0,
    commissionEstimate:eligible.reduce((a,x)=>a+Number(x.commission_amount??0),0),
    commissionReview:(commissions.data??[]).filter(x=>x.review_reason!==null).length,
  };
}
const money=n=>Number(n??0).toLocaleString("he-IL",{
  style:"currency",currency:"ILS",maximumFractionDigits:2,
});

export default function AgentDashboard(){
  const {crmRole}=useAuth();
  const allowed=AGENT_FEATURES_ENABLED && crmRole==="agent";
  const q=useQuery({
    queryKey:["agent-dashboard-summary"],
    queryFn:loadAgentDashboard,
    enabled:allowed,refetchInterval:allowed?30000:false,
    refetchOnWindowFocus:true,
  });
  if(!allowed)return <main dir="rtl" className="p-6">אין הרשאה לדשבורד הסוכן.</main>;
  const s=q.data;
  return <main dir="rtl" className="mx-auto max-w-5xl p-4 md:p-7 space-y-5">
    <header className="flex flex-wrap justify-between gap-3 items-start">
      <div>
        <h1 className="text-2xl font-bold">דשבורד סוכן</h1>
        <p className="text-sm text-slate-600 mt-1">
          הנתונים מוצגים רק ללקוחות המשויכים אליך. תשלומים נרשמים על ידי המנהל בלבד.
        </p>
      </div>
      <button type="button" className="rounded-lg border px-4 py-2 text-sm"
        disabled={q.isFetching} onClick={()=>q.refetch()}>
        {q.isFetching?"מעדכן...":"רענן"}
      </button>
    </header>
    {q.isLoading&&<p>טוען נתונים...</p>}
    {q.error&&<p className="text-red-700 border border-red-300 rounded-lg p-4" role="alert">
      הנתונים לא נטענו במלואם. נסה לרענן.
    </p>}
    {s&&!q.error&&<>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Summary title="לקוחות משויכים" value={s.customers} to="/agent-customers"/>
        <Summary title="הזמנות לקוחות" value={s.orders} to="/agent-orders"/>
        <Summary title="הזמנות שטרם סופקו" value={s.pendingDeliveries}
          to="/agent-orders"/>
        <Summary title="חשבוניות לקוחות" value={s.invoices} to="/agent-collections"/>
        <Summary title="בקשות חריגה ממתינות" value={s.pendingExceptionRequests}
          to="/agent-orders"/>
        <Summary title="עמלה מחושבת — לא יתרה לתשלום" value={money(s.commissionEstimate)}
          to="/agent-commissions"/>
      </div>
      {s.commissionReview>0&&<p className="rounded-lg border border-amber-300 p-3 text-sm text-amber-800">
        {s.commissionReview} תשלומים דורשים התאמה לפני הכללה בעמלות.
      </p>}
    </>}
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold mb-3">פעולות שוטפות</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <NavTile to="/agent-orders" title="הזמנה חדשה" detail="מחירים, רווחיות 40% ואישורי חריגה"/>
        <NavTile to="/agent-collections" title="טיפול בגבייה" detail="חובות פתוחים ותשלומים שהמנהל עדכן"/>
        <NavTile to="/agent-customers" title="הלקוחות שלי" detail="היסטוריית מכירות, יצירת לקוח משויך"/>
        <NavTile to="/agent-commissions" title="העמלות שלי" detail="8% מהגבייה ללא מע״מ, לפני התאמה סופית"/>
      </div>
    </section>
  </main>;
}
function Summary({title,value,to}){
  return <Link to={to} className="rounded-xl border bg-white p-4 block no-underline">
    <p className="text-sm text-slate-600">{title}</p>
    <strong className="text-xl">{value}</strong>
  </Link>;
}
function NavTile({to,title,detail}){
  return <Link to={to} className="rounded-lg border p-3 block">
    <strong>{title}</strong><p className="text-sm text-slate-600 mt-1">{detail}</p>
  </Link>;
}
