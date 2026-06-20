import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { Package, AlertTriangle, FileText, Receipt, TrendingUp, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import StatCard from "@/components/shared/StatCard";
import PageHeader from "@/components/shared/PageHeader";

const COLORS = ["hsl(48, 96%, 53%)", "hsl(200, 60%, 50%)", "hsl(150, 50%, 45%)", "hsl(280, 60%, 55%)", "hsl(20, 80%, 55%)"];

export default function Dashboard() {
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
        if (ageMs >= 180000) {
          sessionStorage.removeItem("pendingCustomer");
        }
        return result;
      }
      return [pendingCustomer, ...result];
    },
  });
  const { data: quotes = [] } = useQuery({ queryKey: ["dashboard-quotes"], queryFn: () => base44.entities.Quote.list("-created_date") });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list("-created_date") });

  const lowStock = products.filter(p => !pendingDeletedIds.has(p.id) && p.quantity <= (p.min_quantity || 0));
  const totalSales = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  const monthlyData = getMonthlyData(invoices);
  const topProducts = getTopProducts(invoices);

  return (
    <div>
      <PageHeader title="דשבורד" description="סקירה כללית של העסק" />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard title="מוצרים במלאי" value={activeProductCount} icon={Package} />
        <StatCard title="מלאי נמוך" value={lowStock.length} icon={AlertTriangle} className={lowStock.length > 0 ? "border-destructive/30" : ""} />
        <StatCard title="הצעות מחיר" value={quotes.length} icon={FileText} />
        <StatCard title="חשבוניות" value={invoices.length} icon={Receipt} />
        <StatCard title="מכירות חודשיות" value={`₪${totalSales.toLocaleString()}`} icon={TrendingUp} />
        <StatCard title="לקוחות" value={customers.length} icon={Users} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">מכירות חודשיות</h3>
          <div className="h-[280px]">
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

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">מוצרים נמכרים ביותר</h3>
          {topProducts.length > 0 ? (
            <div className="h-[280px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={topProducts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name }) => name}>
                    {topProducts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(val) => val} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">אין נתונים עדיין</div>
          )}
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="mt-6 bg-card rounded-xl border border-destructive/20 p-5">
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
  const data = months.map((month, i) => ({ month, total: 0 }));
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