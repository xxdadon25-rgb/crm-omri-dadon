import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { Package, AlertTriangle, FileText, Receipt, TrendingUp, Users, CalendarClock, ArrowUp, ArrowDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import StatCard from "@/components/shared/StatCard";
import PageHeader from "@/components/shared/PageHeader";
import { useNavigate } from "react-router-dom";

const COLORS = ["hsl(48, 96%, 53%)", "hsl(200, 60%, 50%)", "hsl(150, 50%, 45%)", "hsl(280, 60%, 55%)", "hsl(20, 80%, 55%)"];

const CustomYAxisTick = ({ x, y, payload }) => (
  <text x={x - 40} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">
    {`${Number(payload.value).toLocaleString()} ₪`}
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

        {/* Placeholder charts */}
        <PlaceholderCard title="הזמנות חודשיות" />
        <PlaceholderCard title="רווח חודשי" />
      </div>

      {/* ── Section 3: Operational lists (placeholders) ──────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <PlaceholderCard title="לקוחות חדשים החודש" />
        <PlaceholderCard title="הזמנות פתוחות" />
        <PlaceholderCard title="חשבוניות לא שולמו" />
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
          <div className="bg-white rounded-lg shadow-sm border border-red-200 p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-red-600 text-sm">
              <AlertTriangle className="w-4 h-4" /> התראות מלאי נמוך
            </h3>
            <div className="space-y-1">
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

      {/* ── Section 5: Goal vs Actual (placeholder) ──────────────────────── */}
      <div className="mb-6">
        <PlaceholderCard title="יעד מול ביצוע" />
      </div>
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
