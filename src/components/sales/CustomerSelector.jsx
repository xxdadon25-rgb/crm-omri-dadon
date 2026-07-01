import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, User, Phone, Mail, Building2, ArrowRight, ChevronLeft, Trash2, Check } from "lucide-react";
import { toast } from "sonner";

export default function CustomerSelector({ onConfirm, onBack }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("select");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "", customer_type: "פרטי", phone: "", mobile: "", email: "", address: "", city: "", tax_id: "", notes: "", discount_percent: 0, is_active: true
  });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const result = await base44.entities.Customer.list("-created_date");
      const pending = sessionStorage.getItem("pendingCustomer");
      if (!pending) return result;
      const pendingCustomer = JSON.parse(pending);
      if (result.some(c => c.id === pendingCustomer.id)) {
        const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
        if (ageMs >= 180000) sessionStorage.removeItem("pendingCustomer");
        return result;
      }
      return [pendingCustomer, ...result];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return customers.filter(c => c.is_active !== false);
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.mobile?.includes(q) ||
      c.tax_id?.includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleDelete = async () => {
    const idToDelete = deleteId;
    setDeleteId(null);
    try {
      await base44.entities.Customer.delete(idToDelete);
      queryClient.setQueryData(["customers"], (old = []) => (old || []).filter(c => c.id !== idToDelete));
      toast.success("לקוח נמחק");
    } catch {
      toast.error("שגיאה במחיקת הלקוח");
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected];
    setSelected(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Customer.delete(id)));
    queryClient.setQueryData(["customers"], (old = []) => (old || []).filter(c => !ids.includes(c.id)));
    toast.success(`${ids.length} לקוחות נמחקו`);
  };

  const handleCreate = async () => {
    if (!newCustomer.name.trim()) { toast.error("שם לקוח נדרש"); return; }
    setSaving(true);
    const created = await base44.entities.Customer.create(newCustomer);
    queryClient.setQueryData(["customers"], (old = []) => [created, ...old]);
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    toast.success("לקוח נוצר בהצלחה");
    setSaving(false);
    onConfirm(created);
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="w-4 h-4 ml-1" /> חזרה
        </Button>
        <div>
          <h1 className="text-xl font-bold">בחירת לקוח</h1>
          <p className="text-sm text-muted-foreground">{customers.length} לקוחות · בחר לקוח קיים או צור לקוח חדש</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden max-w-3xl mx-auto w-full">
        {mode === "select" ? (
          <>
            {/* OLD - can restore: remove sticky wrapper, move back into space-y-4 div */}
            {/* Sticky search + new customer bar */}
            <div className="sticky top-0 z-10 bg-background px-6 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="חיפוש לפי שם, טלפון, ח.פ..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-9 h-11"
                    autoFocus
                  />
                </div>
                {selected.size > 0 && (
                  <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                    <Trash2 className="w-4 h-4 ml-1" /> מחק {selected.size}
                  </Button>
                )}
                <Button onClick={() => setMode("create")} variant="outline">
                  <Plus className="w-4 h-4 ml-1" /> לקוח חדש
                </Button>
              </div>
            </div>

            {/* Scrollable customer list */}
            <div className="flex-1 overflow-y-auto thin-scrollbar px-6 py-4">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 border-4 border-muted border-t-primary rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>לא נמצאו לקוחות</p>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setMode("create")}>
                  <Plus className="w-4 h-4 ml-1" /> צור לקוח חדש
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                {filtered.map((c) => (
                  <div key={c.id} className="relative flex items-center gap-2">
                    {/* Checkbox */}
                    <button
                      onClick={(e) => toggleSelect(c.id, e)}
                      className="w-5 h-5 border border-input rounded flex items-center justify-center shrink-0 hover:bg-muted transition-colors"
                      style={{ backgroundColor: selected.has(c.id) ? "hsl(var(--primary))" : "transparent" }}
                    >
                      {selected.has(c.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>

                    {/* Customer row */}
                    <button
                      onClick={() => onConfirm(c)}
                      className="flex-1 text-right bg-card border border-border rounded-xl px-4 py-3.5 hover:border-primary hover:bg-primary/5 transition-all flex items-center gap-4 group"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{c.name}</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                          {c.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                          {c.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                          {c.tax_id && <span className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" />ח.פ {c.tax_id}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.customer_type === "עסקי" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                            {c.customer_type || "פרטי"}
                          </span>
                          {c.is_blocked && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">חסום</span>
                          )}
                        </div>
                        {c.discount_percent > 0 && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                            הנחה {c.discount_percent}%
                          </span>
                        )}
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteId(c.id); }}
                      className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto thin-scrollbar px-6 py-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}>
                <ArrowRight className="w-4 h-4 ml-1" /> חזרה
              </Button>
              <h2 className="font-bold text-lg">לקוח חדש</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>שם לקוח *</Label>
                <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="שם מלא / שם חברה" />
              </div>
              <div className="space-y-1.5">
                <Label>סוג לקוח</Label>
                <div className="flex gap-2">
                  {["פרטי", "עסקי"].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setNewCustomer({ ...newCustomer, customer_type: type })}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${newCustomer.customer_type === type ? (type === "עסקי" ? "bg-blue-100 border-blue-300 text-blue-700" : "bg-green-100 border-green-300 text-green-700") : "border-border text-muted-foreground hover:bg-muted"}`}
                    >
                      {type === "פרטי" ? "👤 פרטי" : "🏢 עסקי"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>ח.פ / ת.ז</Label>
                <Input value={newCustomer.tax_id} onChange={(e) => setNewCustomer({ ...newCustomer, tax_id: e.target.value })} placeholder="מספר זיהוי" />
              </div>
              <div className="space-y-1.5">
                <Label>טלפון</Label>
                <Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="03-XXXXXXX" />
              </div>
              <div className="space-y-1.5">
                <Label>נייד</Label>
                <Input value={newCustomer.mobile} onChange={(e) => setNewCustomer({ ...newCustomer, mobile: e.target.value })} placeholder="05X-XXXXXXX" />
              </div>
              <div className="space-y-1.5">
                <Label>אימייל</Label>
                <Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} placeholder="email@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>עיר</Label>
                <Input value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} placeholder="עיר" />
              </div>
              <div className="space-y-1.5">
                <Label>הנחה קבועה %</Label>
                <Input type="number" min="0" max="100" value={newCustomer.discount_percent} onChange={(e) => setNewCustomer({ ...newCustomer, discount_percent: parseFloat(e.target.value) || 0 })} placeholder="0" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>כתובת</Label>
                <Input value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="כתובת מלאה" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>הערות</Label>
                <Textarea value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} rows={2} placeholder="הערות על הלקוח" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setMode("select")}>ביטול</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "שומר..." : "צור לקוח והמשך"}
              </Button>
            </div>
          </div>
          </div>
        )}
      </div>

      {/* Single delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת לקוח</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק את הלקוח?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete}>מחק</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת לקוחות</AlertDialogTitle>
            <AlertDialogDescription>מחיקת {selected.size} לקוחות?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <Button variant="destructive" onClick={handleBulkDelete}>מחק</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
