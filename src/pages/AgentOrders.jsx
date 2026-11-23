import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AGENT_FEATURES_ENABLED } from "@/lib/agentFeatureFlags";
import { buildAgentLine, agentOrderSignature } from "@/lib/agentOrderForm";

const money = value => Number(value ?? 0).toLocaleString("he-IL", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function showError(err) {
  const msg=String(err?.message ?? err ?? "");
  const codes={
    customer_not_assigned:"הלקוח אינו משויך אליך.",
    product_not_found:"המוצר לא נמצא או אינו זמין.",
    cost_missing:"חסר מחיר קנייה למוצר. יש לעדכן מנהל.",
    sale_unit_needs_clarification:"יחידת הקנייה והמכירה דורשות בירור לפני הזמנה.",
    inconsistent_line_total:"נתוני סכום שורה אינם תואמים את המחיר והכמות.",
    exception_payload_or_prices_changed:"המחירים השתנו מאז האישור. יש לבקש אישור חדש.",
    exception_not_approved:"החריגה עדיין לא אושרה.",
    exception_already_consumed:"האישור כבר נוצל להזמנה אחרת.",
    margin_exception_not_required:"ההזמנה עומדת בדרישת הרווחיות; אין צורך בחריגה.",
    agent_not_active:"חשבון הסוכן אינו פעיל.",
  };
  const key=Object.keys(codes).find(k=>msg.includes(k));
  return key ? codes[key] : "הפעולה לא הושלמה. לא נוצרה הזמנה; בדוק את הנתונים ונסה שוב.";
}

async function loadAgentProducts() {
  const { data, error }=await supabase.from("products")
    .select("id,name,sku,buy_price,sell_price,is_active,quantity")
    .eq("is_active",true).order("name");
  if(error)throw error;
  return data??[];
}
async function loadAgentCustomers() {
  const { data, error }=await supabase.from("customers")
    .select("id,name,city,phone,is_active").order("name");
  if(error)throw error;
  return data??[];
}
async function loadAgentExceptions() {
  const { data, error }=await supabase.from("sales_agent_margin_exceptions")
    .select("id,customer_id,margin_pct,status,reason,requested_at,created_order_id")
    .order("requested_at",{ascending:false}).limit(50);
  if(error)throw error;
  return data??[];
}

export default function AgentOrders() {
  const { crmRole }=useAuth();
  const allowed=AGENT_FEATURES_ENABLED && crmRole==="agent";
  const queryClient=useQueryClient();
  const [customerId,setCustomerId]=useState("");
  const [productId,setProductId]=useState("");
  const [qty,setQty]=useState("1");
  const [unitPrice,setUnitPrice]=useState("");
  const [discount,setDiscount]=useState("0");
  const [items,setItems]=useState([]);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const requestIds=useRef(new Map());

  const customersQ=useQuery({
    queryKey:["agent-customers"],queryFn:loadAgentCustomers,enabled:allowed,
  });
  const productsQ=useQuery({
    queryKey:["agent-products"],queryFn:loadAgentProducts,enabled:allowed,
  });
  const exceptionQ=useQuery({
    queryKey:["agent-own-exceptions"],queryFn:loadAgentExceptions,enabled:allowed,
    refetchInterval:allowed?30000:false,
  });

  const products=productsQ.data??[];
  const customers=customersQ.data??[];
  const selectedProduct=products.find(p=>p.id===productId);
  const formSignature=agentOrderSignature(customerId,items);
  const canPreview=allowed && !!customerId && items.length>0;
  const marginQ=useQuery({
    queryKey:["agent-server-margin",formSignature],
    queryFn:async()=>{
      const {data,error}=await supabase.rpc("sales_agent_check_order_margin",{
        p_customer_id:customerId,p_items:items,p_document_discount_net:0,
      });
      if(error)throw error;
      const margin=Array.isArray(data)?data[0]:data;
      if(!margin)throw Error("margin_result_missing");
      return margin;
    },
    enabled:canPreview,
    retry:false,
  });
  const margin=canPreview?marginQ.data:null;
  const currentCustomers=useMemo(()=>Object.fromEntries(
    customers.map(c=>[c.id,c.name])
  ),[customers]);

  function selectProduct(id) {
    setProductId(id);
    const product=products.find(p=>p.id===id);
    setUnitPrice(product?.sell_price == null?"":String(product.sell_price));
  }

  function addLine() {
    const item=buildAgentLine({product:selectedProduct,
      quantity:qty,unitPrice,discount});
    if(!item){toast.error("יש לבחור מוצר, כמות ומחיר מכירה תקינים");return;}
    setItems(prev=>[...prev,item]);
    setProductId("");
    setQty("1");setUnitPrice("");setDiscount("0");
  }

  function uniqueRequestId(kind,signature) {
    const key=kind+":"+signature;
    if(!requestIds.current.has(key))requestIds.current.set(key,crypto.randomUUID());
    return requestIds.current.get(key);
  }

  async function submit() {
    if(!canPreview || busy || marginQ.isFetching || marginQ.isError || !margin){
      toast.error("יש להמתין לבדיקת רווחיות תקינה");return;
    }
    const exceptionRequired=margin.needs_manager_exception===true;
    if(!margin.allowed && !exceptionRequired){
      toast.error("לא ניתן לבצע הזמנה ללא נתוני רווחיות תקינים");return;
    }
    if(exceptionRequired && !reason.trim()){
      toast.error("יש לרשום סיבה לבקשת החריגה");return;
    }

    setBusy(true);
    try{
      const isException=exceptionRequired;
      const requestId=uniqueRequestId(isException?"exception":"order",
        formSignature);
      const {error}=isException
        ?await supabase.rpc("sales_agent_request_margin_exception",{
          p_request_id:requestId,p_customer_id:customerId,
          p_items:items,p_reason:reason.trim(),
        })
        :await supabase.rpc("sales_agent_create_order",{
          p_request_id:requestId,p_customer_id:customerId,
          p_items:items,p_document_discount_net:0,p_notes:null,
        });
      if(error)throw error;

      toast.success(isException
        ?"בקשת החריגה נשלחה. לא נוצרה הזמנה ולא השתנה המלאי."
        :"ההזמנה נשמרה והועברה לתור האספקה.");
      requestIds.current.clear();
      setItems([]);setReason("");
      await queryClient.invalidateQueries({queryKey:["agent-own-exceptions"]});
      await queryClient.invalidateQueries({queryKey:["sales-agent-delivery-alerts"]});
    }catch(err){
      console.error("Agent order submission failed",err);
      toast.error(showError(err));
    }finally{setBusy(false);}
  }

  async function completeApproved(exception) {
    if(busy || exception.status!=="approved" || exception.created_order_id)return;
    setBusy(true);
    try{
      const orderId=uniqueRequestId("approved",exception.id);
      const {error}=await supabase.rpc("sales_agent_create_approved_exception_order",{
        p_exception_id:exception.id,p_order_id:orderId,
      });
      if(error)throw error;
      toast.success("ההזמנה המאושרת נוצרה והועברה לתור האספקה.");
      await queryClient.invalidateQueries({queryKey:["agent-own-exceptions"]});
    }catch(err){
      console.error("Agent approved exception order failed",err);
      toast.error(showError(err));
    }finally{setBusy(false);}
  }

  if(!allowed)return <main dir="rtl" className="p-6">אין הרשאה למסך הזמנות הסוכן.</main>;

  return (
    <main dir="rtl" className="max-w-5xl mx-auto p-4 md:p-7 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">הזמנות סוכן</h1>
        <p className="text-slate-600 text-sm mt-1">
          נבדקת הרווחיות הכוללת לפני מע״מ. מתחת ל־40% נשלחת בקשת חריגה לעומרי או לבן.
        </p>
      </header>

      <section className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-bold">הזמנה חדשה</h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium">לקוח משויך</span>
          <select className="w-full rounded-lg border p-2 bg-white" value={customerId}
            disabled={busy} onChange={e=>setCustomerId(e.target.value)}>
            <option value="">בחר לקוח</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {(customersQ.error||productsQ.error)&&
          <p role="alert" className="text-red-700">לא ניתן לטעון את נתוני הסוכן. בדוק הרשאות וחיבור.</p>}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="sm:col-span-2 space-y-1">
            <span className="block text-sm font-medium">מוצר</span>
            <select className="w-full rounded-lg border p-2 bg-white" value={productId}
              onChange={e=>selectProduct(e.target.value)} disabled={busy}>
              <option value="">בחר מוצר</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">כמות</span>
            <input type="number" min="0.001" step="any" className="w-full rounded-lg border p-2"
              value={qty} disabled={busy} onChange={e=>setQty(e.target.value)}/>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">מחיר מכירה לפני מע״מ (₪)</span>
            <input type="number" min="0" step="any" className="w-full rounded-lg border p-2"
              value={unitPrice} disabled={busy} onChange={e=>setUnitPrice(e.target.value)}/>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">הנחה בשורה (%)</span>
            <input type="number" min="0" max="100" step="any"
              className="w-full rounded-lg border p-2" value={discount}
              disabled={busy} onChange={e=>setDiscount(e.target.value)}/>
          </label>
        </div>
        <button type="button" onClick={addLine} disabled={busy || !selectedProduct}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40">
          הוסף מוצר להזמנה
        </button>
        {items.length>0&&<div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead><tr className="border-b">
              <th className="p-2">מוצר</th><th className="p-2">כמות</th>
              <th className="p-2">מחיר</th><th className="p-2">הנחה</th>
              <th className="p-2">סה״כ לפני מע״מ</th><th className="p-2">פעולה</th>
            </tr></thead>
            <tbody>{items.map((it,i)=><tr key={i} className="border-b">
              <td className="p-2">{it.name}</td><td className="p-2">{it.quantity}</td>
              <td className="p-2">₪{money(it.unit_price)}</td>
              <td className="p-2">{it.discount}%</td>
              <td className="p-2">₪{money(it.total)}</td>
              <td className="p-2"><button type="button" className="text-red-700 underline"
                disabled={busy} onClick={()=>setItems(old=>old.filter((_,index)=>index!==i))}>הסר</button></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {items.length>0&&<p className="font-semibold">
          סה״כ לפני מע״מ: ₪{money(items.reduce((sum,item)=>sum+item.total,0))}
        </p>}
        {canPreview&&<div className="rounded-lg bg-slate-50 p-3 text-sm">
          {marginQ.isFetching&&"בודק רווחיות בשרת..."}
          {marginQ.isError&&<span className="text-red-700">
            לא ניתן לאמת רווחיות: {showError(marginQ.error)}
          </span>}
          {!marginQ.isFetching&&!marginQ.isError&&margin&&
            <span className={margin.allowed?"text-green-700":"text-orange-700"}>
              רווחיות כוללת לפני מע״מ: {Number(margin.margin_percent).toFixed(2)}%
              {margin.allowed?" — ניתן לשמור הזמנה":" — נדרש אישור חריגה"}
            </span>}
        </div>}
        {margin?.needs_manager_exception===true&&!marginQ.isFetching&&
          <label className="block space-y-1">
            <span className="block text-sm font-semibold">סיבה לחריגה (חובה)</span>
            <textarea rows={2} maxLength={1000} value={reason} disabled={busy}
              onChange={e=>setReason(e.target.value)}
              className="w-full rounded-lg border p-2"
              placeholder="למה יש לאשר את ההזמנה במחיר הזה?"/>
          </label>}
        <button type="button" onClick={submit}
          disabled={busy||!canPreview||marginQ.isFetching||marginQ.isError||!margin}
          className="rounded-lg bg-orange-600 px-5 py-2.5 text-white font-semibold disabled:opacity-40">
          {busy?"שולח...":margin?.needs_manager_exception?"שלח בקשת חריגה":"שמור הזמנה"}
        </button>
        <p className="text-xs text-slate-500">
          לא מופחת מלאי בעת יצירת ההזמנה. לא ניתן לאשר עלות חסרה או יחידות מכירה לא ברורות.
        </p>
      </section>

      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-bold">בקשות החריגה שלי</h2>
        {exceptionQ.isLoading&&<p className="text-sm">טוען...</p>}
        {exceptionQ.error&&<p role="alert" className="text-red-700 text-sm">
          לא ניתן לטעון בקשות חריגה.
        </p>}
        {!exceptionQ.isLoading&&!exceptionQ.error&&exceptionQ.data?.length===0&&
          <p className="text-slate-500 text-sm">עדיין אין בקשות חריגה.</p>}
        {exceptionQ.data?.map(ex=><div key={ex.id} className="border-t py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <strong>{currentCustomers[ex.customer_id]??"לקוח"}</strong>
            <span className="text-slate-600"> · רווחיות {Number(ex.margin_pct).toFixed(2)}% · </span>
            <span>{ex.created_order_id?"נוצרה הזמנה":ex.status==="approved"?"אושר":ex.status==="rejected"?"נדחה":"ממתין לאישור"}</span>
          </div>
          {ex.status==="approved"&&!ex.created_order_id&&
            <button type="button" disabled={busy} onClick={()=>completeApproved(ex)}
              className="rounded-lg bg-green-700 px-3 py-2 text-white disabled:opacity-40">
              צור הזמנה מאושרת
            </button>}
        </div>)}
      </section>
    </main>
  );
}
