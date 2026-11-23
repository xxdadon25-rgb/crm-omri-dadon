import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

const money = value => Number(value ?? 0).toLocaleString("he-IL", {
  style:"currency",currency:"ILS",minimumFractionDigits:2,maximumFractionDigits:2,
});
const reasonLabels = {
  payment_not_approved:"התשלום עדיין אינו מאושר",
  invalid_payment:"חסרים נתוני תשלום",
  missing_invoice_vat:"חסר שיעור מע״מ בחשבונית",
  invalid_invoice_total:"סכום החשבונית אינו תקין",
  multi_order_invoice_needs_allocation:"חשבונית הכוללת כמה הזמנות — נדרשת חלוקת גבייה",
  credited_invoice_needs_reconciliation:"החשבונית זוכתה — נדרש חישוב התאמה",
  credit_note_needs_reconciliation:"קיים זיכוי או בקשת זיכוי — נדרשת התאמה",
  missing_historical_agent_rate:"לא נשמר שיעור העמלה המקורי",
};
async function loadCommissionPreview() {
  const {data,error}=await supabase.rpc("sales_agent_commission_preview",{});
  if(error)throw error;
  return data??[];
}

/**
 * Read-only commission preview; NOT an earned/payout ledger.
 * A manager registers all received/cleared payments. Agent can neither
 * record a receipt nor approve, correct or pay any commission here.
 */
export default function AgentCommissions() {
  const {crmRole}=useAuth();
  const allowed=AGENT_FEATURES_ENABLED && crmRole==="agent";
  const q=useQuery({
    queryKey:["agent-commission-preview"],
    queryFn:loadCommissionPreview,
    enabled:allowed,
    refetchInterval:allowed?15000:false,
    refetchOnWindowFocus:true,
    retry:1,
  });
  if(!allowed)return <main dir="rtl" className="p-6">אין הרשאה לצפייה בעמלות.</main>;
  const rows=q.data??[];
  const eligible=rows.filter(r=>r.review_reason===null);
  const review=rows.filter(r=>r.review_reason!==null);
  const collectedNet=eligible.reduce((a,r)=>a+Number(r.net_received??0),0);
  const commission=eligible.reduce((a,r)=>a+Number(r.commission_amount??0),0);
  return (
    <main dir="rtl" className="mx-auto max-w-5xl p-4 md:p-7 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">העמלות שלי</h1>
          <p className="mt-1 text-sm text-slate-600">
            חישוב לפי תשלומים שהמנהל כבר רשם, ללא מע״מ ובהתאם להזמנה המקורית שלך.
          </p>
        </div>
        <button type="button" className="rounded-lg border px-4 py-2 text-sm"
          disabled={q.isFetching} onClick={()=>q.refetch()}>
          {q.isFetching?"מעדכן...":"רענן"}
        </button>
      </header>

      {q.isLoading&&<p>טוען חישוב עמלות...</p>}
      {q.error&&<p className="rounded-lg border border-red-300 p-4 text-red-700" role="alert">
        לא ניתן לאמת את כל נתוני העמלות. כרגע לא מוצג סכום מחושב.
      </p>}
      {!q.isLoading&&!q.error&&<>
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary title="גבייה ללא מע״מ שנכללה בחישוב" value={money(collectedNet)}/>
          <Summary title="עמלה מחושבת — טרם אושרה לתשלום" value={money(commission)}/>
          <Summary title="תשלומים שמצריכים בדיקה" value={review.length}/>
        </div>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-bold mb-3">פירוט תשלומים שנכללו בחישוב</h2>
          {!eligible.length&&<p className="text-slate-500 text-sm">אין עדיין תשלומים שניתן לשייך לעמלה.</p>}
          {eligible.length>0&&<div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead><tr className="border-b">
                <th className="p-2">תאריך גבייה</th>
                <th className="p-2">סכום שנגבה</th>
                <th className="p-2">לפני מע״מ</th>
                <th className="p-2">שיעור עמלה</th>
                <th className="p-2">עמלה מחושבת</th>
              </tr></thead>
              <tbody>{eligible.map(r=>(
                <tr className="border-b last:border-0" key={r.payment_id}>
                  <td className="p-2">{r.payment_date}</td>
                  <td className="p-2">{money(r.gross_received)}</td>
                  <td className="p-2">{money(r.net_received)}</td>
                  <td className="p-2">{r.commission_pct}%</td>
                  <td className="p-2 font-semibold">{money(r.commission_amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
        </section>
        {review.length>0&&<section className="rounded-xl border bg-white p-4 space-y-2">
          <h2 className="font-bold">תשלומים הממתינים לבדיקה חשבונאית</h2>
          <p className="text-sm text-slate-600">
            לא חושבה עמלה על התשלומים הבאים עד לבירור שיוך ההזמנה או הזיכוי.
          </p>
          {review.map(r=>(
            <div key={r.payment_id} className="flex flex-wrap justify-between gap-2 border-t py-2 text-sm">
              <span>{r.payment_date} · {money(r.gross_received)}</span>
              <span className="text-amber-700">
                {reasonLabels[r.review_reason]??"נדרשת בדיקה"}
              </span>
            </div>
          ))}
        </section>}
        <p className="text-xs text-slate-500">
          זהו חישוב צפייה בלבד. יתרה סופית לתשלום לסוכן תיקבע רק לאחר
          השלמת ההתאמות לזיכויים, רישום עמלות ותשלומי עמלות בפועל.
          לא ניתן לרשום או לשנות תשלום במסך זה.
        </p>
      </>}
    </main>
  );
}
function Summary({title,value}){
  return <div className="rounded-xl border bg-white p-4">
    <p className="text-sm text-slate-600">{title}</p>
    <strong className="text-xl">{value}</strong>
  </div>;
}
