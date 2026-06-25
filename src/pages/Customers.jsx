import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Pencil, Trash2, Users, Eye, Check, LayoutDashboard, List } from "lucide-react";
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

const CheckboxBtn = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className="w-4 h-4 border border-input rounded flex items-center justify-center hover:bg-muted transition-colors"
    style={{ backgroundColor: checked ? "hsl(var(--primary))" : "transparent" }}
  >
    {checked && <Check className="w-3 h-3 text-primary-foreground" />}
  </button>
);

const CRM_STATUSES = ["הכל", "ליד חדש", "בטיפול", "הצעת מחיר נשלחה", "ממתין לתשובה", "לקוח פעיל", "VIP", "לא פעיל", "לא רלוונטי"];

export default function Customers() {
  const navigate = useNavigate();
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
  const queryClient = useQueryClient();

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
      // Age-only gate: keep pending entry for 3 minutes regardless of backend responses.
      // After 3 minutes the platform guarantees eventual consistency — all replicas have the data.
      if (result.some(c => c.id === pendingCustomer.id)) {
        const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
        if (ageMs >= 180000) {
          sessionStorage.removeItem("pendingCustomer");
        }
        return result;
      }
      // Backend not yet confirmed — merge pending into result
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
    const idToDelete = deleteId;
    setDeleteId(null);
    try {
      await base44.entities.Customer.delete(idToDelete);
      queryClient.setQueryData(["customers"], (old = []) => (old || []).filter(c => c.id !== idToDelete));
      toast.success("לקוח נמחק");
    } catch (err) {
      toast.error("שגיאה במחיקת הלקוח");
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

  return (
    <div>
      <PageHeader title="לקוחות" description={`${customers.length} לקוחות`}>
        <div className="flex items-center gap-2">
          <Button variant={view === "dashboard" ? "default" : "outline"} size="sm" onClick={() => setView("dashboard")}>
            <LayoutDashboard className="w-4 h-4 ml-1" /> CRM
          </Button>
          <Button variant={view === "list" ? "default" : "outline"} size="sm" onClick={() => setView("list")}>
            <List className="w-4 h-4 ml-1" /> רשימה
          </Button>
          <Button size="sm" onClick={() => { setEditCustomer(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-1" /> לקוח חדש
          </Button>
        </div>
      </PageHeader>

      {view === "dashboard" && (
        <div className="mb-6">
          <CrmDashboard onSelectStatus={(status) => { setStatusFilter(status); setView("list"); }} />
        </div>
      )}

      {view === "list" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="חיפוש לקוחות..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="סטטוס CRM" />
              </SelectTrigger>
              <SelectContent>
                {CRM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="סוג לקוח" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="הכל">הכל</SelectItem>
                <SelectItem value="פרטי">👤 פרטי</SelectItem>
                <SelectItem value="עסקי">🏢 עסקי</SelectItem>
              </SelectContent>
            </Select>
            {(statusFilter !== "הכל" || typeFilter !== "הכל") && (
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("הכל"); setTypeFilter("הכל"); }}>נקה פילטרים</Button>
            )}
          </div>

          {selectedCustomers.size > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
              <span className="text-sm font-medium">נבחרו {selectedCustomers.size} לקוחות</span>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Users} title="אין לקוחות" description="הוסף לקוח ראשון" />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block bg-card rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-10 text-right">
                          <CheckboxBtn checked={isAllSelected} onChange={toggleSelectAll} />
                        </TableHead>
                        <TableHead className="text-right">שם</TableHead>
                        <TableHead className="text-right">סטטוס CRM</TableHead>
                        <TableHead className="text-right">סוג</TableHead>
                        <TableHead className="text-right">טלפון</TableHead>
                        <TableHead className="text-right">הזמנות</TableHead>
                        <TableHead className="text-right">סה״כ רכישות</TableHead>
                        <TableHead className="text-right">הזמנה אחרונה</TableHead>
                        <TableHead className="text-right">משימות</TableHead>
                        <TableHead className="text-right w-24">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(c => {
                        const stats = getStats(c.id);
                        return (
                          <TableRow key={c.id} className={`hover:bg-muted/30 ${selectedCustomers.has(c.id) ? "bg-primary/5" : ""}`}>
                            <TableCell><CheckboxBtn checked={selectedCustomers.has(c.id)} onChange={() => toggleSelect(c.id)} /></TableCell>
                            <TableCell>
                              <button onClick={() => navigate(`/customers/${c.id}`)} className="font-medium hover:text-primary transition-colors text-right">
                                {c.name}
                              </button>
                            </TableCell>
                            <TableCell><CustomerStatusBadge status={c.crm_status} /></TableCell>
                            <TableCell>
                              <Badge variant={c.customer_type === "עסקי" ? "default" : "secondary"} className="text-xs">
                                {c.customer_type === "עסקי" ? "🏢 עסקי" : "👤 פרטי"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{stats.orders}</Badge></TableCell>
                            <TableCell className="font-medium">₪{stats.total.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatDate(stats.lastOrder) || "-"}</TableCell>
                            <TableCell>
                              {stats.openTasks > 0 ? (
                                <Badge className="bg-yellow-100 text-yellow-800 text-xs">{stats.openTasks} פתוחות</Badge>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/customers/${c.id}`)}>
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditCustomer(c); setDialogOpen(true); }}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(c.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Tablet/mobile card list */}
              <div className="lg:hidden space-y-2">
                <div className="flex items-center gap-2 px-1 pb-1 border-b border-border">
                  <CheckboxBtn checked={isAllSelected} onChange={toggleSelectAll} />
                  <span className="text-xs text-muted-foreground">בחר הכל</span>
                </div>
                {filtered.map(c => {
                  const stats = getStats(c.id);
                  const isSelected = selectedCustomers.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`bg-card rounded-xl border border-border p-4 ${isSelected ? "border-primary/50 bg-primary/5" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="pt-0.5">
                            <CheckboxBtn checked={isSelected} onChange={() => toggleSelect(c.id)} />
                          </div>
                          <div className="min-w-0">
                            <button onClick={() => navigate(`/customers/${c.id}`)} className="font-semibold text-base hover:text-primary transition-colors text-right block truncate">
                              {c.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <CustomerStatusBadge status={c.crm_status} />
                              <Badge variant={c.customer_type === "עסקי" ? "default" : "secondary"} className="text-xs">
                                {c.customer_type === "עסקי" ? "🏢 עסקי" : "👤 פרטי"}
                              </Badge>
                              {stats.openTasks > 0 && (
                                <Badge className="bg-yellow-100 text-yellow-800 text-xs">{stats.openTasks} משימות</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(`/customers/${c.id}`)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setEditCustomer(c); setDialogOpen(true); }}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setDeleteId(c.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">טלפון</p>
                          <p className="font-medium">{c.phone || "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">הזמנות</p>
                          <p className="font-medium">{stats.orders}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">סה״כ רכישות</p>
                          <p className="font-medium">₪{stats.total.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {selectedCustomers.size > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-4 flex items-center justify-between">
              <span className="text-sm font-medium">נבחרו {selectedCustomers.size} לקוחות</span>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 ml-1" /> מחק נבחרים
              </Button>
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