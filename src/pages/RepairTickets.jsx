import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Pencil, Trash2, Wrench, LayoutGrid, List, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import RepairTicketDialog from "@/components/repair/RepairTicketDialog";
import { toast } from "sonner";

const STATUSES = ["הכל", "נכנס", "בבדיקה", "בתיקון", "ממתין לחלקים", "מוכן לאיסוף", "נמסר", "בוטל"];

const STATUS_COLORS = {
  "נכנס": "bg-blue-100 text-blue-800",
  "בבדיקה": "bg-yellow-100 text-yellow-800",
  "בתיקון": "bg-orange-100 text-orange-800",
  "ממתין לחלקים": "bg-purple-100 text-purple-800",
  "מוכן לאיסוף": "bg-green-100 text-green-800",
  "נמסר": "bg-gray-100 text-gray-700",
  "בוטל": "bg-red-100 text-red-700",
};

const PRIORITY_COLORS = {
  "נמוכה": "bg-gray-100 text-gray-600",
  "רגילה": "bg-blue-50 text-blue-700",
  "גבוהה": "bg-orange-100 text-orange-700",
  "דחופה": "bg-red-100 text-red-700",
};

const KANBAN_COLS = ["נכנס", "בבדיקה", "בתיקון", "ממתין לחלקים", "מוכן לאיסוף"];

function StatusBadge({ status }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[priority] || ""}`}>{priority}</span>;
}

function KanbanCard({ ticket, onEdit, onDelete }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onEdit(ticket)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono">#{ticket.ticket_number}</span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <p className="font-medium text-sm">{ticket.customer_name}</p>
      <p className="text-xs text-muted-foreground">{ticket.device_brand} {ticket.device_model} • {ticket.device_type}</p>
      <p className="text-xs line-clamp-2 text-muted-foreground">{ticket.problem_description}</p>
      {ticket.final_cost && (
        <p className="text-sm font-semibold text-green-700">₪{Number(ticket.final_cost).toLocaleString()}</p>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); onDelete(ticket.id); }}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export default function RepairTickets() {
  const [view, setView] = useState("kanban");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTicket, setEditTicket] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const queryClient = useQueryClient();

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["repair-tickets"],
    queryFn: () => base44.entities.RepairTicket.list("-created_date"),
  });

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (search && ![t.customer_name, t.device_brand, t.device_model, String(t.ticket_number || "")].some(f => f?.toLowerCase().includes(search.toLowerCase()))) return false;
      if (statusFilter !== "הכל" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tickets, search, statusFilter]);

  const openNew = () => { setEditTicket(null); setDialogOpen(true); };
  const openEdit = (t) => { setEditTicket(t); setDialogOpen(true); };

  const handleDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    queryClient.setQueryData(["repair-tickets"], (old = []) => old.filter(t => t.id !== id));
    try {
      await base44.entities.RepairTicket.delete(id);
      toast.success("קריאה נמחקה");
    } catch {
      toast.error("שגיאה במחיקה");
      queryClient.invalidateQueries({ queryKey: ["repair-tickets"] });
    }
  };

  const handleSaved = (saved) => {
    queryClient.setQueryData(["repair-tickets"], (old = []) => {
      if (editTicket?.id) return old.map(t => t.id === saved.id ? saved : t);
      return [saved, ...old];
    });
  };

  const activeCount = tickets.filter(t => !["נמסר", "בוטל"].includes(t.status)).length;
  const readyCount = tickets.filter(t => t.status === "מוכן לאיסוף").length;
  const urgentCount = tickets.filter(t => t.priority === "דחופה" && !["נמסר", "בוטל"].includes(t.status)).length;

  return (
    <div>
      <PageHeader title="קריאות שירות" description={`${activeCount} קריאות פעילות`}>
        <div className="flex items-center gap-2">
          <Button variant={view === "kanban" ? "default" : "outline"} size="sm" onClick={() => setView("kanban")}>
            <LayoutGrid className="w-4 h-4 ml-1" /> לוח
          </Button>
          <Button variant={view === "list" ? "default" : "outline"} size="sm" onClick={() => setView("list")}>
            <List className="w-4 h-4 ml-1" /> רשימה
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="w-4 h-4 ml-1" /> קריאה חדשה
          </Button>
        </div>
      </PageHeader>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{activeCount}</p>
            <p className="text-xs text-muted-foreground">קריאות פעילות</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{readyCount}</p>
            <p className="text-xs text-muted-foreground">מוכן לאיסוף</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{urgentCount}</p>
            <p className="text-xs text-muted-foreground">קריאות דחופות</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="חיפוש..." value={search} onChange={e => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="סטטוס" />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Wrench} title="אין קריאות שירות" description="פתח קריאת שירות ראשונה" />
      ) : view === "kanban" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto">
          {KANBAN_COLS.map(col => {
            const colTickets = filtered.filter(t => t.status === col);
            return (
              <div key={col} className="min-w-[200px]">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="font-semibold text-sm">{col}</span>
                  <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">{colTickets.length}</span>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colTickets.map(t => (
                    <KanbanCard key={t.id} ticket={t} onEdit={openEdit} onDelete={setDeleteId} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">#</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">מכשיר</TableHead>
                  <TableHead className="text-right">בעיה</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">עדיפות</TableHead>
                  <TableHead className="text-right">טכנאי</TableHead>
                  <TableHead className="text-right">מחיר סופי</TableHead>
                  <TableHead className="text-right">תאריך קבלה</TableHead>
                  <TableHead className="text-right w-20">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(t => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-sm">#{t.ticket_number}</TableCell>
                    <TableCell>
                      <p className="font-medium">{t.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{t.customer_phone}</p>
                    </TableCell>
                    <TableCell className="text-sm">{t.device_brand} {t.device_model}<br /><span className="text-muted-foreground text-xs">{t.device_type}</span></TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{t.problem_description}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                    <TableCell className="text-sm">{t.technician || "-"}</TableCell>
                    <TableCell className="font-medium">{t.final_cost ? `₪${Number(t.final_cost).toLocaleString()}` : "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.received_date || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(t.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <RepairTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        ticket={editTicket}
        onSaved={handleSaved}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת קריאת שירות</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח שברצונך למחוק קריאה זו?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
