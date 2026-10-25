import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/api/supabaseClient";

export default function PurchasingAssistantTester({ suppliers = [] }) {
  const [message,setMessage]=useState("");
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const names=Object.fromEntries(suppliers.map(s=>[s.id,s.name]));
  const fmt=n=>Number(n).toLocaleString("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2});
  const send=async()=>{
    if(!message.trim()||busy)return;
    setBusy(true);setResult(null);
    try{
      const {data,error}=await supabase.functions.invoke("supplier-purchasing-assistant",{body:{message:message.trim()}});
      if(error)throw error;
      if(!data?.ok)throw new Error(data?.message||data?.error||"הבקשה נכשלה");
      setResult(data);
    }catch(e){setResult({error:e.message||"נכשלה הבדיקה"});}
    finally{setBusy(false)}
  };
  return <section dir="rtl" style={{padding:16,border:"1px solid #ddd",borderRadius:12,display:"grid",gap:12,background:"#fafafa"}}>
    <strong style={{fontSize:18}}>בדיקת עוזר הרכש — לפני חיבור לטלגרם</strong>
    <p style={{margin:0,color:"#555",fontSize:13}}>כתוב בקשת רכש בעברית. המנוע בודק מוצרים ומחירים, ושואל אם לא ברור מה ביקשת. לא נשלחות הזמנות לספקים.</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <Input style={{flex:"1 1 280px"}} value={message} onChange={e=>setMessage(e.target.value)}
        placeholder="אני צריך קרטון שקיות אשפה 75/90 וכוסות ברד..." onKeyDown={e=>{if(e.key==="Enter")send()}} />
      <Button onClick={send} disabled={busy||!message.trim()}>{busy?"בודק...":"שאל את העוזר"}</Button>
    </div>
    {result?.error&&<p role="alert" style={{color:"#b91c1c"}}>שגיאה בבדיקה: {result.error}</p>}
    {result?.items?.map((item,index)=><div key={index} style={{padding:12,border:"1px solid #e5e7eb",borderRadius:9,background:"white",display:"grid",gap:7}}>
      <strong>{item.name} · {item.qty} {item.unit==="carton"?"קרטון":item.unit==="pack"?"חבילה":item.unit==="unit"?"יחידה":"כמות לא ברורה"}</strong>
      {item.result?.status==="clarify"?
        <div style={{color:"#92400e"}}>{item.result.question}
          {item.result.options?.length>0&&<p style={{fontSize:12}}>אפשרויות שנמצאו: {item.result.options.join(" · ")}</p>}
        </div>:
        item.result?.status==="matched"?<>
          <strong style={{fontSize:13}}>מוצר מאומת: {item.result.product}</strong>
          {item.result.offers.map((offer,i)=><div key={offer.quote_item_id} style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"space-between"}}>
            <span>{names[offer.supplier_id]||"ספק"} {i===0?"· המחיר הנמוך":""}</span>
            <strong>{fmt(offer.total_before_vat)} ₪ לפני מע״מ</strong>
            <span style={{fontSize:11,color:"#666"}}>מסמך {offer.document_number||"—"}</span>
          </div>)}
          <span style={{fontSize:11,color:"#666"}}>{item.result.notice}</span>
        </>:<span>אין תוצאה מאומתת.</span>}
    </div>)}
  </section>;
}