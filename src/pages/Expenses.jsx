import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Plus, Search, Trash2, Pencil, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import EmptyState from "@/components/shared/EmptyState";
import ExpenseDialog from "@/components/expenses/ExpenseDialog";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/formatCurrency";

// Suggestions only — category stays free text, so anything typed is kept.
const DEFAULT_CATEGORIES = [
  "רכישות ספקים", "דלק", "שכירות", "חשמל", "פרסום",
  "ציוד", "תחזוקה ותיקונים", "עמלות ובנק", "ביטוח", "אחר",
];

export default function Expenses() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  // Newest first. RLS already limits this to the logged-in user's rows.
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .eq("user_id", user?.id)
        .order("date", { ascending: false })
        .order("created_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Supplier-sourced expenses point at a delivery that already holds the
  // scanned document. The file is read through that link — never re-uploaded
  // and never copied.
  const deliveryIds = useMemo(
    () => [...new Set(expenses.map(e => e.supplier_delivery_id).filter(Boolean))],
    [expenses]
  );

  const [deliveryFiles, setDeliveryFiles] = useState({});
  useEffect(() => {
    let cancelled = false;
    if (deliveryIds.length === 0) { setDeliveryFiles({}); return; }
    supabase
      .from("supplier_deliveries")
      .select("id, file_url")
      .in("id", deliveryIds)
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        (data || []).forEach(d => { if (d.file_url) map[d.id] = d.file_url; });
        setDeliveryFiles(map);
      });
    return () => { cancelled = true; };
  }, [deliveryIds]);

  const categories = useMemo(() => {
    const used = new Set(expenses.map(e => e.category).filter(Boolean));
    return [...new Set([...DEFAULT_CATEGORIES, ...used])];
  }, [expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter(e => {
      const matchSearch = !q || [e.payee, e.description, e.document_number]
        .some(f => f?.toLowerCase().includes(q));
      const matchCat = categoryFilter === "all" || e.category === categoryFilter;
      const matchFrom = !fromDate || (e.date && e.date >= fromDate);
      const matchTo = !toDate || (e.date && e.date <= toDate);
      return matchSearch && matchCat && matchFrom && matchTo;
    });
  }, [expenses, search, categoryFilter, fromDate, toDate]);

  // The headline figure, and the one the dashboard will later mirror: the sum
  // of amount_net over exactly what is on screen. Never derived from gross.
  const totalNet = useMemo(
    () => filtered.reduce((sum, e) => sum + (Number(e.amount_net) || 0), 0),
    [filtered]
  );

  const handleDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    try {
      // Removes the expense row only. The linked supplier delivery, its file,
      // stock movements, price history and every invoice stay exactly as they
      // are — nothing else references this row.
      await base44.entities.Expense.delete(id);
      queryClient.setQueryData(["expenses"], (old = []) => old.filter(e => e.id !== id));
      toast.success("ההוצאה נמחקה");
    } catch (err) {
      toast.error("שגיאה במחיקת ההוצאה");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    }
  };

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const CARD_STYLE = {
    background: "#FFFFFF",
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.03)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    overflow: "hidden",
    fontFamily: "'Heebo', sans-serif",
  };
  const inputStyle = {
    background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14,
    height: 40, padding: "0 14px", fontSize: 13, color: DARK,
    fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box",
  };
  const th = { padding: "14px 20px", textAlign: "right", fontWeight: 500, fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" };
  const td = { padding: "14px 20px", fontSize: 13, color: DARK };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0", fontFamily: "'Heebo', sans-serif", padding: 32, paddingTop: 24 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: DARK, margin: 0 }}>הוצאות</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{filtered.length} רשומות</p>
        </div>
        <button
          onClick={() => { setEditExpense(null); setDialogOpen(true); }}
          style={{ background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, fontWeight: 600, padding: "8px 18px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "opacity 0.2s ease" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <Plus style={{ width: 16, height: 16 }} /> הוצאה חדשה
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
          <input
            placeholder="חיפוש לפי ספק, תיאור או מספר מסמך..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%", padding: "0 40px 0 14px" }}
          />
        </div>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, minWidth: 150 }} aria-label="מתאריך" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, minWidth: 150 }} aria-label="עד תאריך" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", minWidth: 160 }}>
            <SelectValue placeholder="קטגוריה" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Filtered total ──────────────────────────────────────────────── */}
      <div style={{ ...CARD_STYLE, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>סה״כ הוצאות לפני מע״מ</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: ACCENT }}>{formatCurrency(totalNet)}</span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={search ? Search : null} title={search ? "לא נמצאו תוצאות" : "אין הוצאות"} description={search ? "נסה חיפוש אחר" : "הוסף הוצאה ראשונה"} />
      ) : (
        <div style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  {["תאריך","קטגוריה","ספק / בית עסק","סכום לפני מע״מ","מע״מ","סה״כ כולל מע״מ","מספר מסמך","מסמך","פעולות"].map(col => (
                    <th key={col} style={th}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const fileUrl = e.supplier_delivery_id ? deliveryFiles[e.supplier_delivery_id] : null;
                  return (
                    <tr key={e.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{e.date}</td>
                      <td style={td}>
                        {e.category && (
                          <span style={{ borderRadius: 99, fontSize: 11, fontWeight: 600, padding: "3px 10px", background: "rgba(0,0,0,0.05)", color: DARK, display: "inline-block", whiteSpace: "nowrap" }}>{e.category}</span>
                        )}
                      </td>
                      <td style={td}>{e.payee || "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{formatCurrency(e.amount_net)}</td>
                      <td style={{ ...td, color: MUTED }}>{e.vat_amount == null ? "—" : formatCurrency(e.vat_amount)}</td>
                      <td style={td}>{e.amount_gross == null ? "—" : formatCurrency(e.amount_gross)}</td>
                      <td style={{ ...td, fontSize: 12, color: MUTED }}>{e.document_number || "—"}</td>
                      <td style={td}>
                        {fileUrl ? (
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>
                            <ExternalLink style={{ width: 13, height: 13 }} /> צפה במסמך
                          </a>
                        ) : (
                          <span style={{ fontSize: 12, color: MUTED }}>—</span>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {[
                            { icon: Pencil, action: () => { setEditExpense(e); setDialogOpen(true); }, title: "עריכה" },
                            { icon: Trash2, action: () => setDeleteId(e.id), title: "מחיקה", danger: true },
                          ].map(({ icon: Icon, action, title, danger }) => (
                            <button key={title} onClick={action} title={title}
                              style={{ background: "transparent", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: danger ? "#ef4444" : MUTED, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                              onMouseEnter={ev => { ev.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "rgba(0,0,0,0.04)"; ev.currentTarget.style.color = danger ? "#ef4444" : DARK; }}
                              onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = danger ? "#ef4444" : MUTED; }}
                            >
                              <Icon style={{ width: 18, height: 18, strokeWidth: 1.8 }} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editExpense}
        categories={categories}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["expenses"] })}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הוצאה</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את ההוצאה? הפעולה מוחקת את רישום ההוצאה בלבד — מסמך הספק, המלאי והחשבוניות אינם מושפעים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק הוצאה</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
