import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Pencil, Trash2, Users, Eye, Check, LayoutDashboard, List, MapPin, Navigation } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/api/supabaseClient";
import { formatDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import CustomerDialog from "@/components/customers/CustomerDialog";
import CustomerStatusBadge from "@/components/crm/CustomerStatusBadge";
import CrmDashboard from "@/components/crm/CrmDashboard";
import { toast } from "sonner";

const CRM_STATUSES = ["הכל", "ליד חדש", "בטיפול", "הצעת מחיר נשלחה", "ממתין לתשובה", "לקוח פעיל", "VIP", "לא פעיל", "לא רלוונטי"];

export default function Customers() {
  const navigate = useNavigate();
  // Clear any stale pendingCustomer from previous sessions on mount
  useEffect(() => { sessionStorage.removeItem("pendingCustomer"); }, []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [typeFilter, setTypeFilter] = useState("הכל");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [selectedCustomers, setSelectedCustomers] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState("list");
  const [savingLocationId, setSavingLocationId] = useState(null);
  const queryClient = useQueryClient();

  const handleSaveLocation = (customer) => {
    if (!navigator.geolocation) {
      toast.error("הדפדפן אינו תומך ב-GPS");
      return;
    }
    setSavingLocationId(customer.id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { error } = await supabase
            .from("customers")
            .update({ location_lat: pos.coords.latitude, location_lng: pos.coords.longitude })
            .eq("id", customer.id);
          if (error) throw error;
          queryClient.setQueryData(["customers"], (old = []) =>
            old.map(c => c.id === customer.id ? { ...c, location_lat: pos.coords.latitude, location_lng: pos.coords.longitude } : c)
          );
          toast.success("מיקום נשמר בהצלחה");
        } catch (err) {
          toast.error("שגיאה בשמירת המיקום: " + err.message);
        } finally {
          setSavingLocationId(null);
        }
      },
      (err) => {
        toast.error("לא ניתן לקבל מיקום: " + err.message);
        setSavingLocationId(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: async () => {
      const result = await base44.entities.Customer.list("-created_date");
      const pending = sessionStorage.getItem("pendingCustomer");
      if (!pending) return result;
      const pendingCustomer = JSON.parse(pending);
      // If the pending customer exists in DB, or is older than 3 minutes, clear it
      const existsInDb = result.some(c => c.id === pendingCustomer.id);
      const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
      if (existsInDb || ageMs >= 180000) {
        sessionStorage.removeItem("pendingCustomer");
        return result;
      }
      // Only inject if recently created and not yet in DB
      return [pendingCustomer, ...result];
    },
  });

  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list() });
  const { data: quotes = [] } = useQuery({ queryKey: ["customers-quotes"], queryFn: () => base44.entities.Quote.list("-created_date") });
  const { data: tasks = [] } = useQuery({ queryKey: ["crm-tasks-all"], queryFn: () => base44.entities.CrmTask.list() });

  const getStats = (customerId) => {
    const cOrders = orders.filter(o => o.customer_id === customerId);
    const cQuotes = quotes.filter(q => q.customer_id === customerId);
    const total = cOrders.reduce((s, o) => s + (o.total || 0), 0);
    const lastOrder = cOrders.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const openTasks = tasks.filter(t => t.customer_id === customerId && t.status === "פתוחה").length;
    return { total, orders: cOrders.length, quotes: cQuotes.length, lastOrder: lastOrder?.date, openTasks };
  };

  const filtered = useMemo(() => {
    return customers.filter(c => {
      if (search && ![c.name, c.phone, c.email, c.tax_id].some(f => f?.toLowerCase().includes(search.toLowerCase()))) return false;
      if (statusFilter !== "הכל" && c.crm_status !== statusFilter) return false;
      if (typeFilter !== "הכל" && c.customer_type !== typeFilter) return false;
      return true;
    });
  }, [customers, search, statusFilter, typeFilter]);

  const isAllSelected = filtered.length > 0 && filtered.every(c => selectedCustomers.has(c.id));

  const toggleSelect = (id) => {
    const next = new Set(selectedCustomers);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedCustomers(next);
  };

  const toggleSelectAll = () => {
    setSelectedCustomers(isAllSelected ? new Set() : new Set(filtered.map(c => c.id)));
  };

  const handleDelete = async () => {
    console.log('[handleDelete] called, deleteId:', deleteId);
    const idToDelete = deleteId;
    try {
      await base44.entities.Customer.delete(idToDelete);
      console.log('[handleDelete] delete done, updating cache');
      queryClient.setQueryData(["customers"], (old = []) => (old || []).filter(c => c.id !== idToDelete));
      toast.success("לקוח נמחק");
    } catch (err) {
      console.error('[handleDelete] error:', err);
      toast.error("שגיאה במחיקת הלקוח");
    } finally {
      setDeleteId(null);
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = [...selectedCustomers];
    setSelectedCustomers(new Set());
    setBulkDeleteOpen(false);
    await Promise.allSettled(ids.map(id => base44.entities.Customer.delete(id)));
    queryClient.setQueryData(["customers"], (old = []) => (old || []).filter(c => !ids.includes(c.id)));
    toast.success(`${ids.length} לקוחות נמחקו`);
    setDeleting(false);
  };

  // ── Heillo design tokens (inline where CSS vars not available) ──
  const ACCENT = "#F5885E";
  const DARK   = "#120F1C";
  const MUTED  = "#B2B0B1";
  const selectStyle = { background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, height: 40, fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif" };

  return (
    /* OLD: <div><div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]"> */
    <div className="heillo-page" dir="rtl">

      {/* ── Top bar ── */}
      {/* OLD: <div className="sticky top-0 z-10 bg-background pb-3"><PageHeader .../> ... </div> */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>לקוחות</h1>
          <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{customers.length} לקוחות</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* OLD: <Button variant={view==="dashboard"?...}>CRM</Button><Button variant={view==="list"?...}>רשימה</Button> */}
          {[{ key: "dashboard", label: "CRM", icon: LayoutDashboard }, { key: "list", label: "רשימה", icon: List }].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setView(key)}
              style={{ background: view === key ? ACCENT : "#FFFFFF", color: view === key ? "#FFFFFF" : DARK, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, fontWeight: 500, padding: "7px 14px", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease" }}>
              <Icon style={{ width: 15, height: 15 }} /> {label}
            </button>
          ))}
          {/* OLD: <Button size="sm" onClick={...}><Plus .../> לקוח חדש</Button> */}
          <button className="heillo-btn-primary" onClick={() => { setEditCustomer(null); setDialogOpen(true); }} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Plus style={{ width: 16, height: 16 }} /> לקוח חדש
          </button>
        </div>
      </div>

      {/* ── Search + filters (list view only) ── */}
      {/* OLD: <div className="flex flex-wrap gap-3 mt-1"><div className="relative flex-1 min-w-48"><Search .../><Input className="pr-9" /></div><Select .../><Select .../></div> */}
      {view === "list" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
            <input placeholder="חיפוש לקוחות..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="heillo-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 40 }} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            {/* OLD: <SelectTrigger className="w-48"> */}
            <SelectTrigger style={{ ...selectStyle, width: 192 }}><SelectValue placeholder="סטטוס CRM" /></SelectTrigger>
            <SelectContent>{CRM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            {/* OLD: <SelectTrigger className="w-36"> */}
            <SelectTrigger style={{ ...selectStyle, width: 144 }}><SelectValue placeholder="סוג לקוח" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="הכל">הכל</SelectItem>
              <SelectItem value="פרטי">👤 פרטי</SelectItem>
              <SelectItem value="עסקי">🏢 עסקי</SelectItem>
            </SelectContent>
          </Select>
          {(statusFilter !== "הכל" || typeFilter !== "הכל") && (
            <button onClick={() => { setStatusFilter("הכל"); setTypeFilter("הכל"); }}
              style={{ background: "transparent", color: MUTED, border: "none", fontSize: 13, fontFamily: "'Heebo', sans-serif", cursor: "pointer", padding: "0 8px" }}>
              נקה פילטרים
            </button>
          )}
        </div>
      )}

      {/* ── CRM Dashboard view ── */}
      {view === "dashboard" && (
        <div style={{ marginBottom: 24 }}>
          <CrmDashboard onSelectStatus={(status) => { setStatusFilter(status); setView("list"); }} />
        </div>
      )}

      {/* ── List view ── */}
      {view === "list" && (
        <>
          {/* Bulk selection bar */}
          {/* OLD: <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 ..."> */}
          {selectedCustomers.size > 0 && (
            <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCustomers.size} לקוחות</span>
              <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
                <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
              </button>
            </div>
          )}

          {isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid rgba(0,0,0,0.08)", borderTopColor: ACCENT, animation: "spin 1s linear infinite" }} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Users} title="אין לקוחות" description="הוסף לקוח ראשון" />
          ) : (
            <>
              {/* ── Desktop table ── */}
              {/* OLD: <div className="hidden lg:block bg-card rounded-xl border border-border overflow-hidden"> */}
              <div className="hidden lg:block heillo-card">
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
                    {/* OLD: <TableHeader><TableRow className="bg-muted/50"> */}
                    <thead className="heillo-table-header">
                      <tr>
                        <th style={{ width: 44, padding: "14px 20px", textAlign: "center" }}>
                          <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} />
                        </th>
                        {["שם","סטטוס CRM","סוג","טלפון","הזמנות","סה״כ רכישות","הזמנה אחרונה","משימות","פעולות"].map(col => (
                          <th key={col} style={{ padding: "14px 20px", textAlign: "right", whiteSpace: "nowrap" }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    {/* OLD: <TableBody>{filtered.map(c => <TableRow className={`hover:bg-muted/30 ${...}`}> */}
                    <tbody>
                      {filtered.map((c, i) => {
                        const stats = getStats(c.id);
                        const isSelected = selectedCustomers.has(c.id);
                        return (
                          <tr key={c.id} className="heillo-table-row"
                            style={{ background: isSelected ? "rgba(245,136,94,0.04)" : undefined, borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                            <td style={{ padding: "14px 20px", textAlign: "center" }}>
                              <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(c.id)} />
                            </td>
                            <td style={{ padding: "14px 20px" }}>
                              {/* OLD: <button className="font-medium hover:text-primary transition-colors text-right"> */}
                              <button onClick={() => navigate(`/customers/${c.id}`)} style={{ fontWeight: 600, fontSize: 13, color: DARK, background: "none", border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif", transition: "color 0.15s ease" }}
                                onMouseEnter={e => e.currentTarget.style.color = ACCENT}
                                onMouseLeave={e => e.currentTarget.style.color = DARK}>
                                {c.name}
                              </button>
                            </td>
                            <td style={{ padding: "14px 20px" }}><CustomerStatusBadge status={c.crm_status} /></td>
                            <td style={{ padding: "14px 20px" }}>
                              {/* OLD: <Badge variant={...} className="text-xs"> */}
                              <span className="heillo-badge" style={{ background: c.customer_type === "עסקי" ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.05)", color: c.customer_type === "עסקי" ? "#4f46e5" : DARK }}>
                                {c.customer_type === "עסקי" ? "🏢 עסקי" : "👤 פרטי"}
                              </span>
                            </td>
                            <td style={{ padding: "14px 20px", fontSize: 13, color: MUTED }}>{c.mobile || c.phone || "—"}</td>
                            <td style={{ padding: "14px 20px", textAlign: "center" }}>
                              {/* OLD: <Badge variant="secondary">{stats.orders}</Badge> */}
                              <span className="heillo-badge" style={{ background: "rgba(0,0,0,0.05)", color: DARK }}>{stats.orders}</span>
                            </td>
                            <td style={{ padding: "14px 20px", fontSize: 13, fontWeight: 500, color: DARK }}>₪{stats.total.toLocaleString()}</td>
                            <td style={{ padding: "14px 20px", fontSize: 12, color: MUTED }}>{formatDate(stats.lastOrder) || "—"}</td>
                            <td style={{ padding: "14px 20px" }}>
                              {stats.openTasks > 0 ? (
                                /* OLD: <Badge className="bg-yellow-100 text-yellow-800 text-xs"> */
                                <span className="heillo-badge" style={{ background: "rgba(234,179,8,0.12)", color: "#854d0e" }}>{stats.openTasks} פתוחות</span>
                              ) : "—"}
                            </td>
                            <td style={{ padding: "14px 20px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <button title="צפייה" className="heillo-icon-btn" onClick={() => navigate(`/customers/${c.id}`)}>
                                  <Eye size={18} strokeWidth={1.8} />
                                </button>
                                <button title="עריכה" className="heillo-icon-btn" onClick={() => { setEditCustomer(c); setDialogOpen(true); }}>
                                  <Pencil size={18} strokeWidth={1.8} />
                                </button>
                                {c.location_lat && c.location_lng ? (
                                  <a href={`https://waze.com/ul?ll=${c.location_lat},${c.location_lng}&navigate=yes`} target="_blank" rel="noopener noreferrer">
                                    <button title="נווט בוויז" className="heillo-icon-btn"><Navigation size={18} strokeWidth={1.8} /></button>
                                  </a>
                                ) : (
                                  <button title="שמור מיקום" className="heillo-icon-btn" disabled={savingLocationId === c.id} onClick={() => handleSaveLocation(c)}>
                                    <MapPin size={18} strokeWidth={1.8} />
                                  </button>
                                )}
                                <button title="מחיקה" className="heillo-icon-btn" style={{ color: "#ef4444" }} onClick={() => setDeleteId(c.id)}
                                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.color = "#ef4444"; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ef4444"; }}>
                                  <Trash2 size={18} strokeWidth={1.8} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Mobile card list ── */}
              {/* OLD: <div className="lg:hidden space-y-2"> */}
              <div className="lg:hidden" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 8px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} />
                  <span style={{ fontSize: 12, color: MUTED, fontFamily: "'Heebo', sans-serif" }}>בחר הכל</span>
                </div>
                {filtered.map(c => {
                  const stats = getStats(c.id);
                  const isSelected = selectedCustomers.has(c.id);
                  return (
                    /* OLD: <div className={`bg-card rounded-xl border border-border p-4 ${isSelected ? "border-primary/50 bg-primary/5" : ""}`}> */
                    <div key={c.id} className="heillo-card" style={{ padding: 16, borderColor: isSelected ? "rgba(245,136,94,0.3)" : undefined, background: isSelected ? "rgba(245,136,94,0.04)" : "#FFFFFF" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
                          <div style={{ paddingTop: 2 }}><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(c.id)} /></div>
                          <div style={{ minWidth: 0 }}>
                            <button onClick={() => navigate(`/customers/${c.id}`)} style={{ fontWeight: 600, fontSize: 14, color: DARK, background: "none", border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.name}
                            </button>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <CustomerStatusBadge status={c.crm_status} />
                              <span className="heillo-badge" style={{ background: c.customer_type === "עסקי" ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.05)", color: c.customer_type === "עסקי" ? "#4f46e5" : DARK }}>
                                {c.customer_type === "עסקי" ? "🏢 עסקי" : "👤 פרטי"}
                              </span>
                              {stats.openTasks > 0 && (
                                <span className="heillo-badge" style={{ background: "rgba(234,179,8,0.12)", color: "#854d0e" }}>{stats.openTasks} משימות</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <button title="צפייה" className="heillo-icon-btn" onClick={() => navigate(`/customers/${c.id}`)}><Eye size={18} strokeWidth={1.8} /></button>
                          <button title="עריכה" className="heillo-icon-btn" onClick={() => { setEditCustomer(c); setDialogOpen(true); }}><Pencil size={18} strokeWidth={1.8} /></button>
                          {c.location_lat && c.location_lng ? (
                            <a href={`https://waze.com/ul?ll=${c.location_lat},${c.location_lng}&navigate=yes`} target="_blank" rel="noopener noreferrer">
                              <button title="נווט בוויז" className="heillo-icon-btn"><Navigation size={18} strokeWidth={1.8} /></button>
                            </a>
                          ) : (
                            <button title="שמור מיקום" className="heillo-icon-btn" disabled={savingLocationId === c.id} onClick={() => handleSaveLocation(c)}><MapPin size={18} strokeWidth={1.8} /></button>
                          )}
                          <button title="מחיקה" className="heillo-icon-btn" style={{ color: "#ef4444" }} onClick={() => setDeleteId(c.id)}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                            <Trash2 size={18} strokeWidth={1.8} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.05)", fontSize: 13 }}>
                        {[["טלפון", c.mobile || c.phone || "—"], ["הזמנות", stats.orders], ["סה״כ רכישות", `₪${stats.total.toLocaleString()}`]].map(([label, val]) => (
                          <div key={label}>
                            <p style={{ fontSize: 11, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>{label}</p>
                            <p style={{ fontWeight: 500, color: DARK, margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>{val}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Bottom bulk bar */}
          {selectedCustomers.size > 0 && (
            <div style={{ background: "rgba(245,136,94,0.07)", border: "1px solid rgba(245,136,94,0.2)", borderRadius: 14, padding: "10px 16px", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: DARK, fontFamily: "'Heebo', sans-serif" }}>נבחרו {selectedCustomers.size} לקוחות</span>
              <button onClick={() => setBulkDeleteOpen(true)} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, color: "#ef4444", fontSize: 12, fontWeight: 500, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Heebo', sans-serif" }}>
                <Trash2 style={{ width: 14, height: 14 }} /> מחק נבחרים
              </button>
            </div>
          )}
        </>
      )}

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editCustomer}
        onSaved={(savedCustomer) => {
          if (editCustomer?.id) {
            // Update: patch existing record in cache
            queryClient.setQueryData(["customers"], (old = []) =>
              old.map(c => c.id === savedCustomer.id ? savedCustomer : c)
            );
          } else {
            // Create: prepend to cache immediately for instant UI feedback.
            // pendingCustomer stays in sessionStorage; queryFn will only remove it
            // once Customer.list() from the backend actually contains the record.
            queryClient.setQueryData(["customers"], (old = []) => [savedCustomer, ...(Array.isArray(old) ? old : [])]);
          }
        }}
      />

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

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת לקוחות</AlertDialogTitle>
            <AlertDialogDescription>מחיקת {selectedCustomers.size} לקוחות?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground">
              {deleting ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}