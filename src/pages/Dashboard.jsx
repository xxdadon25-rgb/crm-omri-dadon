import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { Package, AlertTriangle, FileText, Receipt, TrendingUp, Users, CalendarClock, ArrowUp, ArrowDown, Target, Pencil } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import StatCard from "@/components/shared/StatCard";
import PageHeader from "@/components/shared/PageHeader";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const COLORS = ["hsl(48, 96%, 53%)", "hsl(200, 60%, 50%)", "hsl(150, 50%, 45%)", "hsl(280, 60%, 55%)", "hsl(20, 80%, 55%)"];

const CustomYAxisTick = ({ x, y, payload }) => (
  <text x={x - 40} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">
    {`${Number(payload.value).toLocaleString()} ₪`}
  </text>
);

const CustomYAxisTickCount = ({ x, y, payload }) => (
  <text x={x - 40} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">
    {Number(payload.value).toLocaleString()}
  </text>
);

const PlaceholderCard = ({ title }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
    <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
    <div className="flex-1 flex items-center justify-center py-6">
      <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">בקרוב</span>
    </div>
  </div>
);

// const orderStatusColors = {
//   "טיוטה": "bg-gray-100 text-gray-700",
//   "ממתין לאישור": "bg-yellow-100 text-yellow-800",
//   "אושר": "bg-blue-100 text-blue-800",
//   "בהכנה": "bg-purple-100 text-purple-800",
//   "הושלם": "bg-green-100 text-green-800",
//   "בוטל": "bg-red-100 text-red-800",
// };
// const paymentStatusColors = {
//   "ממתין לתשלום": "bg-amber-100 text-amber-700",
//   "שולם חלקית": "bg-blue-100 text-blue-700",
//   "שולם": "bg-green-100 text-green-700",
//   "באיחור": "bg-red-100 text-red-700",
// };
import { getOrderStatusColor, getPaymentStatusColor } from "@/utils/statusColors";

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
        <button
          type="button"
          onClick={onOpenDialog}
          title="עריכת יעד"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer shrink-0 text-xs font-medium"
        >
          <Pencil className="w-4 h-4" />
          עריכת יעד
        </button>
      </div>
      <div className="space-y-4">
        <GoalProgressBar label="מכירות" actual={salesActual} goal={goal.sales_goal || 0} formatValue={(v) => `${Math.round(v).toLocaleString()} ₪`} />
        <GoalProgressBar label="רווח" actual={profitActual} goal={goal.profit_goal || 0} formatValue={(v) => `${Math.round(v).toLocaleString()} ₪`} />
        <GoalProgressBar label="הזמנות" actual={ordersActual} goal={goal.orders_goal || 0} formatValue={(v) => `${v.toLocaleString()}`} />
      </div>
    </div>
  );
}

// Returns array of {month, value} for the last 6 calendar months (oldest→newest)
function getLast6Months() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() }; // month 0-indexed
  });
}

function calcMoM(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function KpiSparkCard({ title, icon: Icon, value, sparkData, pct }) {
  const isPositive = pct !== null && pct > 0;
  const isNegative = pct !== null && pct < 0;
  const lineColor = isNegative ? "#ef4444" : "#22c55e";
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col justify-between transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          <p className={`text-xs mt-1 font-medium flex items-center gap-0.5 ${isPositive ? "text-green-600" : isNegative ? "text-red-500" : "text-muted-foreground"}`}>
            {isPositive && <ArrowUp className="w-3 h-3" />}
            {isNegative && <ArrowDown className="w-3 h-3" />}
            {pct === null ? "— אין נתון קודם" : `${Math.abs(pct)}% לעומת חודש קודם`}
          </p>
        </div>
        {Icon && (
          <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        )}
      </div>
      <div className="mt-2 h-[36px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);

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

  // Reuse the already-computed monthlyData / monthlyProfit / ordersPerMonth arrays (same logic as the charts above)
  const currentMonthIdx = now.getMonth();
  const salesActualThisMonth = monthlyData[currentMonthIdx]?.total || 0;
  const profitActualThisMonth = monthlyProfit[currentMonthIdx]?.profit || 0;
  const ordersActualThisMonth = ordersPerMonth[currentMonthIdx]?.count || 0;

  // Month-over-month sparkline data
  const last6 = getLast6Months();

  const customerSparkData = last6.map(({ year, month }) => ({
    value: customers.filter(c => {
      const d = c.created_date ? new Date(c.created_date) : null;
      return d && d.getFullYear() === year && d.getMonth() === month;
    }).length,
  }));
  const customerMoM = calcMoM(
    customerSparkData[5].value,
    customerSparkData[4].value
  );

  const salesSparkData = last6.map(({ year, month }) => ({
    value: invoices
      .filter(inv => { const d = inv.date ? new Date(inv.date) : null; return d && d.getFullYear() === year && d.getMonth() === month; })
      .reduce((s, inv) => s + (inv.total || 0), 0),
  }));
  const salesMoM = calcMoM(salesSparkData[5].value, salesSparkData[4].value);

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <PageHeader title="דשבורד" description="סקירה כללית של העסק" />

      {/* ── Section 1: KPI cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard title="מוצרים במלאי" value={activeProductCount} icon={Package} />
        <StatCard title="מלאי נמוך" value={lowStock.length} icon={AlertTriangle} className={lowStock.length > 0 ? "border-destructive/30" : ""} />
        <StatCard title="הצעות מחיר" value={quotes.length} icon={FileText} />
        <StatCard title="חשבוניות" value={invoices.length} icon={Receipt} />
        <KpiSparkCard title="מכירות" icon={TrendingUp} value={`₪${Math.round(totalSales).toLocaleString()}`} sparkData={salesSparkData} pct={salesMoM} />
        <KpiSparkCard title="לקוחות" icon={Users} value={customers.length} sparkData={customerSparkData} pct={customerMoM} />
      </div>

      {/* ── Section 2: Charts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        {/* Live: monthly sales bar chart — spans 2 cols on xl */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 xl:col-span-2">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">מכירות חודשיות</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={<CustomYAxisTick />} tickLine={false} axisLine={true} width={130} />
                <Tooltip formatter={(val) => `₪${val.toLocaleString()}`} />
                <Bar dataKey="total" fill="hsl(48, 96%, 53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live: top products pie chart + custom legend */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-3">מוצרים נמכרים ביותר</h3>
          {topProducts.length > 0 ? (
            <>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={topProducts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                      {topProducts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(val) => val} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div dir="rtl" className="mt-3">
                {topProducts.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-sm text-gray-700 truncate" dir="auto">{item.name}</span>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-gray-400">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">אין נתונים עדיין</div>
          )}
        </div>

        {/* Live: monthly orders count bar chart */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">הזמנות חודשיות</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ordersPerMonth} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={<CustomYAxisTickCount />} tickLine={false} axisLine={true} width={130} allowDecimals={false} />
                <Tooltip formatter={(val) => val.toLocaleString()} />
                <Bar dataKey="count" fill="hsl(200, 60%, 50%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live: monthly profit bar chart */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">רווח חודשי</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyProfit} margin={{ right: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={<CustomYAxisTick />} tickLine={false} axisLine={true} width={130} />
                <Tooltip formatter={(val) => `₪${val.toLocaleString()}`} />
                <Bar dataKey="profit" fill="hsl(150, 50%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Section 3: Operational lists (placeholders) ──────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <ListCard
          title="לקוחות חדשים החודש"
          count={newCustomersThisMonth.length}
          items={newCustomersThisMonth.slice(0, 5)}
          emptyText="אין לקוחות חדשים החודש"
          onClick={(c) => navigate(`/customers/${c.id}`)}
          renderItem={(c) => (
            <>
              <span className="text-sm text-gray-700 truncate">{c.name}</span>
              <span className="shrink-0 text-xs text-gray-400">{c.created_date?.slice(0, 10).split("-").reverse().join("/")}</span>
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
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-700 truncate block">{o.customer_name || `הזמנה #${o.order_number || o.id}`}</span>
                <span className="text-xs text-gray-400">{o.date?.slice(0, 10).split("-").reverse().join("/")}</span>
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
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-700 truncate block">{inv.customer_name}</span>
                <span className="text-xs text-gray-400">{inv.date?.slice(0, 10).split("-").reverse().join("/")} · ₪{((inv.total || 0) - (inv.paid_amount || 0)).toLocaleString()}</span>
              </div>
              <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${getPaymentStatusColor(inv.payment_status)}`}>{inv.payment_status}</span>
            </>
          )}
        />
      </div>

      {/* ── Section 4: Alerts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {dueTasks.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-amber-200 p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-amber-700 text-sm">
              <CalendarClock className="w-4 h-4" /> משימות לביצוע היום ({dueTasks.length})
            </h3>
            <div className="space-y-1">
              {dueTasks.map(task => {
                const isOverdue = task.due_date < today;
                return (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/customer-ledger?customer=${task.customer_id}&tab=tasks`)}
                    className="w-full flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 rounded px-1 transition-colors text-right"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-sm block truncate">{task.title}</span>
                      <span className="text-xs text-gray-500">{customerMap[task.customer_id] || "לקוח לא ידוע"}</span>
                    </div>
                    <span className={`shrink-0 text-xs font-medium mr-3 ${isOverdue ? "text-red-600" : "text-amber-700"}`}>
                      {isOverdue ? "⚠️ " : "📅 "}{task.due_date?.split("-").reverse().join("/")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {lowStock.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-red-200 p-5 flex flex-col max-h-[280px]">
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-red-600 text-sm shrink-0">
              <AlertTriangle className="w-4 h-4" /> התראות מלאי נמוך
            </h3>
            <div className="space-y-1 overflow-y-auto thin-scrollbar pr-1">
              {lowStock.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-sm text-red-600">{p.quantity} / {p.min_quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Goal vs Actual ────────────────────────────────────── */}
      <div className="mb-6">
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
