import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Save, Link2, Eye, EyeOff, Lock, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("business_settings")
        .select("*")
        .eq("user_id", user.id)
        .limit(1);
      if (data?.[0]) {
        setExisting(data[0]);
      }
    })();
  }, [user]);

  const [form, setForm] = useState({
    business_name: "", logo_url: "", phone: "", email: "",
    address: "", tax_id: "", vat_rate: 17, quote_counter: 1000, invoice_counter: 1000,
    api_url: "", api_key: "", api_secret: "", api_company_id: "",
    profitability_access_code: "1234",
  });
  const [saving, setSaving] = useState(false);
  const [currentCodeInput, setCurrentCodeInput] = useState("");
  const [newCodeInput, setNewCodeInput] = useState("");
  const [confirmCodeInput, setConfirmCodeInput] = useState("");
  const [showCurrentCode, setShowCurrentCode] = useState(false);
  const [showNewCode, setShowNewCode] = useState(false);
  const [showConfirmCode, setShowConfirmCode] = useState(false);
  const [savingCode, setSavingCode] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm({
        business_name: existing.business_name || "",
        logo_url: existing.logo_url || "",
        phone: existing.phone || "",
        email: existing.email || "",
        address: existing.address || "",
        tax_id: existing.tax_id || "",
        vat_rate: existing.vat_rate ?? 17,
        quote_counter: existing.quote_counter ?? 1000,
        invoice_counter: existing.invoice_counter ?? 1000,
        api_url: existing.api_url || "",
        api_key: existing.api_key || "",
        api_secret: existing.api_secret || "",
        api_company_id: existing.api_company_id || "",
        profitability_access_code: existing.profitability_access_code || "1234",
      });
    }
  }, [existing]);

  const handleLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileExt = file.name.split(".").pop();
    const fileName = `logo_${user.id}.${fileExt}`;
    const { data, error } = await supabase.storage.from("logos").upload(fileName, file, { upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from("logos").getPublicUrl(fileName);
      setForm(prev => ({ ...prev, logo_url: urlData.publicUrl }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const data = { ...form, vat_rate: parseFloat(form.vat_rate) || 18, user_id: user.id };
    if (existing?.id) {
      await supabase.from("business_settings").update(data).eq("id", existing.id);
    } else {
      await supabase.from("business_settings").insert(data);
    }
    setSaving(false);
    toast.success("ההגדרות נשמרו");
  };

  const handleChangeCode = async () => {
    console.log("[handleChangeCode] called", {
      currentCodeInput,
      storedCode: form.profitability_access_code,
      newCodeInput,
      confirmCodeInput,
      existingId: existing?.id,
    });
    if (!currentCodeInput) {
      toast.error("יש להזין את הקוד הנוכחי");
      return;
    }
    if (currentCodeInput !== form.profitability_access_code) {
      console.log("[handleChangeCode] code mismatch — entered:", currentCodeInput, "stored:", form.profitability_access_code);
      toast.error("הקוד הנוכחי שגוי");
      return;
    }
    if (!newCodeInput) {
      toast.error("יש להזין קוד חדש");
      return;
    }
    if (newCodeInput !== confirmCodeInput) {
      toast.error("הקודים החדשים לא תואמים");
      return;
    }
    if (newCodeInput.length < 4) {
      toast.error("הקוד חייב להיות לפחות 4 תווים");
      return;
    }

    setSavingCode(true);
    try {
      let dbError = null;
      if (existing?.id) {
        console.log("[handleChangeCode] updating existing record id:", existing.id, "new code:", newCodeInput);
        const { error } = await supabase.from("business_settings")
          .update({ profitability_access_code: newCodeInput })
          .eq("id", existing.id);
        console.log("[handleChangeCode] update result error:", error);
        dbError = error;
      } else {
        console.log("[handleChangeCode] no existing record — inserting new");
        const { error } = await supabase.from("business_settings")
          .insert({ profitability_access_code: newCodeInput, user_id: user.id });
        console.log("[handleChangeCode] insert result error:", error);
        dbError = error;
      }
      if (dbError) {
        toast.error("שגיאה בשמירה: " + dbError.message);
        return;
      }
      setForm(prev => ({ ...prev, profitability_access_code: newCodeInput }));
      setCurrentCodeInput("");
      setNewCodeInput("");
      setConfirmCodeInput("");
      toast.success("קוד הגישה עודכן בהצלחה");
    } finally {
      setSavingCode(false);
    }
  };

  const DARK  = "#120F1C";
  const MUTED = "#B2B0B1";
  const ACCENT = "#F5885E";

  const labelStyle = { fontSize: 12, color: "var(--heillo-text-muted)", fontWeight: 500, display: "block", marginBottom: 6, fontFamily: "'Heebo', sans-serif" };
  const sectionTitle = { fontSize: 16, fontWeight: 700, color: "var(--heillo-text-primary)", margin: "0 0 16px", fontFamily: "'Heebo', sans-serif" };
  const fieldGap = { display: "flex", flexDirection: "column", gap: 0 };
  const eyeBtn = { padding: "0 10px", background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex", alignItems: "center" };

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl" style={{ maxWidth: 680 }}>

      {/* OLD: <PageHeader title="הגדרות" description="הגדרות עסק ומערכת" /> */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>הגדרות</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "3px 0 0", fontFamily: "'Heebo', sans-serif" }}>הגדרות עסק ומערכת</p>
      </div>

      {/* Business details card */}
      {/* OLD: <div className="bg-card rounded-xl border border-border p-6 max-w-2xl"> */}
      <div className="heillo-card" style={{ padding: 24, marginBottom: 20 }}>
        {/* OLD: <h3 className="font-semibold mb-4">פרטי העסק</h3> */}
        <h3 style={sectionTitle}>פרטי העסק</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1", ...fieldGap }}>
            {/* OLD: <Label>לוגו</Label> */}
            <label style={labelStyle}>לוגו</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {form.logo_url && (
                /* OLD: <img ... className="w-20 h-20 rounded-lg object-contain bg-muted p-1" /> */
                <img src={form.logo_url} alt="לוגו" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "contain", background: "#F5F3F6", padding: 6 }} />
              )}
              {/* OLD: <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors text-sm"> */}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", border: "1.5px dashed rgba(0,0,0,0.12)", borderRadius: 12, cursor: "pointer", fontSize: 13, color: MUTED, fontFamily: "'Heebo', sans-serif", transition: "background 0.15s ease" }}>
                <Upload style={{ width: 15, height: 15 }} /> העלאת לוגו
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogo} />
              </label>
            </div>
          </div>
          <div style={fieldGap}>
            {/* OLD: <Label>שם העסק *</Label><Input .../> */}
            <label style={labelStyle}>שם העסק *</label>
            <input className="heillo-input" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>ח.פ / ע.מ</label>
            <input className="heillo-input" value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>טלפון</label>
            <input className="heillo-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>אימייל</label>
            <input className="heillo-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div style={{ gridColumn: "1 / -1", ...fieldGap }}>
            <label style={labelStyle}>כתובת</label>
            <input className="heillo-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          {/* OLD: <h3 className="sm:col-span-2 font-semibold mt-4">הגדרות מסמכים</h3> */}
          <h3 style={{ ...sectionTitle, gridColumn: "1 / -1", marginTop: 8, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>הגדרות מסמכים</h3>
          <div style={fieldGap}>
            <label style={labelStyle}>אחוז מע״מ</label>
            <input className="heillo-input" type="number" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>מונה הצעות מחיר (אחרון)</label>
            <input className="heillo-input" type="number" value={form.quote_counter} onChange={(e) => setForm({ ...form, quote_counter: parseInt(e.target.value) || 0 })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>מונה חשבוניות (אחרון)</label>
            <input className="heillo-input" type="number" value={form.invoice_counter} onChange={(e) => setForm({ ...form, invoice_counter: parseInt(e.target.value) || 0 })} />
          </div>
        </div>

        {/* OLD: <div className="mt-6 pt-4 border-t border-border"><Button onClick={handleSave}...> */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
          <button className="heillo-btn-primary" onClick={handleSave} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: saving ? 0.7 : 1 }}>
            <Save style={{ width: 14, height: 14 }} /> {saving ? "שומר..." : "שמירת הגדרות"}
          </button>
        </div>
      </div>

      {/* Security card */}
      {/* OLD: <div className="bg-card rounded-xl border border-border p-6 max-w-2xl mt-6"> */}
      <div className="heillo-card" style={{ padding: 24, marginBottom: 20 }}>
        {/* OLD: <div className="flex items-center gap-2 mb-4"><Lock .../><h3 className="font-semibold">אבטחה</h3></div> */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Lock style={{ width: 18, height: 18, color: ACCENT }} />
          <h3 style={{ ...sectionTitle, margin: 0 }}>אבטחה</h3>
        </div>

        {/* OLD: <h4 className="text-sm font-medium mb-4 flex items-center gap-2">📊 גישה לנתוני רווחיות</h4> */}
        <h4 style={{ fontSize: 13, fontWeight: 600, color: DARK, margin: "0 0 14px", fontFamily: "'Heebo', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
          📊 גישה לנתוני רווחיות
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={fieldGap}>
            {/* OLD: <Label>קוד נוכחי</Label><div className="flex gap-2"><Input .../><button className="px-3 text-muted-foreground..."> */}
            <label style={labelStyle}>קוד נוכחי</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="heillo-input" style={{ flex: 1 }} type={showCurrentCode ? "text" : "password"} value={currentCodeInput} onChange={(e) => setCurrentCodeInput(e.target.value)} placeholder="הקלד קוד נוכחי" />
              <button style={eyeBtn} onClick={() => setShowCurrentCode(!showCurrentCode)}>
                {showCurrentCode ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>קוד חדש</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="heillo-input" style={{ flex: 1 }} type={showNewCode ? "text" : "password"} value={newCodeInput} onChange={(e) => setNewCodeInput(e.target.value)} placeholder="הקלד קוד חדש" />
              <button style={eyeBtn} onClick={() => setShowNewCode(!showNewCode)}>
                {showNewCode ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>אישור קוד חדש</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="heillo-input" style={{ flex: 1 }} type={showConfirmCode ? "text" : "password"} value={confirmCodeInput} onChange={(e) => setConfirmCodeInput(e.target.value)} placeholder="אשר קוד חדש" />
              <button style={eyeBtn} onClick={() => setShowConfirmCode(!showConfirmCode)}>
                {showConfirmCode ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
              </button>
            </div>
          </div>
          {/* OLD: <Button onClick={handleChangeCode} disabled={savingCode} className="w-full"> */}
          <button className="heillo-btn-primary" onClick={handleChangeCode} disabled={savingCode} style={{ width: "100%", justifyContent: "center", opacity: savingCode ? 0.7 : 1 }}>
            {savingCode ? "מעדכן..." : "עדכן קוד גישה"}
          </button>
        </div>
      </div>

      {/* Price Migration Tool */}
      {user?.role === "admin" && (
        /* OLD: <div className="bg-card rounded-xl border border-amber-200 p-6 max-w-2xl mt-6"> */
        <div className="heillo-card" style={{ padding: 24, marginBottom: 20, borderColor: "rgba(245,136,94,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              {/* OLD: <h3 className="font-semibold flex items-center gap-2"> */}
              <h3 style={{ ...sectionTitle, margin: "0 0 4px" }}>🔄 כלי מיגרציית מחירים</h3>
              {/* OLD: <p className="text-sm text-muted-foreground mt-1"> */}
              <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>המרת מחירי מוצרים קיימים מכולל מע״מ לפני מע״מ (חד-פעמי, בטוח)</p>
            </div>
            {/* OLD: <Button variant="outline" onClick={() => navigate("/price-migration")} className="border-amber-300 text-amber-700..."> */}
            <button
              onClick={() => navigate("/price-migration")}
              style={{ background: "#FFFFFF", border: "1px solid rgba(245,136,94,0.4)", borderRadius: 12, color: ACCENT, fontSize: 13, fontWeight: 500, padding: "8px 16px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "'Heebo', sans-serif", flexShrink: 0 }}
            >
              פתח כלי מיגרציה <ArrowLeft style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
      )}

      {/* API Integration card */}
      {/* OLD: <div className="bg-card rounded-xl border border-border p-6 max-w-2xl mt-6"> */}
      <div className="heillo-card" style={{ padding: 24 }}>
        {/* OLD: <div className="flex items-center gap-2 mb-4"><Link2 .../><h3 className="font-semibold">חיבור API...</h3></div> */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Link2 style={{ width: 18, height: 18, color: ACCENT }} />
          <h3 style={{ ...sectionTitle, margin: 0 }}>חיבור API — חשבוניות חיצוניות</h3>
        </div>
        {/* OLD: <p className="text-sm text-muted-foreground mb-4"> */}
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", fontFamily: "'Heebo', sans-serif" }}>הגדר פרטי חיבור למערכת החשבוניות של רואה החשבון שלך. לאחר ההגדרה יופיע כפתור "הפק חשבונית" בכל חשבונית.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1", ...fieldGap }}>
            <label style={labelStyle}>API URL</label>
            <input className="heillo-input" dir="ltr" placeholder="https://api.example.com/invoices" value={form.api_url} onChange={(e) => setForm({ ...form, api_url: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>API Key</label>
            <input className="heillo-input" dir="ltr" type="password" placeholder="your-api-key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>Secret Key</label>
            <input className="heillo-input" dir="ltr" type="password" placeholder="your-secret-key" value={form.api_secret} onChange={(e) => setForm({ ...form, api_secret: e.target.value })} />
          </div>
          <div style={fieldGap}>
            <label style={labelStyle}>Company ID</label>
            <input className="heillo-input" dir="ltr" placeholder="12345" value={form.api_company_id} onChange={(e) => setForm({ ...form, api_company_id: e.target.value })} />
          </div>
        </div>
        {/* OLD: <div className="mt-4"><Button onClick={handleSave} disabled={saving} variant="outline"> */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
          <button className="heillo-btn-primary" onClick={handleSave} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: saving ? 0.7 : 1 }}>
            <Save style={{ width: 14, height: 14 }} /> {saving ? "שומר..." : "שמירת הגדרות API"}
          </button>
        </div>
      </div>
    </div>
  );
}