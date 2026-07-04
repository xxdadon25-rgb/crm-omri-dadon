import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, FolderOpen, FileText, ExternalLink, X } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { getPaymentStatusColor, getOrderStatusColor } from "@/utils/statusColors";

const TYPE_META = {
  quote:        { label: "הצעת מחיר", badge: "bg-blue-100 text-blue-700",   pdfBase: "/quote-pdf/" },
  order:        { label: "הזמנה",     badge: "bg-amber-100 text-amber-700",  pdfBase: "/order-pdf/" },
  invoice:      { label: "חשבונית",   badge: "bg-green-100 text-green-700",  pdfBase: "/invoice-pdf/" },
  supplier_doc: { label: "מסמך ספק",  badge: "bg-gray-100 text-gray-600",    pdfBase: "" },
};

function docNumber(doc, type) {
  if (type === "quote")        return doc.quote_number   ? `#${doc.quote_number}`   : "—";
  if (type === "order")        return doc.order_number   ? `#${doc.order_number}`   : "—";
  if (type === "invoice")      return doc.invoice_number ? `#${doc.invoice_number}` : "—";
  if (type === "supplier_doc") return doc.id ? `מסמך-${doc.id.slice(0, 6)}` : "—";
  return "—";
}

function docDate(doc, type) {
  if (type === "supplier_doc") return doc.delivery_date ? doc.delivery_date.slice(0, 10) : (doc.created_at ? doc.created_at.slice(0, 10) : "");
  const raw = doc.date;
  if (!raw) return "";
  return raw.slice(0, 10);
}

function docStatus(doc, type) {
  if (type === "quote")        return { label: doc.status || "—",         className: "bg-gray-100 text-gray-700" };
  if (type === "order")        return { label: doc.status || "—",         className: getOrderStatusColor(doc.status) };
  if (type === "invoice")      return { label: doc.payment_status || "—", className: getPaymentStatusColor(doc.payment_status) };
  if (type === "supplier_doc") return { label: doc.status || "—",         className: "bg-gray-100 text-gray-600" };
  return { label: "—", className: "" };
}

function fmtDisplayDate(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10).split("-").reverse().join("/");
}

const HIDDEN_QUERY_KEY = ["document_center_hidden"];

export default function DocumentCenter() {
  const queryClient = useQueryClient();

  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");

  // Selection state for bulk hide
  const [selected, setSelected] = useState(new Set());

  // Single-hide confirmation dialog
  const [confirmDoc, setConfirmDoc] = useState(null); // { id, _type } | null
  const [hiding, setHiding]         = useState(false);

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: quotes = [],   isLoading: lq } = useQuery({ queryKey: ["quotes"],   queryFn: () => base44.entities.Quote.list("-created_date") });
  const { data: orders = [],   isLoading: lo } = useQuery({ queryKey: ["orders"],   queryFn: () => base44.entities.Order.list("-created_date") });
  const { data: invoices = [], isLoading: li } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list("-created_date") });

  const { data: suppliers = [], isLoading: ls } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
  });

  const { data: supplierDocs = [], isLoading: lsd } = useQuery({
    queryKey: ["supplier_deliveries_docs"],
    queryFn: async () => {
      const suppList = await base44.entities.Supplier.list();
      if (!suppList?.length) return [];
      const ids = suppList.map(s => s.id);
      const { data, error } = await supabase
        .from("supplier_deliveries")
        .select("id,supplier_id,delivery_date,file_url,status,created_at")
        .in("supplier_id", ids)
        .order("delivery_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: hiddenDocs = [], isLoading: lh } = useQuery({
    queryKey: HIDDEN_QUERY_KEY,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("document_center_hidden")
        .select("document_type,document_id")
        .eq("user_id", user?.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Set of "type:id" strings for O(1) lookup
  const hiddenSet = useMemo(() => {
    const s = new Set();
    hiddenDocs.forEach(h => s.add(`${h.document_type}:${h.document_id}`));
    return s;
  }, [hiddenDocs]);

  const supplierMap = useMemo(() => {
    const m = {};
    suppliers.forEach(s => { m[s.id] = s.name; });
    return m;
  }, [suppliers]);

  const loading = lq || lo || li || ls || lsd || lh;

  const unified = useMemo(() => {
    const rows = [
      ...quotes.map(d       => ({ ...d, _type: "quote" })),
      ...orders.map(d       => ({ ...d, _type: "order" })),
      ...invoices.map(d     => ({ ...d, _type: "invoice" })),
      ...supplierDocs.filter(d => d.file_url).map(d => ({ ...d, _type: "supplier_doc" })),
    ];
    rows.sort((a, b) => {
      const da = docDate(a, a._type);
      const db = docDate(b, b._type);
      return db.localeCompare(da);
    });
    // Filter out hidden documents
    return rows.filter(d => !hiddenSet.has(`${d._type}:${d.id}`));
  }, [quotes, orders, invoices, supplierDocs, hiddenSet]);

  const filtered = useMemo(() => {
    return unified.filter(doc => {
      if (typeFilter !== "all" && doc._type !== typeFilter) return false;
      const q = search.toLowerCase();
      if (q) {
        const name = doc._type === "supplier_doc"
          ? (supplierMap[doc.supplier_id] || "").toLowerCase()
          : (doc.customer_name || "").toLowerCase();
        const num  = docNumber(doc, doc._type).toLowerCase();
        if (!name.includes(q) && !num.includes(q)) return false;
      }
      const d = docDate(doc, doc._type);
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo   && d && d > dateTo)   return false;
      return true;
    });
  }, [unified, typeFilter, search, dateFrom, dateTo, supplierMap]);

  // ── Hide helpers ──────────────────────────────────────────────────────────

  async function hideDocuments(docs) {
    const { data: { user } } = await supabase.auth.getUser();
    const rows = docs.map(d => ({
      user_id:       user.id,
      document_type: d._type,
      document_id:   d.id,
      hidden_at:     new Date().toISOString(),
    }));
    const { error } = await supabase.from("document_center_hidden").insert(rows);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: HIDDEN_QUERY_KEY });
  }

  async function handleConfirmHide() {
    if (!confirmDoc) return;
    setHiding(true);
    try {
      await hideDocuments([confirmDoc]);
    } finally {
      setHiding(false);
      setConfirmDoc(null);
    }
  }

  async function handleBulkHide() {
    const docs = unified.filter(d => selected.has(`${d._type}:${d.id}`));
    if (!docs.length) return;
    setHiding(true);
    try {
      await hideDocuments(docs);
      setSelected(new Set());
    } finally {
      setHiding(false);
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelect(doc) {
    const key = `${doc._type}:${doc.id}`;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(d => `${d._type}:${d.id}`)));
    }
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  // ── Heillo design tokens ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const selectStyle = { background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div dir="rtl"><div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]"> */
    <div className="heillo-page" dir="rtl">

      {/* ── Top bar ── */}
      {/* OLD: <div className="sticky top-0 z-10 bg-background shadow-md border-b border-gray-200 pb-3"><PageHeader .../><div className="bg-card border border-border rounded-xl p-4 mt-1"> */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>מרכז מסמכים</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{unified.length} מסמכים</p>
      </div>

      {/* ── Filters row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>

        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
          {/* OLD: <Input placeholder="חיפוש לקוח / מספר..." className="pr-9" /> */}
          <input placeholder="חיפוש לקוח / מספר..." value={search} onChange={e => setSearch(e.target.value)}
            className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 40 }} />
        </div>

        {/* Type filter */}
        {/* OLD: <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue .../></SelectTrigger> */}
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger style={selectStyle}><SelectValue placeholder="סוג מסמך" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסוגים</SelectItem>
            <SelectItem value="quote">הצעות מחיר</SelectItem>
            <SelectItem value="order">הזמנות</SelectItem>
            <SelectItem value="invoice">חשבוניות</SelectItem>
            <SelectItem value="supplier_doc">מסמכי ספק</SelectItem>
          </SelectContent>
        </Select>

        {/* Date from */}
        {/* OLD: <Input type="date" value={dateFrom} onChange={...} placeholder="מתאריך" /> */}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="heillo-input" style={{ width: "100%", boxSizing: "border-box" }} />

        {/* Date to + bulk button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* OLD: <Input type="date" value={dateTo} onChange={...} placeholder="עד תאריך" className="flex-1" /> */}
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="heillo-input" style={{ flex: 1, minWidth: 0 }} />
          {selected.size > 0 && (
            /* OLD: <Button variant="outline" size="sm" className="shrink-0 border-amber-400 text-amber-700 hover:bg-amber-50" onClick={handleBulkHide} disabled={hiding}> */
            <button onClick={handleBulkHide} disabled={hiding}
              style={{ flexShrink: 0, background: "transparent", border: `1px solid ${ACCENT}`, borderRadius: 10, color: ACCENT, fontSize: 12, fontWeight: 500, padding: "6px 12px", cursor: "pointer", fontFamily: "'Heebo', sans-serif", whiteSpace: "nowrap" }}>
              הסר מסומנים ({selected.size})
            </button>
          )}
        </div>

      </div>

      {/* ── Content ── */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FolderOpen} title="אין מסמכים" description="לא נמצאו מסמכים התואמים את הסינון" />
      ) : (
        /* OLD: <div className="bg-card rounded-xl border border-border overflow-hidden"> */
        <div className="heillo-card">
          <div style={{ overflowX: "auto" }}>
            {/* OLD: <Table><TableHeader><TableRow className="bg-muted/50"> */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              <thead className="heillo-table-header">
                <tr>
                  <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="בחר הכל" />
                  </th>
                  {["סוג", "מספר", "לקוח / ספק", "תאריך", "סכום", "סטטוס", "מסמכים", ""].map((col, i) => (
                    <th key={i} style={{ padding: "14px 20px", textAlign: "right", whiteSpace: "nowrap", width: col === "" ? 40 : undefined }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc, i) => {
                  const key       = `${doc._type}:${doc.id}`;
                  const meta      = TYPE_META[doc._type];
                  const status    = docStatus(doc, doc._type);
                  const partyName = doc._type === "supplier_doc"
                    ? (supplierMap[doc.supplier_id] || "—")
                    : (doc.customer_name || "—");
                  return (
                    /* OLD: <TableRow key={key} className="hover:bg-muted/30"> */
                    <tr key={key} className="heillo-table-row"
                      style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                      <td style={{ padding: "14px 20px", textAlign: "center" }}>
                        <Checkbox checked={selected.has(key)} onCheckedChange={() => toggleSelect(doc)} aria-label="בחר שורה" />
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <Badge className={meta.badge}>{meta.label}</Badge> */}
                        <span className={`heillo-badge ${meta.badge}`}>{meta.label}</span>
                      </td>
                      {/* OLD: <TableCell className="font-medium text-right"> */}
                      <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: 13, color: DARK }}>{docNumber(doc, doc._type)}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK }}>{partyName}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{fmtDisplayDate(docDate(doc, doc._type))}</td>
                      <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 500, color: DARK }}>
                        {doc._type === "supplier_doc" ? "—" : formatCurrency(doc.total)}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <Badge className={status.className}>{status.label}</Badge> */}
                        <span className={`heillo-badge ${status.className}`}>{status.label}</span>
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <div className="flex items-center gap-1 justify-end"> */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          {doc._type === "supplier_doc" ? (
                            /* OLD: <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(doc.file_url, "_blank")} title="פתח מסמך"> */
                            <button title="פתח מסמך" className="heillo-icon-btn" onClick={() => window.open(doc.file_url, "_blank")}>
                              <ExternalLink size={17} strokeWidth={1.8} />
                            </button>
                          ) : (
                            <>
                              {/* OLD: <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(...)} title="פתח PDF"> */}
                              <button title="פתח PDF" className="heillo-icon-btn" onClick={() => window.open(`${meta.pdfBase}${doc.id}`, "_blank")}>
                                <FileText size={17} strokeWidth={1.8} />
                              </button>
                              {doc._type === "invoice" && doc.credit_note_id && (
                                /* OLD: <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-600 hover:text-purple-700" onClick={() => window.open(...)} title="פתח PDF זיכוי"> */
                                <button title="פתח PDF זיכוי" className="heillo-icon-btn" style={{ color: "#7c3aed" }}
                                  onClick={() => window.open(`/credit-note-pdf/${doc.credit_note_id}`, "_blank")}
                                  onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                  <FileText size={17} strokeWidth={1.8} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {/* OLD: <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => setConfirmDoc(doc)} title="הסר מרשימה"> */}
                        <button title="הסר מרשימה" className="heillo-icon-btn" onClick={() => setConfirmDoc(doc)}
                          onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = ""; e.currentTarget.style.background = "transparent"; }}>
                          <X size={17} strokeWidth={1.8} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* OLD: <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground"> */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(0,0,0,0.05)", fontSize: 12, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>
            מציג {filtered.length} מתוך {unified.length} מסמכים
          </div>
        </div>
      )}

      {/* Single-hide confirmation dialog */}
      <AlertDialog open={!!confirmDoc} onOpenChange={open => { if (!open) setConfirmDoc(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>הסרת מסמך</AlertDialogTitle>
            <AlertDialogDescription>
              האם להסיר מסמך זה ממרכז המסמכים?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={hiding}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmHide}
              disabled={hiding}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              הסר
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
