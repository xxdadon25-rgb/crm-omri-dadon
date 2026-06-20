import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { Package, AlertTriangle, FileText, Receipt, TrendingUp, Users, Wrench, CheckCircle2, DollarSign, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import StatCard from "@/components/shared/StatCard";
import PageHeader from "@/components/shared/PageHeader";
import { useNavigate } from "react-router-dom";

const COLORS = ["hsl(48, 96%, 53%)", "hsl(200, 60%, 50%)", "hsl(150, 50%, 45%)", "hsl(280, 60%, 55%)", "hsl(20, 80%, 55%)"];

const STATUS_COLORS = {
  "נכנס": "bg-blue-100 text-blue-800",
  "בבדיקה": "bg-yellow-100 text-yellow-800",
  "בתיקון": "bg-orange-100 text-orange-800",
  "ממתין לחלקים": "bg-purple-100 text-purple-800",
  "מוכן לאיסוף": "bg-green-100 text-green-800",
  "נמסר": "bg-gray-100 text-gray-700",
  "בוטל": "bg-red-100 text-red-700",
};

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
  const { data: tickets = [] } = useQuery({ queryKey: ["repair-tickets"], queryFn: () => base44.entities.RepairTicket.list("-created_date") });

  const lowStock = products.filter(p => !pendingDeletedIds.has(p.id) && p.quantity <= (p.min_quantity || 0));
  const totalSales = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  const activeTickets = tickets.filter(t => !["נמסר", "בוטל"].includes(t.status));
  const readyTickets = tickets.filter(t => t.status === "מוכן לאיסוף");
  const urgentTickets = tickets.filter(t => t.priority === "דחופה" && !["נמסר", "בוטל"].includes(t.status));

  const repairRevenue = tickets.reduce((s, t) => s + (t.final_cost || 0), 0);
  const repairCosts = tickets.reduce((s, t) => s + (t.parts_cost || 0) + (t.labor_cost || 0), 0);
  const repairProfit = repairRevenue - repairCosts;

  const monthlyData = getMonthlyData(invoices);
  const topProducts = getTopProducts(invoices);

  const recentTickets = activeTickets.slice(0, 5);

  return (
    <div>
      <PageHeader title="דשבורד" description="סקירה כללית של העסק" />

      {/* Main stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard title="מוצרים במלאי" value={activeProductCount} icon={Package} />
        <StatCard title="מלאי נמוך" value={lowStock.length} icon={AlertTriangle} className={lowStock.length > 0 ? "border-destructive/30" : ""} />
        <StatCard title="הצעות מחיר" value={quotes.length} icon={FileText} />
        <StatCard title="חשבוניות" value={invoices.length} icon={Receipt} />
        <StatCard title="מכירות" value={`₪${Math.round(totalSales).toLocaleString()}`} icon={TrendingUp} />
        <StatCard title="לקוחות" value={customers.length} icon={Users} />
      </div>

      {/* Repair tickets summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/repair-tickets")}>
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <Wrench className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xl font-bold">{activeTickets.length}</p>
            <p className="text-xs text-blue-700 font-medium">קריאות פעילות</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/repair-tickets")}>
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xl font-bold">{readyTickets.length}</p>
            <p className="text-xs text-green-700 font-medium">מוכן לאיסוף</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/repair-tickets")}>
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-xl font-bold">{urgentTickets.length}</p>
            <p className="text-xs text-red-700 font-medium">דחוף</p>
          </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/profit-tracking")}>
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <DollarSign className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-xl font-bold">₪{Math.round(repairProfit).toLocaleString()}</p>
            <p className="text-xs text-yellow-700 font-medium">רווח שירות</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly sales chart */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">מכירות חודשיות</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(val) => `₪${val.toLocaleString()}`} />
                <Bar dataKey="total" fill="hsl(48, 96%, 53%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top products pie */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">מוצרים נמכרים ביותר</h3>
          {topProducts.length > 0 ? (
            <div className="h-[260px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={topProducts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({ name }) => name}>
                    {topProducts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(val) => val} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">אין נתונים עדיין</div>
          )}
        </div>
      </div>

      {/* Recent repair tickets */}
      {recentTickets.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Wrench className="w-4 h-4" /> קריאות שירות פעילות
            </h3>
            <button onClick={() => navigate("/repair-tickets")} className="text-sm text-primary hover:underline">צפה בכל הקריאות</button>
          </div>
          <div className="space-y-2">
            {recentTickets.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-4">
                <span className="text-xs font-mono text-muted-foreground w-12">#{t.ticket_number}</span>
                <span className="font-medium flex-1">{t.customer_name}</span>
                <span className="text-sm text-muted-foreground flex-1">{t.device_brand} {t.device_model}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] || "bg-gray-100 text-gray-700"}`}>{t.status}</span>
                {t.final_cost && <span className="text-sm font-semibold text-green-700">₪{Number(t.final_cost).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="bg-card rounded-xl border border-destructive/20 p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" /> התראות מלאי נמוך
          </h3>
          <div className="space-y-2">
            {lowStock.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-destructive">{p.quantity} / {p.min_quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
