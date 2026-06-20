import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { TrendingUp, TrendingDown, DollarSign, Wrench, ShoppingCart, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";
import PageHeader from "@/components/shared/PageHeader";

const COLORS = ["hsl(48,96%,53%)", "hsl(200,60%,50%)", "hsl(150,50%,45%)", "hsl(280,60%,55%)", "hsl(20,80%,55%)"];
const MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];

function StatBox({ title, value, sub, icon: Icon, color = "text-foreground", bgColor = "bg-muted/50" }) {
  return (
    <div className={`${bgColor} rounded-xl border border-border p-5 flex items-center gap-4`}>
      <div className="w-12 h-12 rounded-xl bg-card flex items-center justify-center shadow-sm shrink-0">
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm font-medium">{title}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function ProfitTracking() {
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list("-created_date") });
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list() });
  const { data: tickets = [] } = useQuery({ queryKey: ["repair-tickets"], queryFn: () => base44.entities.RepairTicket.list() });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });

  const currentYear = new Date().getFullYear();

  // Invoice revenue per month
  const monthlyRevenue = MONTHS.map((month, i) => {
    const inv = invoices.filter(inv => {
      if (!inv.date) return false;
      const d = new Date(inv.date);
      return d.getFullYear() === currentYear && d.getMonth() === i;
    });
    const revenue = inv.reduce((s, x) => s + (x.total || 0), 0);
    return { month, revenue };
  });

  // Repair ticket profit
  const repairRevenue = tickets.reduce((s, t) => s + (t.final_cost || 0), 0);
  const repairCosts = tickets.reduce((s, t) => s + (t.parts_cost || 0) + (t.labor_cost || 0), 0);
  const repairProfit = repairRevenue - repairCosts;

  // Total invoice revenue
  const totalInvoiceRevenue = invoices.reduce((s, inv) => s + (inv.total || 0), 0);

  // Orders total
  const totalOrdersValue = orders.reduce((s, o) => s + (o.total || 0), 0);

  // Inventory value
  const inventoryValue = products.reduce((s, p) => s + (p.quantity || 0) * (p.cost_price || p.price || 0), 0);

  // Revenue breakdown pie
  const pieData = [
    { name: "חשבוניות", value: Math.round(totalInvoiceRevenue) },
    { name: "קריאות שירות", value: Math.round(repairRevenue) },
  ].filter(d => d.value > 0);

  // Monthly repair tickets
  const monthlyRepairs = MONTHS.map((month, i) => {
    const mTickets = tickets.filter(t => {
      if (!t.received_date) return false;
      const d = new Date(t.received_date);
      return d.getFullYear() === currentYear && d.getMonth() === i;
    });
    return {
      month,
      revenue: mTickets.reduce((s, t) => s + (t.final_cost || 0), 0),
      cost: mTickets.reduce((s, t) => s + (t.parts_cost || 0) + (t.labor_cost || 0), 0),
    };
  });

  // Top customers by invoice total
  const customerTotals = {};
  invoices.forEach(inv => {
    if (inv.customer_name) {
      customerTotals[inv.customer_name] = (customerTotals[inv.customer_name] || 0) + (inv.total || 0);
    }
  });
  const topCustomers = Object.entries(customerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total }));

  return (
    <div>
      <PageHeader title="מעקב רווחיות" description="ניתוח הכנסות, עלויות ורווחים" />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatBox title="הכנסות חשבוניות" value={`₪${Math.round(totalInvoiceRevenue).toLocaleString()}`} icon={DollarSign} color="text-green-600" />
        <StatBox title="הכנסות שירות" value={`₪${Math.round(repairRevenue).toLocaleString()}`} icon={Wrench} color="text-blue-600" />
        <StatBox title="רווח שירות" value={`₪${Math.round(repairProfit).toLocaleString()}`} sub={`${repairRevenue > 0 ? Math.round((repairProfit / repairRevenue) * 100) : 0}% מרווח`} icon={TrendingUp} color={repairProfit >= 0 ? "text-green-600" : "text-red-600"} />
        <StatBox title="עלות חלקים" value={`₪${Math.round(repairCosts).toLocaleString()}`} icon={TrendingDown} color="text-orange-600" />
        <StatBox title="ערך הזמנות" value={`₪${Math.round(totalOrdersValue).toLocaleString()}`} icon={ShoppingCart} color="text-purple-600" />
        <StatBox title="ערך מלאי" value={`₪${Math.round(inventoryValue).toLocaleString()}`} icon={BarChart2} color="text-yellow-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Invoice Revenue */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">הכנסות חשבוניות חודשיות {currentYear}</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₪${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => `₪${Number(v).toLocaleString()}`} />
                <Bar dataKey="revenue" name="הכנסות" fill="hsl(48,96%,53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Repair profit per month */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">רווחיות קריאות שירות חודשית {currentYear}</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRepairs}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₪${v}`} />
                <Tooltip formatter={v => `₪${Number(v).toLocaleString()}`} />
                <Bar dataKey="revenue" name="הכנסה" fill="hsl(150,50%,45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="עלות" fill="hsl(20,80%,55%)" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue breakdown pie */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">פירוט הכנסות לפי מקור</h3>
          {pieData.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => `₪${Number(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">אין נתונים עדיין</div>
          )}
        </div>

        {/* Top customers */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">לקוחות מובילים לפי הכנסה</h3>
          {topCustomers.length > 0 ? (
            <div className="space-y-3">
              {topCustomers.map((c, i) => {
                const pct = totalInvoiceRevenue > 0 ? (c.total / totalInvoiceRevenue) * 100 : 0;
                return (
                  <div key={c.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{i + 1}. {c.name}</span>
                      <span className="text-muted-foreground">₪{Math.round(c.total).toLocaleString()} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">אין נתוני חשבוניות עדיין</div>
          )}
        </div>
      </div>
    </div>
  );
}
