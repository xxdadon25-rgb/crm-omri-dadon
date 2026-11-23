import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";
import { rankCollections } from "@/lib/agentCollections";

const money = shekels => Number(shekels ?? 0).toLocaleString("he-IL", {
  style:"currency",currency:"ILS",minimumFractionDigits:2,
  maximumFractionDigits:2,
});

/** Read every authorized page. Never show deceptively partial debt totals. */
async function allVisibleRows(table, fields, orderField="id") {
  const rows=[];
  const pageSize=400;
  for(let page=0;page<75;page++){
    const {data,error}=await supabase.from(table)
      .select(fields)
      .order(orderField,{ascending:true})
      .range(page*pageSize,(page+1)*pageSize-1);
    if(error)throw error;
    rows.push(...(data??[]));
    if(!data || data.length<pageSize)return rows;
  }
  throw new Error("too_many_rows_for_complete_collection_summary");
}

async function loadCollectionPortfolio(){
  // All reads protected by staged RLS for ASSIGNED customers only.
  const [customers,invoices,payments,credits]=await Promise.all([
    allVisibleRows("customers","id,name,city,phone,is_active"),
    allVisibleRows("invoices","id,customer_id,invoice_number,date,due_date,total,paid_amount,credited_at,credit_note_id"),
    allVisibleRows("payments","id,customer_id,invoice_id,amount,payment_date,payment_method,status"),
    allVisibleRows("credit_notes","id,customer_id,invoice_id,total,finbot_status,external_credit_note_number,date"),
  ]);
  return rankCollections(customers,invoices,payments,credits);
}

/**
 * The agent follows up with customers. Only manager-recorded payments and
 * confirmed credits drive the canonical balance. No INSERT/UPDATE/DELETE.
 */
export default function AgentCollections(){
  const {crmRole}=useAuth();
  const enabled=AGENT_FEATURES_ENABLED && crmRole==="agent";
  const queryClient=useQueryClient();
  const q=useQuery({
    queryKey:["agent-collections"],
    queryFn:loadCollectionPortfolio,
    enabled,
    staleTime:0,
    refetchInterval:enabled?15000:false,
    refetchOnWindowFocus:true,
    retry:1,
  });

  useEffect(()=>{
    if(!enabled)return;
    const channel=supabase.channel("agent-collections-refresh")
      .on("postgres_changes",{event:"*",schema:"public",table:"payments"},()=>queryClient.invalidateQueries({queryKey:["agent-collections"]}))
      .on("postgres_changes",{event:"*",schema:"public",table:"invoices"},()=>queryClient.invalidateQueries({queryKey:["agent-collections"]}))
      .on("postgres_changes",{event:"*",schema:"public",table:"credit_notes"},()=>queryClient.invalidateQueries({queryKey:["agent-collections"]}))
      .subscribe();
    return ()=>{supabase.removeChannel(channel);};
  },[enabled,queryClient]);

  if(!enabled)return <main dir="rtl" className="p-6">אין הרשאה למסך הגבייה.</main>;
  const positions=q.data??[];
  const totals=positions.reduce((a,p)=>({
    debt:a.debt+p.debt,refund:a.refund+p.refundDue,
  }),{debt:0,refund:0});

  return (
    <main dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">מעקב גבייה — הלקוחות שלי</h1>
          <p className="text-sm text-slate-600 mt-1">
            הסוכן מטפל בגבייה מול הלקוח. רק המנהל רושם את התשלום ב־QuickStock.
          </p>
        </div>
        <button type="button" className="rounded-lg border px-4 py-2 text-sm"
          onClick={()=>q.refetch()} disabled={q.isFetching}>
          {q.isFetching?"מעדכן...":"רענן תשלומים"}
        </button>
      </header>

      {q.isLoading&&<p>טוען יתרות ונתוני גבייה...</p>}
      {q.error&&<p role="alert" className="rounded-lg border border-red-300 p-4 text-red-700">
        לא ניתן לטעון נתונים מלאים. כדי להימנע מהצגת יתרה שגויה, אין כרגע סיכום גבייה.
      </p>}
      {!q.error&&!q.isLoading&&<>
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary title="לקוחות משויכים" value={positions.length}/>
          <Summary title="חוב פתוח לגבייה" value={money(totals.debt)}/>
          <Summary title="זיכויים / יתרות להחזר" value={money(totals.refund)}/>
        </div>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-bold mb-3">לקוחות לפי גובה החוב</h2>
          {!positions.length&&<p className="text-slate-500 text-sm">אין לקוחות משויכים.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead><tr className="border-b">
                <th className="p-2">לקוח</th><th className="p-2">חוב פתוח</th>
                <th className="p-2">נגבה ונרשם</th><th className="p-2">החזר ללקוח</th>
                <th className="p-2">חשבוניות</th>
              </tr></thead>
              <tbody>{positions.map(p=>(
                <tr key={p.customer.id} className="border-b last:border-0">
                  <td className="p-2 font-medium">{p.customer.name}
                    {p.customer.phone&&<div className="text-xs text-slate-500">{p.customer.phone}</div>}
                  </td>
                  <td className={p.debtAg>0?"p-2 font-semibold text-orange-700":"p-2 text-green-700"}>
                    {money(p.debt)}
                  </td>
                  <td className="p-2">{money(p.perInvoice.reduce((s,x)=>s+x.position.paidAg,0)/100)}</td>
                  <td className="p-2">{money(p.refundDue)}</td>
                  <td className="p-2">{p.invoiceCount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <p className="text-xs text-slate-500">
          החוב מתעדכן מהחשבוניות, התשלומים והזיכויים המאושרים, לפי אותו חישוב של QuickStock.
          המידע מתרענן אוטומטית, ובאפשרותך לרענן ידנית. אין לסוכן הרשאת רישום תשלום.
          <Link className="text-blue-700 underline mr-2" to="/agent-customers">צפייה בהיסטוריית לקוח</Link>
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
