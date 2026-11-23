import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

const money=n=>Number(n??0).toLocaleString("he-IL",{
  minimumFractionDigits:2,maximumFractionDigits:2,
});
async function listAssignedCustomers() {
  const {data,error}=await supabase.from("customers")
    .select("id,name,city,phone,email,is_active")
    .order("name");
  if(error)throw error;
  return data??[];
}

async function customerHistory(customerId) {
  const [orders,invoices,payments,credits]=await Promise.all([
    supabase.from("orders")
      .select("id,order_number,customer_id,date,total,status,fulfilled,agent")
      .eq("customer_id",customerId).order("date",{ascending:false}).limit(100),
    supabase.from("invoices")
      .select("id,invoice_number,customer_id,date,total")
      .eq("customer_id",customerId).order("date",{ascending:false}).limit(100),
    supabase.from("payments")
      .select("id,customer_id,payment_date,amount,payment_method,status")
      .eq("customer_id",customerId).order("payment_date",{ascending:false}).limit(100),
    supabase.from("credit_notes")
      .select("id,customer_id,date,total,finbot_status")
      .eq("customer_id",customerId).order("date",{ascending:false}).limit(100),
  ]);
  for(const result of [orders,invoices,payments,credits]){
    if(result.error)throw result.error;
  }
  return {
    orders:orders.data??[],invoices:invoices.data??[],
    payments:payments.data??[],credits:credits.data??[],
  };
}

/**
 * Strictly read-only customer history for assigned customers.
 * RLS enforces customer ownership for every query; this UI makes no
 * financial writes and does not synthesize unreliable outstanding debt.
 */
export default function AgentCustomers() {
  const {crmRole}=useAuth();
  const allowed=AGENT_FEATURES_ENABLED && crmRole==="agent";
  const [customerId,setCustomerId]=useState("");
  const queryClient=useQueryClient();
  const [newCustomer,setNewCustomer]=useState({name:"",phone:"",city:""});
  const [creating,setCreating]=useState(false);
  const createRetry=useRef(new Map());

  async function createCustomer(event) {
    event.preventDefault();
    if(creating || !allowed)return;
    const name=newCustomer.name.trim();
    if(!name || name.length>200){
      toast.error("יש להזין שם לקוח תקין");
      return;
    }
    const payload={
      name,phone:newCustomer.phone.trim(),city:newCustomer.city.trim(),
    };
    const signature=JSON.stringify(payload);
    if(!createRetry.current.has(signature))createRetry.current.set(signature,crypto.randomUUID());
    setCreating(true);
    try{
      const {data,error}=await supabase.rpc("sales_agent_create_customer",{
        p_request_id:createRetry.current.get(signature),p_customer:payload,
      });
      if(error)throw error;
      if(!data?.id)throw Error("customer_id_missing");
      setNewCustomer({name:"",phone:"",city:""});
      createRetry.current.clear();
      await queryClient.invalidateQueries({queryKey:["agent-customers"]});
      setCustomerId(data.id);
      toast.success("הלקוח נוצר ושויך אליך.");
    }catch(err){
      console.error("Agent customer create failed",err);
      toast.error("יצירת הלקוח לא הושלמה. בדוק את הפרטים או פנה למנהל.");
    }finally{setCreating(false);}
  }
  const customersQ=useQuery({
    queryKey:["agent-customers"],
    queryFn:listAssignedCustomers,
    enabled:allowed,
  });
  const selectedCustomer=(customersQ.data??[]).find(c=>c.id===customerId);
  const historyQ=useQuery({
    queryKey:["agent-customer-history",customerId],
    queryFn:()=>customerHistory(customerId),
    enabled:allowed&&!!selectedCustomer,
    retry:false,
  });
  if(!allowed)return <main dir="rtl" className="p-6">אין הרשאה למסך לקוחות הסוכן.</main>;

  return (
    <main dir="rtl" className="max-w-5xl mx-auto space-y-5 p-4 md:p-7">
      <header>
        <h1 className="text-2xl font-bold">לקוחות הסוכן</h1>
        <p className="text-sm text-slate-600 mt-1">
          מידע לקריאה בלבד על לקוחות המשויכים אליך. מסמכים ותשלומים אינם ניתנים לעריכה כאן.
        </p>
      </header>
      <form onSubmit={createCustomer} className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-bold">הוספת לקוח חדש</h2>
        <p className="text-xs text-slate-500">הלקוח החדש ישויך אליך אוטומטית. תנאי אשראי ומחירים לא ישתנו.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-sm">שם לקוח *</span>
            <input className="w-full rounded-lg border p-2" required maxLength={200}
              value={newCustomer.name} disabled={creating}
              onChange={e=>setNewCustomer(v=>({...v,name:e.target.value}))}/>
          </label>
          <label className="space-y-1">
            <span className="block text-sm">טלפון</span>
            <input className="w-full rounded-lg border p-2"
              value={newCustomer.phone} disabled={creating}
              onChange={e=>setNewCustomer(v=>({...v,phone:e.target.value}))}/>
          </label>
          <label className="space-y-1">
            <span className="block text-sm">עיר</span>
            <input className="w-full rounded-lg border p-2"
              value={newCustomer.city} disabled={creating}
              onChange={e=>setNewCustomer(v=>({...v,city:e.target.value}))}/>
          </label>
        </div>
        <button type="submit" disabled={creating}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40">
          {creating?"שומר...":"שמור לקוח ושייך לסוכן"}
        </button>
      </form>
      <section className="bg-white border rounded-xl p-4 space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">בחר לקוח</span>
          <select className="w-full rounded-lg border p-2 bg-white" value={customerId}
            onChange={e=>setCustomerId(e.target.value)}>
            <option value="">בחר לקוח משויך</option>
            {(customersQ.data??[]).map(c=>
              <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {customersQ.isLoading&&<p className="text-slate-600 text-sm">טוען לקוחות...</p>}
        {customersQ.error&&<p role="alert" className="text-red-700 text-sm">
          לא ניתן לטעון לקוחות משויכים.
        </p>}
        {selectedCustomer&&
          <div className="text-sm text-slate-600 space-y-1">
            <p>{selectedCustomer.city??""}</p>
            {selectedCustomer.phone&&<p>טלפון: {selectedCustomer.phone}</p>}
            {selectedCustomer.email&&<p>דוא״ל: {selectedCustomer.email}</p>}
          </div>}
      </section>
      {selectedCustomer&&
        <section className="space-y-5">
          {historyQ.isLoading&&<p className="text-slate-600">טוען היסטוריה...</p>}
          {historyQ.error&&<p role="alert" className="text-red-700">
            לא ניתן לטעון את היסטוריית הלקוח. בדוק הרשאות.
          </p>}
          {historyQ.data&&<>
            <HistoryTable title="הזמנות" columns={["תאריך","מספר","סכום כולל מע״מ","סטטוס","אספקה"]}
              rows={historyQ.data.orders.map(o=>[
                o.date??"",o.order_number??"",`₪${money(o.total)}`,
                o.status??"",o.fulfilled?"סופקה":"טרם סופקה"
              ])}/>
            <HistoryTable title="חשבוניות" columns={["תאריך","מספר","סכום כולל מע״מ"]}
              rows={historyQ.data.invoices.map(i=>[
                i.date??"",i.invoice_number??"",`₪${money(i.total)}`
              ])}/>
            <HistoryTable title="תשלומים" columns={["תאריך","אמצעי תשלום","סכום","סטטוס"]}
              rows={historyQ.data.payments.map(p=>[
                p.payment_date??"",p.payment_method??"",
                `₪${money(p.amount)}`,p.status??""
              ])}/>
            <HistoryTable title="זיכויים" columns={["תאריך","סכום","מצב"]}
              rows={historyQ.data.credits.map(c=>[
                c.date??"",`₪${money(c.total)}`,c.finbot_status??""
              ])}/>
          </>}
          <p className="text-xs text-slate-500">
            הסכומים מוצגים לפי המסמכים המקוריים. אין כאן חישוב יתרת חוב או עמלה.
          </p>
        </section>}
    </main>
  );
}

function HistoryTable({title,columns,rows}) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold mb-3">{title}</h2>
      {!rows.length&&<p className="text-sm text-slate-500">אין רשומות להצגה.</p>}
      {!!rows.length&&<div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead><tr className="border-b">
            {columns.map(col=><th key={col} className="p-2 font-semibold">{col}</th>)}
          </tr></thead>
          <tbody>{rows.map((cells,index)=><tr key={index} className="border-b last:border-0">
            {cells.map((cell,j)=><td key={j} className="p-2">{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  );
}
