import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Save, Link2, ShieldCheck, Globe, Key } from "lucide-react";
import { toast } from "sonner";

export default function ApiSettings() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ api_url: "", api_key: "", api_secret: "", api_company_id: "" });

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
  });

  useEffect(() => {
    if (settings[0]) {
      setForm({
        api_url: settings[0].api_url || "",
        api_key: settings[0].api_key || "",
        api_secret: settings[0].api_secret || "",
        api_company_id: settings[0].api_company_id || "",
      });
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    if (settings[0]) {
      await base44.entities.BusinessSettings.update(settings[0].id, form);
    } else {
      await base44.entities.BusinessSettings.create({ business_name: "עסק", ...form });
    }
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    toast.success("הגדרות API נשמרו");
    setSaving(false);
  };

  const fields = [
    { key: "api_url", label: "API URL", placeholder: "https://api.example.com/invoices", icon: Globe, type: "text" },
    { key: "api_key", label: "API Key", placeholder: "your-api-key", icon: Key, type: "password" },
    { key: "api_secret", label: "Secret Key", placeholder: "your-secret-key", icon: ShieldCheck, type: "password" },
    { key: "api_company_id", label: "Company ID", placeholder: "12345", icon: Link2, type: "text" },
  ];

  const DARK  = "#120F1C";
  const MUTED = "#B2B0B1";
  const ACCENT = "#F5885E";
  const labelStyle = { fontSize: 12, color: "var(--heillo-text-muted)", fontWeight: 500, display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl" style={{ maxWidth: 680 }}>

      {/* OLD: <PageHeader title="הגדרות API" description="חיבור למערכות חיצוניות" /> */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>הגדרות API</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "3px 0 0", fontFamily: "'Heebo', sans-serif" }}>חיבור למערכות חיצוניות</p>
      </div>

      {/* OLD: <div className="max-w-2xl space-y-6"> */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* OLD: <div className="bg-card border border-border rounded-xl p-6"> */}
        <div className="heillo-card" style={{ padding: 24 }}>
          {/* OLD: <div className="flex items-center gap-2 mb-1"><Link2 className="w-5 h-5 text-primary" /><h3 className="font-semibold">חשבוניות חיצוניות</h3></div> */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Link2 style={{ width: 18, height: 18, color: ACCENT }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>חשבוניות חיצוניות</h3>
          </div>
          {/* OLD: <p className="text-sm text-muted-foreground mb-5"> */}
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 20px", fontFamily: "'Heebo', sans-serif" }}>
            הגדר פרטי חיבור למערכת החשבוניות של רואה החשבון. לאחר ההגדרה יופיע כפתור "הפק חשבונית" בכל חשבונית.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {fields.map(({ key, label, placeholder, icon: Icon, type }) => (
              /* OLD: <div key={key} className="space-y-1.5"> */
              <div key={key}>
                {/* OLD: <Label className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-muted-foreground" /> {label}</Label> */}
                <label style={labelStyle}>
                  <Icon style={{ width: 13, height: 13, color: MUTED }} /> {label}
                </label>
                {/* OLD: <Input dir="ltr" type={type} placeholder={placeholder} value={form[key]} onChange={...} /> */}
                <input
                  className="heillo-input"
                  dir="ltr"
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            ))}
          </div>

          {/* OLD: <div className="mt-6 pt-4 border-t border-border"><Button onClick={handleSave} disabled={saving}> */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
            <button className="heillo-btn-primary" onClick={handleSave} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: saving ? 0.7 : 1 }}>
              <Save style={{ width: 14, height: 14 }} /> {saving ? "שומר..." : "שמירת הגדרות API"}
            </button>
          </div>
        </div>

        {form.api_url && (
          /* OLD: <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3"> */
          <div style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 16, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <ShieldCheck style={{ width: 18, height: 18, color: "#16a34a", flexShrink: 0 }} />
            <div>
              {/* OLD: <p className="text-sm font-medium text-green-800">API מוגדר</p> */}
              <p style={{ fontSize: 13, fontWeight: 600, color: "#15803d", margin: 0, fontFamily: "'Heebo', sans-serif" }}>API מוגדר</p>
              {/* OLD: <p className="text-xs text-green-600 dir-ltr">{form.api_url}</p> */}
              <p style={{ fontSize: 11, color: "#16a34a", margin: "2px 0 0", fontFamily: "monospace", direction: "ltr", textAlign: "left" }}>{form.api_url}</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}