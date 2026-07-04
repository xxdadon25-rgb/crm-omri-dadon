import { useState } from "react";
import { formatCurrency } from "@/utils/formatCurrency";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { Package, AlertTriangle, FileText, Receipt, TrendingUp, Users, CalendarClock, ArrowUp, ArrowDown, Target, Pencil } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getOrderStatusColor, getPaymentStatusColor } from "@/utils/statusColors";

const COLORS = ["hsl(48, 96%, 53%)", "hsl(200, 60%, 50%)", "hsl(150, 50%, 45%)", "hsl(280, 60%, 55%)", "hsl(20, 80%, 55%)"];

// ─── Heillo design tokens ─────────────────────────────────────────────────────
const ACCENT   = "#F5885E";
const DARK     = "#120F1C";
const MUTED    = "#B2B0B1";
const CARD_BG  = "#FFFFFF";
const PAGE_BG  = "#ECEDF0";
const CARD_STYLE = {
  background: CARD_BG,
  borderRadius: 22,
  padding: 24,
  border: "1px solid rgba(0,0,0,0.03)",
  boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
  fontFamily: "'Heebo', sans-serif",
};

// ─── Axis ticks ───────────────────────────────────────────────────────────────
const CustomYAxisTick = ({ x, y, payload }) => (
  <text x={x - 40} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED}>
    {`${Number(payload.value).toLocaleString()} ₪`}
  </text>
);

const CustomYAxisTickCount = ({ x, y, payload }) => (
  <text x={x - 40} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED}>
    {Number(payload.value).toLocaleString()}
  </text>
);

// ─── PlaceholderCard ──────────────────────────────────────────────────────────
/* OLD PlaceholderCard:
const PlaceholderCard = ({ title }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
    <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
    <div className="flex-1 flex items-center justify-center py-6">
      <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">בקרוב</span>
    </div>
  </div>
);
*/
const PlaceholderCard = ({ title }) => (
  <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", gap: 12 }}>
    <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: 0 }}>{title}</h3>
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
      <span style={{ fontSize: 12, color: MUTED, background: "rgba(0,0,0,0.03)", padding: "6px 14px", borderRadius: 99 }}>בקרוב</span>
    </div>
  </div>
);

// ─── ListCard ─────────────────────────────────────────────────────────────────
/* OLD ListCard:
function ListCard({ title, count, items, emptyText, renderItem, onClick }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
        {count > 0 && (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-6">
          <span className="text-xs text-gray-400">{emptyText}</span>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item, i) => {
            const content = renderItem(item);
            const clickable = !!onClick;
            return (
              <div
                key={item.id || i}
                onClick={clickable ? () => onClick(item) : undefined}
                className={`flex items-center justify-between py-2 border-b border-gray-100 last:border-0 gap-2 ${clickable ? "cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-colors" : ""}`}
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
*/
function ListCard({ title, count, items, emptyText, renderItem, onClick }) {
  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: 0 }}>{title}</h3>
        {count > 0 && (
          <span style={{ fontSize: 11, fontWeight: 500, color: MUTED, background: "rgba(0,0,0,0.05)", padding: "2px 10px", borderRadius: 99 }}>{count}</span>
        )}
      </div>
      {items.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
          <span style={{ fontSize: 12, color: MUTED }}>{emptyText}</span>
        </div>
      ) : (
        <div>
          {items.map((item, i) => {
            const content = renderItem(item);
            const clickable = !!onClick;
            return (
              <div
                key={item.id || i}
                onClick={clickable ? () => onClick(item) : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 0",
                  borderBottom: i < items.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none",
                  gap: 8,
                  cursor: clickable ? "pointer" : undefined,
                  transition: "background 0.2s ease",
                  borderRadius: 8,
                  margin: "0 -4px",
                  padding: "12px 4px",
                }}
                onMouseEnter={e => { if (clickable) e.currentTarget.style.background = `rgba(245,136,94,0.04)`; }}
                onMouseLeave={e => { if (clickable) e.currentTarget.style.background = "transparent"; }}
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── GoalProgressBar ──────────────────────────────────────────────────────────
/* OLD GoalProgressBar:
function GoalProgressBar({ label, actual, goal, formatValue }) {
  const pct = goal > 0 ? Math.round((actual / goal) * 100) : 0;
  const barPct = Math.min(pct, 100);
  const color = pct >= 90 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-xs text-gray-500">{pct}%</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${barPct}%` }} />
      </div>
      <p className="text-xs text-gray-500">{formatValue(actual)} מתוך {formatValue(goal)}</p>
    </div>
  );
}
*/
function GoalProgressBar({ label, actual, goal, formatValue }) {
  const pct = goal > 0 ? Math.round((actual / goal) * 100) : 0;
  const barPct = Math.min(pct, 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500, fontSize: 13, color: DARK }}>{label}</span>
        <span style={{ fontSize: 12, color: MUTED }}>{pct}%</span>
      </div>
      <div style={{ height: 8, background: `rgba(245,136,94,0.15)`, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${barPct}%`, background: ACCENT, borderRadius: 99, transition: "width 0.4s ease" }} />
      </div>
      <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>{formatValue(actual)} מתוך {formatValue(goal)}</p>
    </div>
  );
}

// ─── GoalDialog (unchanged logic) ────────────────────────────────────────────
function GoalDialog({ open, onOpenChange, existingGoal, month, year, onSaved }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ sales_goal: "", profit_goal: "", orders_goal: "" });
  const [saving, setSaving] = useState(false);

  const initFromExisting = () => {
    setForm({
      sales_goal: existingGoal?.sales_goal != null ? String(existingGoal.sales_goal) : "",
      profit_goal: existingGoal?.profit_goal != null ? String(existingGoal.profit_goal) : "",
      orders_goal: existingGoal?.orders_goal != null ? String(existingGoal.orders_goal) : "",
    });
  };

  const handleOpenChange = (o) => {
    if (o) initFromExisting();
    onOpenChange(o);
  };

  const handleSave = async () => {
    const sales = Number(form.sales_goal);
    const profit = Number(form.profit_goal);
    const ordersGoal = Number(form.orders_goal);
    if ([sales, profit, ordersGoal].some(v => isNaN(v) || v < 0)) {
      toast.error("יש להזין מספרים תקינים (0 ומעלה)");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("monthly_goals").upsert(
        {
          user_id: user?.id,
          month,
          year,
          sales_goal: sales,
          profit_goal: profit,
          orders_goal: ordersGoal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,month,year" }
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["monthly-goal", year, month] });
      toast.success("היעד נשמר בהצלחה");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error("שגיאה בשמירת היעד: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>הגדרת יעד לחודש {month}/{year}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>יעד מכירות (₪)</Label>
            <Input type="number" min="0" value={form.sales_goal} onChange={e => setForm(f => ({ ...f, sales_goal: e.target.value }))} placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label>יעד רווח (₪)</Label>
            <Input type="number" min="0" value={form.profit_goal} onChange={e => setForm(f => ({ ...f, profit_goal: e.target.value }))} placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label>יעד הזמנות</Label>
            <Input type="number" min="0" value={form.orders_goal} onChange={e => setForm(f => ({ ...f, orders_goal: e.target.value }))} placeholder="0" />
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button className="flex-1" disabled={saving} onClick={handleSave}>
              {saving ? "שומר..." : "שמור יעד"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── GoalProgressCard ─────────────────────────────────────────────────────────
/* OLD GoalProgressCard:
function GoalProgressCard({ goal, salesActual, profitActual, ordersActual, month, year, onOpenDialog }) {
  if (!goal) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col items-center justify-center gap-3 py-10">
        <h3 className="font-semibold text-gray-700 text-sm self-start">יעד מול ביצוע</h3>
        <Target className="w-8 h-8 text-gray-300" />
        <span className="text-sm text-gray-400">לא הוגדר יעד לחודש זה</span>
        <Button size="sm" variant="outline" onClick={onOpenDialog}>הגדר יעד</Button>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-700 text-sm">יעד מול ביצוע</h3>
        <button ... >עריכת יעד</button>
      </div>
      <div className="space-y-4">...</div>
    </div>
  );
}
*/
function GoalProgressCard({ goal, salesActual, profitActual, ordersActual, month, year, onOpenDialog }) {
  if (!goal) {
    return (
      <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "40px 24px" }}>
        <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: 0, alignSelf: "flex-start" }}>יעד מול ביצוע</h3>
        <Target style={{ width: 32, height: 32, color: MUTED, opacity: 0.4 }} />
        <span style={{ fontSize: 13, color: MUTED }}>לא הוגדר יעד לחודש זה</span>
        <Button size="sm" variant="outline" onClick={onOpenDialog}>הגדר יעד</Button>
      </div>
    );
  }

  return (
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: 0 }}>יעד מול ביצוע</h3>
        <button
          type="button"
          onClick={onOpenDialog}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 10,
            background: `rgba(245,136,94,0.1)`, border: "none",
            color: ACCENT, fontSize: 12, fontWeight: 500,
            cursor: "pointer", transition: "all 0.2s ease",
            fontFamily: "'Heebo', sans-serif",
          }}
          onMouseEnter={e => e.currentTarget.style.background = `rgba(245,136,94,0.18)`}
          onMouseLeave={e => e.currentTarget.style.background = `rgba(245,136,94,0.1)`}
        >
          <Pencil style={{ width: 14, height: 14 }} />
          עריכת יעד
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GoalProgressBar label="מכירות" actual={salesActual} goal={goal.sales_goal || 0} formatValue={(v) => `${Math.round(v).toLocaleString()} ₪`} />
        <GoalProgressBar label="רווח" actual={profitActual} goal={goal.profit_goal || 0} formatValue={(v) => `${Math.round(v).toLocaleString()} ₪`} />
        <GoalProgressBar label="הזמנות" actual={ordersActual} goal={goal.orders_goal || 0} formatValue={(v) => `${v.toLocaleString()}`} />
      </div>
    </div>
  );
}

// ─── KpiSparkCard ─────────────────────────────────────────────────────────────
/* OLD KpiSparkCard:
function KpiSparkCard({ title, icon: Icon, value, sparkData, pct }) {
  const isPositive = pct !== null && pct > 0;
  const isNegative = pct !== null && pct < 0;
  const lineColor = isNegative ? "#ef4444" : "#22c55e";
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col justify-between transition-shadow hover:shadow-md">
      ...
    </div>
  );
}
*/
function KpiSparkCard({ title, icon: Icon, value, sparkData, pct }) {
  const isPositive = pct !== null && pct > 0;
  const isNegative = pct !== null && pct < 0;
  const lineColor = isNegative ? "#ef4444" : "#22c55e";
  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{title}</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: DARK, margin: "4px 0 0" }}>{value}</p>
          <p style={{
            fontSize: 11, fontWeight: 500, marginTop: 4, display: "flex", alignItems: "center", gap: 2,
            color: isPositive ? "#22c55e" : isNegative ? "#ef4444" : MUTED,
          }}>
            {isPositive && <ArrowUp style={{ width: 12, height: 12 }} />}
            {isNegative && <ArrowDown style={{ width: 12, height: 12 }} />}
            {pct === null ? "— אין נתון קודם" : `${Math.abs(pct)}% לעומת חודש קודם`}
          </p>
        </div>
        {Icon && (
          <div style={{ padding: 10, borderRadius: 12, background: `rgba(245,136,94,0.1)`, flexShrink: 0 }}>
            <Icon style={{ width: 22, height: 22, color: ACCENT, strokeWidth: 1.8 }} />
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, height: 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── helpers (unchanged) ─────────────────────────────────────────────────────
function getLast6Months() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
}

function calcMoM(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ─── KPI mini-card (inline, replaces StatCard for uniform Heillo styling) ─────
function KpiCard({ title, value, icon: Icon }) {
  return (
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{title}</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: DARK, margin: "6px 0 0" }}>{value}</p>
        </div>
        {Icon && (
          <div style={{ padding: 10, borderRadius: 12, background: `rgba(245,136,94,0.1)`, flexShrink: 0 }}>
            <Icon style={{ width: 22, height: 22, color: ACCENT, strokeWidth: 1.8 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);

  // ── Data fetching (unchanged) ──
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => fetchProductsWithPending(() => base44.entities.Product.list("-created_date")) });
  const pendingDeletedIds = (() => { try { return new Set(JSON.parse(sessionStorage.getItem("pendingDeletedProducts") || "[]")); } catch { return new Set(); } })();
  const activeProductCount = products.filter(p => !pendingDeletedIds.has(p.id)).length;

  const { data: customers = [] } = useQuery({
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

  const { data: quotes = [] } = useQuery({ queryKey: ["dashboard-quotes"], queryFn: () => base44.entities.Quote.list("-created_date") });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list("-created_date") });
  const { data: orders = [] } = useQuery({ queryKey: ["dashboard-orders"], queryFn: () => base44.entities.Order.list("-created_date") });

  const currentMonthNum = new Date().getMonth() + 1;
  const currentYearNum = new Date().getFullYear();
  const { data: monthlyGoal } = useQuery({
    queryKey: ["monthly-goal", currentYearNum, currentMonthNum],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("monthly_goals")
        .select("*")
        .eq("user_id", user?.id)
        .eq("month", currentMonthNum)
        .eq("year", currentYearNum)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const { data: dueTasks = [] } = useQuery({
    queryKey: ["due-tasks", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_tasks")
        .select("id, customer_id, title, due_date")
        .eq("status", "פתוח")
        .lte("due_date", today)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Calculations (unchanged) ──
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const lowStock = products.filter(p => !pendingDeletedIds.has(p.id) && p.quantity <= (p.min_quantity || 0));
  const totalSales = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
  const monthlyData = getMonthlyData(invoices);
  const topProducts = getTopProducts(invoices);
  const ordersPerMonth = getOrdersPerMonth(orders);
  const monthlyProfit = getMonthlyProfit(orders, products);

  const now = new Date();
  const newCustomersThisMonth = customers
    .filter(c => {
      const d = c.created_date ? new Date(c.created_date) : null;
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const openOrders = orders
    .filter(o => o.status && o.status !== "הושלם" && o.status !== "בוטל")
    .sort((a, b) => new Date(b.date || b.created_date) - new Date(a.date || a.created_date));

  const unpaidInvoices = invoices
    .filter(inv => inv.payment_status && inv.payment_status !== "שולם")
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const currentMonthIdx = now.getMonth();
  const salesActualThisMonth = monthlyData[currentMonthIdx]?.total || 0;
  const profitActualThisMonth = monthlyProfit[currentMonthIdx]?.profit || 0;
  const ordersActualThisMonth = ordersPerMonth[currentMonthIdx]?.count || 0;

  const last6 = getLast6Months();
  const customerSparkData = last6.map(({ year, month }) => ({
    value: customers.filter(c => {
      const d = c.created_date ? new Date(c.created_date) : null;
      return d && d.getFullYear() === year && d.getMonth() === month;
    }).length,
  }));
  const customerMoM = calcMoM(customerSparkData[5].value, customerSparkData[4].value);

  const salesSparkData = last6.map(({ year, month }) => ({
    value: invoices
      .filter(inv => { const d = inv.date ? new Date(inv.date) : null; return d && d.getFullYear() === year && d.getMonth() === month; })
      .reduce((s, inv) => s + (inv.total || 0), 0),
  }));
  const salesMoM = calcMoM(salesSparkData[5].value, salesSparkData[4].value);

  // ── Tooltip style for charts ──
  const tooltipStyle = { background: CARD_BG, border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, fontFamily: "'Heebo', sans-serif", fontSize: 12 };

  /* OLD return JSX:
  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <PageHeader ... />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard ... /> × 4 + <KpiSparkCard ... /> × 2
      </div>
      ... (all old card divs with rounded-lg, shadow-sm, border-gray-100)
    </div>
  );
  */

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0", fontFamily: "'Heebo', sans-serif", padding: 32, paddingTop: 24 }}>
      <PageHeader title="דשבורד" description="סקירה כללית של העסק" />

      {/* ── Section 1: KPI cards ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 20 }}
           className="sm:grid-cols-3 xl:grid-cols-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 col-span-full">
          <KpiCard title="מוצרים במלאי" value={activeProductCount} icon={Package} />
          <KpiCard title="מלאי נמוך" value={lowStock.length} icon={AlertTriangle} />
          <KpiCard title="הצעות מחיר" value={quotes.length} icon={FileText} />
          <KpiCard title="חשבוניות" value={invoices.length} icon={Receipt} />
          <KpiSparkCard title="מכירות" icon={TrendingUp} value={formatCurrency(Math.round(totalSales))} sparkData={salesSparkData} pct={salesMoM} />
          <KpiSparkCard title="לקוחות" icon={Users} value={customers.length} sparkData={customerSparkData} pct={customerMoM} />
        </div>
      </div>

      {/* ── Section 2: Charts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4" style={{ marginBottom: 20 }}>
        {/* Monthly sales bar chart — xl: 2 cols */}
        <div style={{ ...CARD_STYLE }} className="xl:col-span-2">
          <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: "0 0 16px" }}>מכירות חודשיות</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={<CustomYAxisTick />} tickLine={false} axisLine={false} width={130} />
                <Tooltip formatter={(val) => `₪${val.toLocaleString()}`} contentStyle={tooltipStyle} />
                <Bar dataKey="total" fill={ACCENT} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top products pie */}
        <div style={CARD_STYLE}>
          <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: "0 0 12px" }}>מוצרים נמכרים ביותר</h3>
          {topProducts.length > 0 ? (
            <>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={topProducts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                      {topProducts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(val) => val} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div dir="rtl" style={{ marginTop: 12 }}>
                {topProducts.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: i < topProducts.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ flexShrink: 0, width: 10, height: 10, borderRadius: "50%", background: COLORS[i % COLORS.length] }} />
                      <span style={{ fontSize: 13, color: DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">{item.name}</span>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 500, color: MUTED }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: MUTED }}>אין נתונים עדיין</div>
          )}
        </div>

        {/* Monthly orders bar chart */}
        <div style={CARD_STYLE}>
          <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: "0 0 16px" }}>הזמנות חודשיות</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ordersPerMonth} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={<CustomYAxisTickCount />} tickLine={false} axisLine={false} width={130} allowDecimals={false} />
                <Tooltip formatter={(val) => val.toLocaleString()} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={ACCENT} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly profit bar chart */}
        <div style={CARD_STYLE}>
          <h3 style={{ fontWeight: 600, fontSize: 15, color: DARK, margin: "0 0 16px" }}>רווח חודשי</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyProfit} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={<CustomYAxisTick />} tickLine={false} axisLine={false} width={130} />
                <Tooltip formatter={(val) => `₪${val.toLocaleString()}`} contentStyle={tooltipStyle} />
                <Bar dataKey="profit" fill={ACCENT} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Section 3: Operational lists ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginBottom: 20 }}>
        <ListCard
          title="לקוחות חדשים החודש"
          count={newCustomersThisMonth.length}
          items={newCustomersThisMonth.slice(0, 5)}
          emptyText="אין לקוחות חדשים החודש"
          onClick={(c) => navigate(`/customers/${c.id}`)}
          renderItem={(c) => (
            <>
              <span style={{ fontSize: 13, color: DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <span style={{ flexShrink: 0, fontSize: 11, color: MUTED }}>{c.created_date?.slice(0, 10).split("-").reverse().join("/")}</span>
            </>
          )}
        />

        <ListCard
          title="הזמנות פתוחות"
          count={openOrders.length}
          items={openOrders.slice(0, 5)}
          emptyText="אין הזמנות פתוחות"
          onClick={() => navigate("/orders")}
          renderItem={(o) => (
            <>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, color: DARK, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customer_name || `הזמנה #${o.order_number || o.id}`}</span>
                <span style={{ fontSize: 11, color: MUTED }}>{o.date?.slice(0, 10).split("-").reverse().join("/")}</span>
              </div>
              <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${getOrderStatusColor(o.status)}`}>{o.status}</span>
            </>
          )}
        />

        <ListCard
          title="חשבוניות לא שולמו"
          count={unpaidInvoices.length}
          items={unpaidInvoices.slice(0, 5)}
          emptyText="כל החשבוניות שולמו"
          onClick={() => navigate("/invoices")}
          renderItem={(inv) => (
            <>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, color: DARK, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.customer_name}</span>
                <span style={{ fontSize: 11, color: MUTED }}>{inv.date?.slice(0, 10).split("-").reverse().join("/")} · ₪{((inv.total || 0) - (inv.paid_amount || 0)).toLocaleString()}</span>
              </div>
              <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${getPaymentStatusColor(inv.payment_status)}`}>{inv.payment_status}</span>
            </>
          )}
        />
      </div>

      {/* ── Section 4: Alerts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ marginBottom: 20 }}>
        {dueTasks.length > 0 && (
          <div style={{ ...CARD_STYLE, borderColor: "rgba(245,136,94,0.2)" }}>
            <h3 style={{ fontWeight: 600, fontSize: 14, color: ACCENT, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarClock style={{ width: 16, height: 16 }} /> משימות לביצוע היום ({dueTasks.length})
            </h3>
            <div>
              {dueTasks.map(task => {
                const isOverdue = task.due_date < today;
                return (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/customer-ledger?customer=${task.customer_id}&tab=tasks`)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 6px", borderBottom: "1px solid rgba(0,0,0,0.04)",
                      background: "transparent", border: "none", borderBottom: "1px solid rgba(0,0,0,0.04)",
                      cursor: "pointer", textAlign: "right", transition: "background 0.2s ease", borderRadius: 8,
                      fontFamily: "'Heebo', sans-serif",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(245,136,94,0.04)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 500, fontSize: 13, color: DARK, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
                      <span style={{ fontSize: 11, color: MUTED }}>{customerMap[task.customer_id] || "לקוח לא ידוע"}</span>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 500, marginRight: 12, color: isOverdue ? "#ef4444" : ACCENT }}>
                      {isOverdue ? "⚠️ " : "📅 "}{task.due_date?.split("-").reverse().join("/")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {lowStock.length > 0 && (
          <div style={{ ...CARD_STYLE, borderColor: "rgba(239,68,68,0.15)", maxHeight: 280, display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontWeight: 600, fontSize: 14, color: "#ef4444", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <AlertTriangle style={{ width: 16, height: 16 }} /> התראות מלאי נמוך
            </h3>
            <div className="overflow-y-auto thin-scrollbar" style={{ flex: 1 }}>
              {lowStock.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, fontSize: 13, color: DARK }}>{p.name}</span>
                  <span style={{ fontSize: 13, color: "#ef4444" }}>{p.quantity} / {p.min_quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Goal vs Actual ────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <GoalProgressCard
          goal={monthlyGoal}
          salesActual={salesActualThisMonth}
          profitActual={profitActualThisMonth}
          ordersActual={ordersActualThisMonth}
          month={currentMonthNum}
          year={currentYearNum}
          onOpenDialog={() => setGoalDialogOpen(true)}
        />
      </div>

      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        existingGoal={monthlyGoal}
        month={currentMonthNum}
        year={currentYearNum}
      />
    </div>
  );
}

// ─── Data helpers (unchanged) ─────────────────────────────────────────────────
function getMonthlyData(invoices) {
  const months = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];
  const data = months.map((month) => ({ month, total: 0 }));
  invoices.forEach(inv => {
    if (inv.date) {
      const m = new Date(inv.date).getMonth();
      data[m].total += inv.total || 0;
    }
  });
  return data;
}

function getOrdersPerMonth(orders) {
  const months = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];
  const data = months.map((month) => ({ month, count: 0 }));
  orders.forEach(order => {
    if (order.date) {
      const m = new Date(order.date).getMonth();
      data[m].count += 1;
    }
  });
  return data;
}

// Same profit formula as src/pages/Reports.jsx (profitability/monthlyData): per item, profit = item.total - buy_price * quantity
function getMonthlyProfit(orders, products) {
  const months = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];
  const data = months.map((month) => ({ month, profit: 0 }));
  orders.forEach(order => {
    if (!order.date || !Array.isArray(order.items)) return;
    const m = new Date(order.date).getMonth();
    order.items.forEach(item => {
      if (!item || item.is_header) return;
      const qty = item.quantity || 0;
      const itemSales = item.total || 0;
      const buyPrice = item.buy_price != null ? Number(item.buy_price) : (products.find(p => p.id === item.product_id)?.buy_price || 0);
      data[m].profit += itemSales - (isNaN(buyPrice) ? 0 : buyPrice) * qty;
    });
  });
  return data;
}

function getTopProducts(invoices) {
  const map = {};
  invoices.forEach(inv => {
    (inv.items || []).forEach(item => {
      map[item.name] = (map[item.name] || 0) + (item.quantity || 0);
    });
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));
}
