import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <div>
      <PageHeader title="הגדרות API" description="חיבור למערכות חיצוניות" />

      <div className="max-w-2xl space-y-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">חשבוניות חיצוניות</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            הגדר פרטי חיבור למערכת החשבוניות של רואה החשבון. לאחר ההגדרה יופיע כפתור "הפק חשבונית" בכל חשבונית.
          </p>

          <div className="space-y-4">
            {fields.map(({ key, label, placeholder, icon: Icon, type }) => (
              <div key={key} className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" /> {label}
                </Label>
                <Input
                  dir="ltr"
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-border">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 ml-1" /> {saving ? "שומר..." : "שמירת הגדרות API"}
            </Button>
          </div>
        </div>

        {form.api_url && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">API מוגדר</p>
              <p className="text-xs text-green-600 dir-ltr">{form.api_url}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}