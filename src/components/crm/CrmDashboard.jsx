import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { parse, isPast, isToday } from "date-fns";
import { Users, Star, Clock, AlertTriangle, CheckCircle, UserPlus } from "lucide-react";

function StatBox({ label, value, icon: Icon, color, onClick }) {
  return (
    <button onClick={onClick} className={`text-right p-4 rounded-xl border border-border bg-card hover:shadow-md transition-all w-full ${onClick ? "cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </button>
  );
}

export default function CrmDashboard({ onSelectStatus }) {
  const navigate = useNavigate();
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => base44.entities.Customer.list("-created_date") });
  const { data: tasks = [] } = useQuery({ queryKey: ["crm-tasks-all"], queryFn: () => base44.entities.CrmTask.list() });

  const stats = useMemo(() => {
    const newLeads = customers.filter(c => c.crm_status === "ליד חדש").length;
    const waiting = customers.filter(c => c.crm_status === "ממתין לתשובה").length;
    const active = customers.filter(c => c.crm_status === "לקוח פעיל").length;
    const vip = customers.filter(c => c.crm_status === "VIP").length;
    const inactive = customers.filter(c => c.crm_status === "לא פעיל").length;

    const openTasks = tasks.filter(t => t.status === "פתוחה");
    const todayTasks = openTasks.filter(t => t.due_date && isToday(parse(t.due_date, "yyyy-MM-dd", new Date())));
    const overdueTasks = openTasks.filter(t => t.due_date && isPast(parse(t.due_date, "yyyy-MM-dd", new Date())) && !isToday(parse(t.due_date, "yyyy-MM-dd", new Date())));

    return { newLeads, waiting, active, vip, inactive, openTasks: openTasks.length, todayTasks: todayTasks.length, overdueTasks: overdueTasks.length };
  }, [customers, tasks]);

  // Overdue tasks list
  const overdueTasks = useMemo(() => {
    return tasks.filter(t => t.status === "פתוחה" && t.due_date && isPast(parse(t.due_date, "yyyy-MM-dd", new Date())) && !isToday(parse(t.due_date, "yyyy-MM-dd", new Date())));
  }, [tasks]);

  const todayTasks = useMemo(() => {
    return tasks.filter(t => t.status === "פתוחה" && t.due_date && isToday(parse(t.due_date, "yyyy-MM-dd", new Date())));
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="לידים חדשים" value={stats.newLeads} icon={UserPlus} color="bg-sky-100 text-sky-700" onClick={() => onSelectStatus("ליד חדש")} />
        <StatBox label="ממתינים לתשובה" value={stats.waiting} icon={Clock} color="bg-yellow-100 text-yellow-700" onClick={() => onSelectStatus("ממתין לתשובה")} />
        <StatBox label="לקוחות פעילים" value={stats.active} icon={CheckCircle} color="bg-green-100 text-green-700" onClick={() => onSelectStatus("לקוח פעיל")} />
        <StatBox label="VIP" value={stats.vip} icon={Star} color="bg-amber-100 text-amber-700" onClick={() => onSelectStatus("VIP")} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatBox label="לא פעילים" value={stats.inactive} icon={Users} color="bg-gray-100 text-gray-600" onClick={() => onSelectStatus("לא פעיל")} />
        <StatBox label="משימות פתוחות" value={stats.openTasks} icon={CheckCircle} color="bg-blue-100 text-blue-700" />
        <StatBox label="משימות באיחור" value={stats.overdueTasks} icon={AlertTriangle} color="bg-red-100 text-red-700" />
      </div>

      {(overdueTasks.length > 0 || todayTasks.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {overdueTasks.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h4 className="font-semibold text-red-800 mb-3 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> משימות באיחור ({overdueTasks.length})
              </h4>
              <div className="space-y-2">
                {overdueTasks.slice(0, 5).map(t => (
                  <button key={t.id} onClick={() => navigate(`/customers/${t.customer_id}`)} className="w-full text-right p-2 bg-white rounded-lg border border-red-100 hover:border-red-300 transition-colors">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.customer_name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {todayTasks.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <h4 className="font-semibold text-yellow-800 mb-3 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" /> משימות להיום ({todayTasks.length})
              </h4>
              <div className="space-y-2">
                {todayTasks.slice(0, 5).map(t => (
                  <button key={t.id} onClick={() => navigate(`/customers/${t.customer_id}`)} className="w-full text-right p-2 bg-white rounded-lg border border-yellow-100 hover:border-yellow-300 transition-colors">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.customer_name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}