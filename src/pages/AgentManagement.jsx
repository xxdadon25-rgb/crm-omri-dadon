import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

async function loadManagerAgents() {
  const [a,c,s] = await Promise.all([
    supabase.from("sales_agent_profiles")
      .select("auth_user_id,display_name,commission_pct,is_active,created_at")
      .order("created_at",{ascending:true}),
    supabase.from("customers").select("id,name").order("name"),
    supabase.from("sales_agent_customer_assignments")
      .select("customer_id,agent_auth_id"),
  ]);
  for (const r of [a,c,s]) if(r.error) throw r.error;
  return {agents:a.data??[],customers:c.data??[],assignments:s.data??[]};
}

export default function AgentManagement(){
  const {crmRole}=useAuth();
  const enabled=AGENT_FEATURES_ENABLED && crmRole==="manager";
  const client=useQueryClient();
  const [newAgent,setNewAgent]=useState({id:"",name:""});
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState("");
  const [customerId,setCustomerId]=useState("");
  const q=useQuery({
    queryKey:["manager-sales-agents"],queryFn:loadManagerAgents,
    enabled,refetchOnWindowFocus:true,
  });

  async function register(e){
    e.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      const {error}=await supabase.rpc("sales_agent_register_disabled",{
        p_auth_user_id:newAgent.id.trim(),
        p_display_name:newAgent.name.trim(),
        p_commission_pct:8,
      });
      if(error)throw error;
      toast.success("פרופיל הסוכן נוצר במצב לא פעיל");
      setNewAgent({id:"",name:""});
      await client.invalidateQueries({queryKey:["manager-sales-agents"]});
    }catch(err){
      console.error("Manager agent registration failed",err);
      toast.error("לא ניתן לרשום סוכן. ודא שקיים חשבון הזדהות נפרד שאינו חשבון לקוח.");
    }finally{setBusy(false);}
  }

  async function changeAssignment(assign){
    if(!selected||!customerId||busy)return;
    setBusy(true);
    try{
      const {error}=await supabase.rpc("sales_agent_set_customer_assignment",{
        p_agent_auth_id:selected,
        p_customer_id:customerId,
        p_assign:assign,
      });
      if(error)throw error;
      toast.success(assign?"הלקוח שויך לסוכן":"שיוך הלקוח הוסר");
      await client.invalidateQueries({queryKey:["manager-sales-agents"]});
    }catch(err){
      console.error("Customer reassignment failed",err);
      toast.error("לא ניתן לשנות את שיוך הלקוח.");
    }finally{setBusy(false);}
  }

  async function disable(id){
    if(busy)return;
    setBusy(true);
    try{
      const {error}=await supabase.rpc("sales_agent_disable",{
        p_agent_auth_id:id,
      });
      if(error)throw error;
      toast.success("הסוכן הושבת. היסטוריית ההזמנות והעמלות נשמרה.");
      await client.invalidateQueries({queryKey:["manager-sales-agents"]});
    }catch(err){
      console.error("Agent disable failed",err);
      toast.error("לא ניתן להשבית את הסוכן.");
    }finally{setBusy(false);}
  }

  if(!enabled)return <main dir="rtl" className="p-6">אין הרשאה לניהול סוכנים.</main>;
  const data=q.data;
  const selectedAssignments=(data?.assignments??[])
    .filter(a=>a.agent_auth_id===selected)
    .map(a=>a.customer_id);
  return <main dir="rtl" className="mx-auto max-w-5xl p-4 md:p-7 space-y-5">
    <header>
      <h1 className="text-2xl font-bold">ניהול סוכנים</h1>
      <p className="text-sm text-slate-600 mt-1">
        ניהול פרופילים ושיוך לקוחות. סוכנים חדשים נוצרים לא פעילים.
        הפעלה ראשונה תחייב השלמת בדיקות ואישור הפעלה של המערכת.
      </p>
    </header>
    {q.error&&<p role="alert" className="text-red-700">לא ניתן לטעון נתוני סוכנים.</p>}
    {q.isLoading&&<p>טוען סוכנים...</p>}
    <section className="bg-white border rounded-xl p-4 space-y-3">
      <h2 className="font-bold">רישום סוכן עם חשבון קיים</h2>
      <p className="text-xs text-slate-500">
        יש ליצור תחילה חשבון Supabase Auth נפרד לסוכן. אין להשתמש בחשבון המנהל
        או בחשבון פורטל של לקוח. המסך אינו יוצר חשבון הזדהות.
      </p>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={register}>
        <label className="space-y-1 sm:col-span-2">
          <span className="block text-sm">מזהה חשבון Auth</span>
          <input required className="w-full border rounded-lg p-2" value={newAgent.id}
            onChange={e=>setNewAgent(a=>({...a,id:e.target.value}))}/>
        </label>
        <label className="space-y-1">
          <span className="block text-sm">שם סוכן</span>
          <input required maxLength={100} className="w-full border rounded-lg p-2"
            value={newAgent.name}
            onChange={e=>setNewAgent(a=>({...a,name:e.target.value}))}/>
        </label>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-slate-800 text-white px-4 py-2 disabled:opacity-50">
          צור סוכן לא פעיל (8%)
        </button>
      </form>
    </section>
    <section className="bg-white border rounded-xl p-4 space-y-3">
      <h2 className="font-bold">סוכנים קיימים</h2>
      {data&&!data.agents.length&&<p className="text-sm text-slate-500">טרם נרשמו סוכנים.</p>}
      {data?.agents.map(a=>{
        const assigned=data.assignments.filter(x=>x.agent_auth_id===a.auth_user_id).length;
        return <div key={a.auth_user_id}
          className="border-t py-3 flex flex-wrap gap-3 justify-between items-center text-sm">
          <div>
            <strong>{a.display_name}</strong>
            <span className="text-slate-600"> · {assigned} לקוחות · עמלה {a.commission_pct}%</span>
            <span className={a.is_active?"text-green-700 mr-2":"text-amber-700 mr-2"}>
              {a.is_active?"פעיל":"לא פעיל"}
            </span>
          </div>
          {a.is_active&&<button type="button" disabled={busy}
            onClick={()=>disable(a.auth_user_id)}
            className="border border-red-600 text-red-700 rounded-lg px-3 py-2">
            השבת סוכן
          </button>}
        </div>;
      })}
    </section>
    <section className="bg-white border rounded-xl p-4 space-y-3">
      <h2 className="font-bold">שיוך לקוחות</h2>
      <select className="w-full border rounded-lg p-2" value={selected}
        onChange={e=>setSelected(e.target.value)}>
        <option value="">בחר סוכן</option>
        {data?.agents.map(a=><option key={a.auth_user_id} value={a.auth_user_id}>
          {a.display_name}</option>)}
      </select>
      {selected&&<>
        <select className="w-full border rounded-lg p-2" value={customerId}
          onChange={e=>setCustomerId(e.target.value)}>
          <option value="">בחר לקוח</option>
          {data?.customers.map(c=><option key={c.id} value={c.id}>
            {c.name}{selectedAssignments.includes(c.id)?" (משויך)":""}
          </option>)}
        </select>
        <div className="flex gap-3">
          <button type="button" disabled={busy||!customerId||
            selectedAssignments.includes(customerId)}
            className="rounded-lg bg-slate-800 text-white px-4 py-2 disabled:opacity-50"
            onClick={()=>changeAssignment(true)}>שייך לקוח</button>
          <button type="button" disabled={busy||!customerId||
            !selectedAssignments.includes(customerId)}
            className="rounded-lg border px-4 py-2 disabled:opacity-50"
            onClick={()=>changeAssignment(false)}>בטל שיוך</button>
        </div>
      </>}
      <p className="text-xs text-slate-500">
        ביטול שיוך מסיר גישה עתידית לנתוני הלקוח; שיוך הסוכן להזמנות קיימות
        והעמלות ההיסטוריות נשמרים.
      </p>
    </section>
  </main>;
}
