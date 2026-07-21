import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, User, Phone, Mail, Building2, ArrowRight, ChevronLeft, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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

  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const ACCENT = "#F5885E";
  const labelStyle = { fontSize: 12, color: "var(--heillo-text-muted)", fontWeight: 500, display: "block", marginBottom: 6, fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div className="h-screen bg-background flex flex-col"> */
    <div className="h-screen flex flex-col" style={{ background: "var(--heillo-bg-gradient)", fontFamily: "'Heebo', sans-serif" }} dir="rtl">

      {/* Header */}
      {/* OLD: <div style={{ background: "#FFFFFF", borderBottom: "1px solid rgba(0,0,0,0.05)", ... }}> */}
      <div style={{ background: "transparent", padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="w-4 h-4 ml-1" /> חזרה
        </Button>
        <div>
          {/* OLD: <h1 className="text-xl font-bold"> */}
          <h1 style={{ fontSize: 18, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>בחירת לקוח</h1>
          {/* OLD: <p className="text-sm text-muted-foreground"> */}
          <p style={{ fontSize: 12, color: MUTED, margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{customers.length} לקוחות · בחר לקוח קיים או צור לקוח חדש</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden max-w-3xl mx-auto w-full">
        {mode === "select" ? (
          <>
            {/* Sticky search + new customer bar */}
            {/* OLD: <div style={{ background: "#FFFFFF", borderBottom: "1px solid rgba(0,0,0,0.05)", ... }}> */}
            <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", padding: "12px 24px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: MUTED, pointerEvents: "none" }} />
                  {/* OLD: <Input placeholder="..." className="pr-9 h-11" autoFocus /> */}
                  <input
                    className="heillo-input"
                    placeholder="חיפוש לפי שם, טלפון, ח.פ..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ paddingRight: 36, height: 40, width: "100%" }}
                    autoFocus
                  />
                </div>
                {selected.size > 0 && (
                  /* OLD: <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}> */
                  <button
                    onClick={() => setBulkDeleteOpen(true)}
                    style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 12, padding: "0 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif", flexShrink: 0 }}
                  >
                    <Trash2 style={{ width: 14, height: 14 }} /> מחק {selected.size}
                  </button>
                )}
                {/* OLD: <Button onClick={() => setMode("create")} variant="outline"> */}
                <button className="heillo-btn-primary" onClick={() => setMode("create")} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <Plus style={{ width: 14, height: 14 }} /> לקוח חדש
                </button>
              </div>
            </div>

            {/* Scrollable customer list */}
            <div className="flex-1 overflow-y-auto thin-scrollbar" style={{ padding: "16px 24px" }}>
            {isLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                {/* OLD: <div className="w-7 h-7 border-4 border-muted border-t-primary rounded-full animate-spin" /> */}
                <div style={{ width: 28, height: 28, border: "4px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              </div>
            ) : filtered.length === 0 ? (
              /* OLD: <div className="text-center py-12 text-muted-foreground"> */
              <div style={{ textAlign: "center", padding: "48px 0", color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
                <User style={{ width: 40, height: 40, margin: "0 auto 12px", opacity: 0.3 }} />
                <p style={{ fontSize: 14, margin: "0 0 16px" }}>לא נמצאו לקוחות</p>
                {/* OLD: <Button size="sm" variant="outline" className="mt-4" onClick={() => setMode("create")}> */}
                <button className="heillo-btn-primary" onClick={() => setMode("create")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Plus style={{ width: 13, height: 13 }} /> צור לקוח חדש
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filtered.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Checkbox */}
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={(e) => toggleSelect(c.id, e)}
                    />

                    {/* Customer row */}
                    {/* OLD: <button className="flex-1 text-right bg-card border border-border rounded-xl px-4 py-3.5 hover:border-primary hover:bg-primary/5 transition-all flex items-center gap-4 group"> */}
                    <button
                      onClick={() => onConfirm(c)}
                      style={{ flex: 1, textAlign: "right", background: "#FFFFFF", borderRadius: 16, border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s ease", fontFamily: "'Heebo', sans-serif" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,136,94,0.04)"; e.currentTarget.style.borderColor = ACCENT; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "rgba(0,0,0,0.05)"; }}
                    >
                      {/* OLD: <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"> */}
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(245,136,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <User style={{ width: 18, height: 18, color: ACCENT }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* OLD: <div className="font-semibold"> */}
                        <div style={{ fontWeight: 600, fontSize: 14, color: DARK }}>{c.name}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", marginTop: 3 }}>
                          {c.phone && <span style={{ fontSize: 11, color: MUTED, display: "flex", alignItems: "center", gap: 4 }}><Phone style={{ width: 11, height: 11 }} />{c.phone}</span>}
                          {c.email && <span style={{ fontSize: 11, color: MUTED, display: "flex", alignItems: "center", gap: 4 }}><Mail style={{ width: 11, height: 11 }} />{c.email}</span>}
                          {c.tax_id && <span style={{ fontSize: 11, color: MUTED, display: "flex", alignItems: "center", gap: 4 }}><Building2 style={{ width: 11, height: 11 }} />ח.פ {c.tax_id}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {/* OLD: <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.customer_type === "עסקי" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}> */}
                          <span className="heillo-badge" style={c.customer_type === "עסקי" ? { background: "rgba(59,130,246,0.1)", color: "#1d4ed8" } : { background: "rgba(22,163,74,0.1)", color: "#15803d" }}>
                            {c.customer_type || "פרטי"}
                          </span>
                          {c.is_blocked && (
                            /* OLD: <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">חסום</span> */
                            <span className="heillo-badge" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>חסום</span>
                          )}
                        </div>
                        {c.discount_percent > 0 && (
                          /* OLD: <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium"> */
                          <span className="heillo-badge" style={{ background: "rgba(245,136,94,0.1)", color: ACCENT }}>
                            הנחה {c.discount_percent}%
                          </span>
                        )}
                      </div>
                      <ChevronLeft style={{ width: 15, height: 15, color: MUTED, flexShrink: 0 }} />
                    </button>

                    {/* Delete button */}
                    {/* OLD: <button className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"> */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteId(c.id); }}
                      style={{ padding: 8, background: "none", border: "none", cursor: "pointer", color: MUTED, flexShrink: 0, transition: "color 0.15s ease" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = MUTED; }}
                    >
                      <Trash2 style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto thin-scrollbar" style={{ padding: "16px 24px" }}>
            {/* OLD: <div className="bg-card border border-border rounded-xl p-6 space-y-5"> */}
            <div className="heillo-card" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <Button variant="ghost" size="sm" onClick={() => setMode("select")}>
                  <ArrowRight className="w-4 h-4 ml-1" /> חזרה
                </Button>
                {/* OLD: <h2 className="font-bold text-lg">לקוח חדש</h2> */}
                <h2 style={{ fontSize: 16, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>לקוח חדש</h2>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  {/* OLD: <Label>שם לקוח *</Label><Input .../> */}
                  <label style={labelStyle}>שם לקוח *</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="שם מלא / שם חברה" />
                </div>
                <div>
                  {/* OLD: <Label>סוג לקוח</Label> */}
                  <label style={labelStyle}>סוג לקוח</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["פרטי", "עסקי"].map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setNewCustomer({ ...newCustomer, customer_type: type })}
                        /* OLD: className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${...}`} */
                        style={{
                          flex: 1, height: 40, borderRadius: 12, border: "1px solid", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.15s ease", fontFamily: "'Heebo', sans-serif",
                          background: newCustomer.customer_type === type ? (type === "עסקי" ? "rgba(59,130,246,0.1)" : "rgba(22,163,74,0.1)") : "#FFFFFF",
                          borderColor: newCustomer.customer_type === type ? (type === "עסקי" ? "rgba(59,130,246,0.4)" : "rgba(22,163,74,0.4)") : "rgba(0,0,0,0.08)",
                          color: newCustomer.customer_type === type ? (type === "עסקי" ? "#1d4ed8" : "#15803d") : MUTED,
                        }}
                      >
                        {type === "פרטי" ? "👤 פרטי" : "🏢 עסקי"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>ח.פ / ת.ז</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.tax_id} onChange={(e) => setNewCustomer({ ...newCustomer, tax_id: e.target.value })} placeholder="מספר זיהוי" />
                </div>
                <div>
                  <label style={labelStyle}>טלפון</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="03-XXXXXXX" />
                </div>
                <div>
                  <label style={labelStyle}>נייד</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.mobile} onChange={(e) => setNewCustomer({ ...newCustomer, mobile: e.target.value })} placeholder="05X-XXXXXXX" />
                </div>
                <div>
                  <label style={labelStyle}>אימייל</label>
                  <input className="heillo-input" style={{ width: "100%" }} type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} placeholder="email@example.com" />
                </div>
                <div>
                  <label style={labelStyle}>עיר</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} placeholder="עיר" />
                </div>
                <div>
                  <label style={labelStyle}>הנחה קבועה %</label>
                  <input className="heillo-input" style={{ width: "100%" }} type="number" min="0" max="100" value={newCustomer.discount_percent} onChange={(e) => setNewCustomer({ ...newCustomer, discount_percent: parseFloat(e.target.value) || 0 })} placeholder="0" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>כתובת</label>
                  <input className="heillo-input" style={{ width: "100%" }} value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="כתובת מלאה" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>הערות</label>
                  <Textarea value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} rows={2} placeholder="הערות על הלקוח" style={{ width: "100%", fontFamily: "'Heebo', sans-serif", fontSize: 13 }} />
                </div>
              </div>

              {/* OLD: <div className="flex justify-end gap-3 pt-2 border-t border-border"> */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 16, marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                {/* OLD: <Button variant="outline" onClick={() => setMode("select")}>ביטול</Button> */}
                <button
                  onClick={() => setMode("select")}
                  style={{ background: "#FFFFFF", border: `1px solid rgba(245,136,94,0.4)`, borderRadius: 12, color: ACCENT, fontSize: 13, fontWeight: 500, padding: "8px 18px", cursor: "pointer", fontFamily: "'Heebo', sans-serif" }}
                >
                  ביטול
                </button>
                {/* OLD: <Button onClick={handleCreate} disabled={saving}> */}
                <button className="heillo-btn-primary" onClick={handleCreate} disabled={saving} style={{ opacity: saving ? 0.7 : 1 }}>
                  {saving ? "שומר..." : "צור לקוח והמשך"}
                </button>
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
