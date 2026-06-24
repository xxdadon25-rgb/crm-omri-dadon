import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Save, Link2, Eye, EyeOff, Lock, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: settings = [] } = useQuery({ queryKey: ["settings"], queryFn: () => base44.entities.BusinessSettings.list() });
  const existing = settings[0];

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
  const { user } = useAuth();

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
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(prev => ({ ...prev, logo_url: file_url }));
  };

  const handleSave = async () => {
    setSaving(true);
    const data = { ...form, vat_rate: parseFloat(form.vat_rate) || 17 };
    if (existing?.id) {
      await base44.entities.BusinessSettings.update(existing.id, data);
    } else {
      await base44.entities.BusinessSettings.create(data);
    }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    toast.success("ההגדרות נשמרו");
  };

  const handleChangeCode = async () => {
    if (!currentCodeInput) {
      toast.error("יש להזין את הקוד הנוכחי");
      return;
    }
    if (currentCodeInput !== form.profitability_access_code) {
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
      const data = { ...form, profitability_access_code: newCodeInput };
      if (existing?.id) {
        await base44.entities.BusinessSettings.update(existing.id, data);
      }
      setForm(prev => ({ ...prev, profitability_access_code: newCodeInput }));
      setCurrentCodeInput("");
      setNewCodeInput("");
      setConfirmCodeInput("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("קוד הגישה עודכן בהצלחה");
    } finally {
      setSavingCode(false);
    }
  };

  return (
    <div>
      <PageHeader title="הגדרות" description="הגדרות עסק ומערכת" />

      <div className="bg-card rounded-xl border border-border p-6 max-w-2xl">
        <h3 className="font-semibold mb-4">פרטי העסק</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-1.5">
            <Label>לוגו</Label>
            <div className="flex items-center gap-4">
              {form.logo_url && <img src={form.logo_url} alt="לוגו" className="w-20 h-20 rounded-lg object-contain bg-muted p-1" />}
              <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors text-sm">
                <Upload className="w-4 h-4" /> העלאת לוגו
                <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
              </label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>שם העסק *</Label>
            <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>ח.פ / ע.מ</Label>
            <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>טלפון</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>אימייל</Label>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>כתובת</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          <h3 className="sm:col-span-2 font-semibold mt-4">הגדרות מסמכים</h3>
          <div className="space-y-1.5">
            <Label>אחוז מע״מ</Label>
            <Input type="number" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>מונה הצעות מחיר (אחרון)</Label>
            <Input type="number" value={form.quote_counter} onChange={(e) => setForm({ ...form, quote_counter: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label>מונה חשבוניות (אחרון)</Label>
            <Input type="number" value={form.invoice_counter} onChange={(e) => setForm({ ...form, invoice_counter: parseInt(e.target.value) || 0 })} />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 ml-1" /> {saving ? "שומר..." : "שמירת הגדרות"}
          </Button>
        </div>
      </div>

      {/* Security */}
      {user?.role === "admin" && (
        <div className="bg-card rounded-xl border border-border p-6 max-w-2xl mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">אבטחה</h3>
          </div>

          <div className="space-y-6">
            {/* Profitability Access Code */}
            <div>
              <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                📊 גישה לנתוני רווחיות
              </h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>קוד נוכחי</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showCurrentCode ? "text" : "password"}
                      value={currentCodeInput}
                      onChange={(e) => setCurrentCodeInput(e.target.value)}
                      placeholder="הקלד קוד נוכחי"
                    />
                    <button
                      onClick={() => setShowCurrentCode(!showCurrentCode)}
                      className="px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showCurrentCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>קוד חדש</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showNewCode ? "text" : "password"}
                      value={newCodeInput}
                      onChange={(e) => setNewCodeInput(e.target.value)}
                      placeholder="הקלד קוד חדש"
                    />
                    <button
                      onClick={() => setShowNewCode(!showNewCode)}
                      className="px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showNewCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>אישור קוד חדש</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showConfirmCode ? "text" : "password"}
                      value={confirmCodeInput}
                      onChange={(e) => setConfirmCodeInput(e.target.value)}
                      placeholder="אשר קוד חדש"
                    />
                    <button
                      onClick={() => setShowConfirmCode(!showConfirmCode)}
                      className="px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button onClick={handleChangeCode} disabled={savingCode} className="w-full">
                  {savingCode ? "מעדכן..." : "עדכן קוד גישה"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price Migration Tool */}
      {user?.role === "admin" && (
        <div className="bg-card rounded-xl border border-amber-200 p-6 max-w-2xl mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold flex items-center gap-2">🔄 כלי מיגרציית מחירים</h3>
              <p className="text-sm text-muted-foreground mt-1">המרת מחירי מוצרים קיימים מכולל מע״מ לפני מע״מ (חד-פעמי, בטוח)</p>
            </div>
            <Button variant="outline" onClick={() => navigate("/price-migration")} className="border-amber-300 text-amber-700 hover:bg-amber-50 gap-2">
              פתח כלי מיגרציה <ArrowLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* API Integration */}
      <div className="bg-card rounded-xl border border-border p-6 max-w-2xl mt-6">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">חיבור API — חשבוניות חיצוניות</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">הגדר פרטי חיבור למערכת החשבוניות של רואה החשבון שלך. לאחר ההגדרה יופיע כפתור "הפק חשבונית" בכל חשבונית.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-1.5">
            <Label>API URL</Label>
            <Input
              dir="ltr"
              placeholder="https://api.example.com/invoices"
              value={form.api_url}
              onChange={(e) => setForm({ ...form, api_url: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              dir="ltr"
              type="password"
              placeholder="your-api-key"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Secret Key</Label>
            <Input
              dir="ltr"
              type="password"
              placeholder="your-secret-key"
              value={form.api_secret}
              onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Company ID</Label>
            <Input
              dir="ltr"
              placeholder="12345"
              value={form.api_company_id}
              onChange={(e) => setForm({ ...form, api_company_id: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={handleSave} disabled={saving} variant="outline">
            <Save className="w-4 h-4 ml-1" /> {saving ? "שומר..." : "שמירת הגדרות API"}
          </Button>
        </div>
      </div>
    </div>
  );
}