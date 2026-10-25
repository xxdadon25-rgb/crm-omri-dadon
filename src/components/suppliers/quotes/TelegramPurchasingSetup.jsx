import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";

/**
 * One-time Telegram transport setup ONLY. Bot chat happens in Telegram,
 * never in CRM. Admin actions require logged-in staff JWT at Edge Function.
 */
export default function TelegramPurchasingSetup() {
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState(false);
  const [telegramId, setTelegramId] = useState("");
  const [approved, setApproved] = useState(false);

  const call = async (body) => {
    const { data, error } = await supabase.functions.invoke("supplier-purchasing-telegram", { body });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "הפעולה נכשלה");
    return data;
  };
  const activate = async () => {
    setBusy(true);
    try {
      const result = await call({ action: "setup" });
      if (!result.connected) throw new Error("טלגרם לא אישר את כתובת החיבור");
      setActivated(true);
      toast.success("בוט הרכש מחובר לטלגרם");
    } catch (e) { toast.error(e?.message || "חיבור טלגרם נכשל"); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    const id = telegramId.trim();
    if (!/^\d{4,16}$/.test(id)) { toast.error("יש להכניס את מזהה המשתמש המספרי שקיבלת מהבוט"); return; }
    setBusy(true);
    try {
      await call({ action: "approve", telegram_user_id: id });
      setApproved(true);
      toast.success("משתמש הטלגרם אושר. כעת אפשר לדבר עם הבוט");
    } catch(e) { toast.error(e?.message || "אישור המשתמש נכשל"); }
    finally { setBusy(false); }
  };

  return <details dir="rtl" style={{margin:"12px 0",border:"1px solid #cbd5e1",borderRadius:12,padding:14}}>
    <summary style={{cursor:"pointer",fontSize:15,fontWeight:600}}>הגדרת בוט הרכש בטלגרם (חד־פעמי)</summary>
    <div style={{display:"grid",gap:12,paddingTop:12}}>
      <p style={{fontSize:13,margin:0,color:"#555"}}>כאן מחברים ומאשרים את הבוט בלבד. את כל בקשות הרכש תשלח בטלגרם. הבוט לא משנה מלאי ולא שולח הזמנות לספקים.</p>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <Button disabled={busy} onClick={activate}>{busy?"מתחבר...":"1. הפעל חיבור לטלגרם"}</Button>
        {activated && <span style={{color:"#15803d"}}>החיבור הופעל. פתח את הבוט שלך בטלגרם ושלח /start.</span>}
      </div>
      <div style={{display:"grid",gap:7}}>
        <label style={{fontSize:13}}>2. הבוט ישלח לך מזהה משתמש מספרי. הכנס אותו כאן כדי לאשר גישה למחירי הספקים:</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Input style={{maxWidth:250}} value={telegramId} onChange={e=>setTelegramId(e.target.value)} placeholder="מזהה משתמש מטלגרם" inputMode="numeric" />
          <Button variant="outline" disabled={busy || !telegramId.trim()} onClick={approve}>אשר חשבון טלגרם</Button>
        </div>
        {approved && <strong style={{fontSize:13,color:"#15803d"}}>החשבון אושר. עכשיו שלח לבוט בקשת רכש בעברית.</strong>}
      </div>
    </div>
  </details>;
}
