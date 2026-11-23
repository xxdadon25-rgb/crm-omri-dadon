import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

const money=n=>Number(n??0).toLocaleString("he-IL",{
  style:"currency",currency:"ILS",minimumFractionDigits:2,maximumFractionDigits:2,
});
async function loadCommissionAdmin(agentId) {
 const [agents,ledger,payouts,preview,balance]=await Promise.all([
  supabase.from("sales_agent_profiles")
    .select("auth_user_id,display_name,commission_pct,is_active")
    .order("display_name"),
  agentId?supabase.from("sales_agent_commission_entries")
    .select("id,entry_kind,net_collected,commission_amount,source_key,settled_on")
    .eq("agent_auth_id",agentId).order("created_at",{ascending:false})
    .limit(500):Promise.resolve({data:[],error:null}),
  agentId?supabase.from("sales_agent_commission_payouts")
    .select("id,amount,period_month,paid_at,recorded_by_label")
    .eq("agent_auth_id",agentId).order("paid_at",{ascending:false})
    .limit(500):Promise.resolve({data:[],error:null}),
  agentId?supabase.rpc("sales_agent_commission_preview",{p_agent_id:agentId})
    :Promise.resolve({data:[],error:null}),
  agentId?supabase.rpc("sales_agent_commission_balance",{p_agent_id:agentId})
    :Promise.resolve({data:[],error:null}),
 ]);
 for(const result of [agents,ledger,payouts,preview,balance]){
   if(result.error)throw result.error;
 }
 return {agents:agents.data??[],ledger:ledger.data??[],
   payouts:payouts.data??[],preview:preview.data??[],
   balance:(Array.isArray(balance.data)?balance.data[0]:balance.data)??null};
}
export default function AgentCommissionAdmin(){
 const {crmRole}=useAuth();
 const allowed=AGENT_FEATURES_ENABLED&&crmRole==="manager";
 const client=useQueryClient();
 const [agentId,setAgentId]=useState("");
 const [busy,setBusy]=useState(false);
 const [amount,setAmount]=useState("");
 const [month,setMonth]=useState("");
 const [recorder,setRecorder]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const [notes,setNotes]=useState("");
 const retryId=useRef(new Map());
 const q=useQuery({
  queryKey:["manager-agent-commission-ledger",agentId],
  queryFn:()=>loadCommissionAdmin(agentId),
  enabled:allowed,refetchOnWindowFocus:true,
 });
 const data=q.data;
 const currentEntries=data?.ledger??[];
 const loggedPayouts=data?.payouts??[];
 const earned=Number(data?.balance?.total_commission_accrued??0);
 const paid=Number(data?.balance?.payouts_recorded??0);
 const balance=Number(data?.balance?.current_balance??0);
 const previewReview=(data?.preview??[]).filter(x=>x.review_reason!==null).length;
 async function reconcile(){
   if(!agentId||busy)return;
   setBusy(true);
   try{
     const {data:result,error}=await supabase.rpc("sales_agent_reconcile_commissions",{
       p_agent_id:agentId,
     });
     if(error)throw error;
     const r=Array.isArray(result)?result[0]:result;
     toast.success(`נוספו ${r?.new_settlements??0} עמלות, בוצעו ${r?.new_reversals??0} קיזוזים`);
     await client.invalidateQueries({queryKey:["manager-agent-commission-ledger"]});
   }catch(e){console.error("Commission reconciliation failed",e);
     toast.error("לא ניתן לבצע התאמה חשבונאית.");}
   finally{setBusy(false);}
 }
 async function recordPayout(e){
   e.preventDefault();
   if(!agentId||busy||!confirmed||!recorder||
      !/^[0-9]{4}-[0-9]{2}$/.test(month)){
     toast.error("יש למלא פרטים ולאשר שהתשלום בוצע מחוץ למערכת");return;
   }
   const amountNum=Number(amount);
   if(!Number.isFinite(amountNum)||amountNum<=0||
      Math.round(amountNum*100)/100!==amountNum){
     toast.error("סכום תשלום לא תקין");return;
   }
   const signature=JSON.stringify({agentId,amountNum,month,recorder});
   if(!retryId.current.has(signature))retryId.current.set(signature,crypto.randomUUID());
   setBusy(true);
   try{
     const {error}=await supabase.rpc("sales_agent_record_commission_payout",{
       p_payout_id:retryId.current.get(signature),p_agent_id:agentId,
       p_period_month:month+"-01",p_amount:amountNum,
       p_recorder_label:recorder,p_notes:notes.trim()||null,
     });
     if(error)throw error;
     toast.success("תועד תשלום עמלה שכבר בוצע. לא בוצעה העברה כספית.");
     setAmount("");setMonth("");setRecorder("");setConfirmed(false);setNotes("");
     retryId.current.clear();
     await client.invalidateQueries({queryKey:["manager-agent-commission-ledger"]});
   }catch(e){console.error("Agent payout record failed",e);
     toast.error("רישום העמלה נכשל. בדוק יתרה ושהתשלום אכן בוצע.");}
   finally{setBusy(false);}
 }
 if(!allowed)return <main dir="rtl" className="p-6">אין הרשאה לניהול עמלות.</main>;
 return <main dir="rtl" className="max-w-5xl mx-auto p-4 md:p-7 space-y-5">
   <header>
     <h1 className="text-2xl font-bold">ניהול עמלות סוכנים</h1>
     <p className="text-sm text-slate-600 mt-1">
       רק המנהל מתאם גבייה ומדווח על תשלום עמלה שכבר בוצע.
       המסך אינו שולח כסף ואינו רושם תשלום של לקוח.
     </p>
   </header>
   <section className="rounded-xl border bg-white p-4 space-y-3">
     <label className="block space-y-1">
       <span className="block text-sm font-semibold">סוכן</span>
       <select className="w-full rounded-lg border p-2" value={agentId}
         onChange={e=>setAgentId(e.target.value)}>
         <option value="">בחר סוכן</option>
         {data?.agents.map(a=><option key={a.auth_user_id} value={a.auth_user_id}>
           {a.display_name}{a.is_active?"":" (לא פעיל)"}
         </option>)}
       </select>
     </label>
     {q.error&&<p role="alert" className="text-red-700">
       לא ניתן לטעון רישומי עמלות.
     </p>}
     {agentId&&data&&!q.error&&<>
       <div className="grid gap-3 sm:grid-cols-3">
         <Summary label="עמלה מצטברת ברישום" value={money(earned)}/>
         <Summary label="עמלות שתועדו כשולמו" value={money(paid)}/>
         <Summary label="יתרה לאחר קיזוזים" value={money(balance)}/>
       </div>
       <button type="button" disabled={busy} onClick={reconcile}
         className="rounded-lg bg-slate-800 text-white px-4 py-2 disabled:opacity-50">
         התאם רישומים לפי גבייה וזיכויים
       </button>
       <p className="text-xs text-slate-500">
         {previewReview} תשלומים דורשים בדיקה. אין לשלם עמלה על נתונים לא מותאמים.
         רישומי העמלות המקוריים נשמרים, וקיזוז מתועד בשורה נפרדת.
       </p>
     </>}
   </section>
   {agentId&&data&&!q.error&&<>
     <section className="rounded-xl border bg-white p-4 space-y-3">
       <h2 className="font-bold">רישום תשלום עמלה שכבר בוצע</h2>
       <form className="space-y-3" onSubmit={recordPayout}>
         <div className="grid gap-3 sm:grid-cols-3">
           <label className="space-y-1">
             <span className="block text-sm">סכום ששולם בפועל (₪)</span>
             <input required type="number" step="0.01" min="0.01"
               className="w-full rounded-lg border p-2" value={amount}
               onChange={e=>setAmount(e.target.value)}/>
           </label>
           <label className="space-y-1">
             <span className="block text-sm">חודש שיוך</span>
             <input required type="month" className="w-full rounded-lg border p-2"
               value={month} onChange={e=>setMonth(e.target.value)}/>
           </label>
           <label className="space-y-1">
             <span className="block text-sm">מי רשם?</span>
             <select required value={recorder}
               onChange={e=>setRecorder(e.target.value)}
               className="w-full rounded-lg border p-2">
               <option value="">בחר</option>
               <option value="עומרי">עומרי</option>
               <option value="בן">בן</option>
             </select>
           </label>
         </div>
         <label className="space-y-1 block">
           <span className="block text-sm">הערה (לא חובה)</span>
           <input className="w-full rounded-lg border p-2" maxLength={1000}
             value={notes} onChange={e=>setNotes(e.target.value)}/>
         </label>
         <label className="flex items-start gap-2 text-sm">
           <input type="checkbox" checked={confirmed}
             onChange={e=>setConfirmed(e.target.checked)}/>
           <span>אני מאשר שהסכום כבר שולם לסוכן מחוץ למערכת. זו פעולת תיעוד בלבד.</span>
         </label>
         <button type="submit" disabled={busy||!confirmed||balance<=0}
           className="rounded-lg bg-green-700 text-white px-4 py-2 disabled:opacity-50">
           תעד עמלה ששולמה
         </button>
       </form>
     </section>
     <section className="rounded-xl border bg-white p-4 space-y-2">
       <h2 className="font-bold">רישומים אחרונים</h2>
       {currentEntries.slice(0,30).map(e=><div key={e.id}
         className="flex flex-wrap gap-3 justify-between text-sm border-t py-2">
         <span>{e.settled_on} · {e.entry_kind==="reversal"?"קיזוז":"גבייה"}</span>
         <strong>{money(e.commission_amount)}</strong>
       </div>)}
       {!currentEntries.length&&<p className="text-sm text-slate-500">
         אין עדיין רישומי עמלה.
       </p>}
     </section>
   </>}
 </main>;
}
function Summary({label,value}){
 return <div className="rounded-lg border p-3">
   <p className="text-sm text-slate-600">{label}</p>
   <strong className="text-xl">{value}</strong>
 </div>;
}
