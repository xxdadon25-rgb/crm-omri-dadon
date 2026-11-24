import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";

/**
 * Manager-only agent catalogue access. This view NEVER updates products,
 * price, inventory, is_active, owner orders or customer-portal availability.
 */
async function loadProductAccess() {
  const [p,b]=await Promise.all([
    supabase.from("products")
      .select("id,name,sku,is_active,buy_price,sell_price,quantity")
      .order("name"),
    supabase.from("sales_agent_product_blocks")
      .select("product_id,blocked_at"),
  ]);
  if(p.error)throw p.error;
  if(b.error)throw b.error;
  return {products:p.data??[],blocks:b.data??[]};
}

export default function AgentProductAccess(){
  const {crmRole}=useAuth();
  const enabled=AGENT_FEATURES_ENABLED&&crmRole==="manager";
  const queryClient=useQueryClient();
  const [search,setSearch]=useState("");
  const [busy,setBusy]=useState("");
  const q=useQuery({
    queryKey:["manager-agent-product-access"],
    queryFn:loadProductAccess,enabled,
    refetchOnWindowFocus:true,
  });
  const data=q.data;
  const blocked=new Set((data?.blocks??[]).map(b=>b.product_id));
  const filtered=(data?.products??[]).filter(p=>
    p.name?.toLocaleLowerCase("he-IL").includes(search.toLocaleLowerCase("he-IL"))
    || String(p.sku??"").includes(search)
  );

  async function toggle(product,makeBlocked){
    if(busy)return;
    setBusy(product.id);
    try{
      const {error}=await supabase.rpc("sales_agent_set_product_block",{
        p_product_id:product.id,p_block:makeBlocked,
      });
      if(error)throw error;
      await queryClient.invalidateQueries({queryKey:["manager-agent-product-access"]});
      toast.success(makeBlocked?
        "המוצר נחסם לסוכנים בלבד; אצלך אין שינוי.":
        "חסימת הסוכנים הוסרה. מחיר ומלאי לא השתנו.");
    }catch(err){
      console.error("Agent product block update failed",err);
      toast.error("לא ניתן לעדכן חסימת מוצר לסוכנים.");
    }finally{setBusy("");}
  }

  if(!enabled)return <main dir="rtl" className="p-6">אין הרשאה לניהול מוצרים לסוכנים.</main>;
  return <main dir="rtl" className="mx-auto max-w-5xl p-4 md:p-7 space-y-5">
    <header>
      <h1 className="text-2xl font-bold">זמינות מוצרים לסוכנים</h1>
      <p className="mt-1 text-sm text-slate-600">
        החסימה כאן היא לסוכנים בלבד. המוצרים, המחירים, המלאי, המכירות
        ופורטל הלקוחות שלך אינם משתנים.
      </p>
    </header>
    <section className="bg-white rounded-xl border p-4 space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-medium">חיפוש מוצר או מק״ט</span>
        <input className="w-full rounded-lg border p-2"
          value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="חפש בקטלוג..."/>
      </label>
      {q.error&&<p className="text-red-700" role="alert">
        לא ניתן לאמת את רשימת החסימות. לא בוצעו שינויים.
      </p>}
      {q.isLoading&&<p>טוען מוצרים...</p>}
      {data&&!q.error&&<>
        <p className="text-xs text-slate-600">
          {data.products.length} מוצרים בקטלוג · {blocked.size} חסומים לסוכנים בלבד
        </p>
        <div className="space-y-1">
          {filtered.map(p=><div key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
            <div className="min-w-0 flex-1 text-sm">
              <strong>{p.name}</strong>
              <p className="text-xs text-slate-500">
                {p.sku?(`מק״ט ${p.sku} · `):""}
                {blocked.has(p.id)?"חסום לסוכנים":"לא חסום לסוכנים"}
                {" · "}{p.is_active?"פעיל אצלך":"לא פעיל בקטלוג שלך"}
              </p>
            </div>
            <button type="button" disabled={!!busy}
              className={blocked.has(p.id)?
                "rounded-lg border px-3 py-2 text-sm disabled:opacity-50":
                "rounded-lg border border-red-600 text-red-700 px-3 py-2 text-sm disabled:opacity-50"}
              onClick={()=>toggle(p,!blocked.has(p.id))}>
              {blocked.has(p.id)?"שחרר לסוכנים":"חסום לסוכנים"}
            </button>
          </div>)}
          {!filtered.length&&<p className="text-slate-500 text-sm">לא נמצאו מוצרים.</p>}
        </div>
      </>}
    </section>
  </main>;
}
