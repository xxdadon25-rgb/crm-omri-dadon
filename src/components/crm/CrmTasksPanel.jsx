import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, X, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { parse, isPast, isToday } from "date-fns";
import { formatDate } from "@/lib/dateUtils";

const taskStatusColor = {
  "פתוחה": "bg-yellow-100 text-yellow-800",
  "בוצעה": "bg-green-100 text-green-800",
  "בוטלה": "bg-gray-100 text-gray-600",
};

export default function CrmTasksPanel({ customerId, customerName }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", due_date: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const { data: tasks = [] } = useQuery({
    queryKey: ["crm-tasks", customerId],
    queryFn: () => base44.entities.CrmTask.filter({ customer_id: customerId }, "-created_date"),
    enabled: !!customerId,
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    await base44.entities.CrmTask.create({
      customer_id: customerId,
      customer_name: customerName,
      title: form.title,
      due_date: form.due_date || null,
      notes: form.notes,
      status: "פתוחה",
    });
    queryClient.invalidateQueries({ queryKey: ["crm-tasks", customerId] });
    queryClient.invalidateQueries({ queryKey: ["crm-tasks-all"] });
    setForm({ title: "", due_date: "", notes: "" });
    setShowForm(false);
    setSaving(false);
    toast.success("משימה נוספה");
  };

  const handleStatus = async (task, status) => {
    await base44.entities.CrmTask.update(task.id, { status });
    queryClient.invalidateQueries({ queryKey: ["crm-tasks", customerId] });
    queryClient.invalidateQueries({ queryKey: ["crm-tasks-all"] });
  };

  const openTasks = tasks.filter(t => t.status === "פתוחה");
  const doneTasks = tasks.filter(t => t.status !== "פתוחה");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">משימות ופולואפ ({openTasks.length} פתוחות)</h3>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-3.5 h-3.5 ml-1" /> משימה חדשה
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-muted/40 rounded-lg p-3 space-y-2 border border-border">
          <Input placeholder="כותרת משימה..." value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
          <Textarea placeholder="הערות..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>ביטול</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving ? "שומר..." : "הוסף"}</Button>
          </div>
        </form>
      )}

      {openTasks.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground text-center py-4">אין משימות פתוחות</p>
      )}

      <div className="space-y-2">
        {openTasks.map(task => {
          const overdue = task.due_date && isPast(parse(task.due_date, "yyyy-MM-dd", new Date())) && !isToday(parse(task.due_date, "yyyy-MM-dd", new Date()));
          const dueToday = task.due_date && isToday(parse(task.due_date, "yyyy-MM-dd", new Date()));
          return (
            <div key={task.id} className={`flex items-start gap-2 p-3 rounded-lg border ${overdue ? "border-red-200 bg-red-50" : dueToday ? "border-yellow-200 bg-yellow-50" : "border-border bg-card"}`}>
              <button onClick={() => handleStatus(task, "בוצעה")} className="mt-0.5 w-5 h-5 rounded border-2 border-muted-foreground hover:border-green-500 hover:bg-green-50 transition-colors flex items-center justify-center shrink-0">
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{task.title}</p>
                {task.due_date && (
                  <p className={`text-xs flex items-center gap-1 mt-0.5 ${overdue ? "text-red-600" : dueToday ? "text-yellow-700" : "text-muted-foreground"}`}>
                    <Calendar className="w-3 h-3" />
                    {overdue ? "באיחור — " : dueToday ? "היום — " : ""}{formatDate(task.due_date)}
                  </p>
                )}
                {task.notes && <p className="text-xs text-muted-foreground mt-0.5">{task.notes}</p>}
              </div>
              <button onClick={() => handleStatus(task, "בוטלה")} className="text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {doneTasks.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">הצג {doneTasks.length} משימות סגורות</summary>
          <div className="mt-2 space-y-1">
            {doneTasks.map(task => (
              <div key={task.id} className="flex items-center gap-2 p-2 rounded border border-border bg-muted/20 opacity-60">
                <span className={`px-1.5 py-0.5 rounded text-xs ${taskStatusColor[task.status]}`}>{task.status}</span>
                <span className="line-through">{task.title}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}