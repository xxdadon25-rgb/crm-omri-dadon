import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend
} from "recharts";
import PageHeader from "@/components/shared/PageHeader";

const COLORS = ["hsl(48,96%,53%)", "hsl(200,60%,50%)", "hsl(150,50%,45%)", "hsl(280,60%,55%)", "hsl(20,80%,55%)"];
const MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];

function StatBox({ title, value, sub, icon: Icon, color = "text-foreground" }) {
  return (
    <div className="bg-muted/50 rounded-xl border border-border p-5 flex items-center gap-4">
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
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });

  const currentYear = new Date().getFullYear();

  // הכנסות ממכירות — סכום כל החשבוניות
  const totalInvoiceRevenue = invoices.reduce((s, inv) => s + (inv.total || 0), 0);

  // עלות סחורה — סכום buy_price * quantity בכל פריטי ההזמנות
  const totalCogs = orders.reduce((s, o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    return s + items.reduce((si, item) => {
      if (!item) return si;
      const bp = item.buy_price != null ? Number(item.buy_price) : 0;
      const qty = item.quantity != null ? Number(item.quantity) : 1;
      return si + bp * qty;
    }, 0);
  }, 0);

  // רווח נטו
  const netProfit = totalInvoiceRevenue - totalCogs;

  // ערך הזמנות פתוחות — הזמנות שטרם שולמו
  const openOrdersValue = orders
    .filter(o => o.payment_status !== "שולם" && o.payment_status !== "paid")
    .reduce((s, o) => s + (o.total || 0), 0);

  // שווי מלאי — buy_price * quantity לכל מוצר
  const inventoryValue = products.reduce((s, p) => {
    const bp = p.buy_price != null ? Number(p.buy_price) : (p.cost_price != null ? Number(p.cost_price) : 0);
    return s + (Number(p.quantity) || 0) * bp;
  }, 0);

  // גרף חודשי — הכנסות מחשבוניות מול עלות סחורה מהזמנות
  const monthlyData = MONTHS.map((month, i) => {
    const revenue = invoices
      .filter(inv => {
        if (!inv.date) return false;
        const d = new Date(inv.date);
        return d.getFullYear() === currentYear && d.getMonth() === i;
      })
      .reduce((s, inv) => s + (inv.total || 0), 0);

    const cost = orders
      .filter(o => {
        if (!o.date) return false;
        const d = new Date(o.date);
        return d.getFullYear() === currentYear && d.getMonth() === i;
      })
      .reduce((s, o) => {
        const items = Array.isArray(o.items) ? o.items : [];
        return s + items.reduce((si, item) => {
          if (!item) return si;
          const bp = item.buy_price != null ? Number(item.buy_price) : 0;
          const qty = item.quantity != null ? Number(item.quantity) : 1;
          return si + bp * qty;
        }, 0);
      }, 0);

    return { month, revenue: Math.round(revenue), cost: Math.round(cost) };
  });

  // לקוחות מובילים לפי הכנסה
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
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <StatBox title="הכנסות (ממכירות)" value={`₪${Math.round(totalInvoiceRevenue).toLocaleString()}`} icon={DollarSign} color="text-green-600" />
        <StatBox title="עלות סחורה (רכישות מספקים)" value={`₪${Math.round(totalCogs).toLocaleString()}`} icon={TrendingDown} color="text-orange-600" />
        <StatBox
          title="רווח נטו (הכנסות פחות עלות סחורה)"
          value={`₪${Math.round(netProfit).toLocaleString()}`}
          sub={`${totalInvoiceRevenue > 0 ? Math.round((netProfit / totalInvoiceRevenue) * 100) : 0}% מרווח`}
          icon={TrendingUp}
          color={netProfit >= 0 ? "text-green-600" : "text-red-600"}
        />
        <StatBox title="ערך הזמנות פתוחות (הזמנות שטרם שולמו)" value={`₪${Math.round(openOrdersValue).toLocaleString()}`} icon={ShoppingCart} color="text-purple-600" />
        <StatBox title="שווי מלאי (ערך המוצרים במחסן)" value={`₪${Math.round(inventoryValue).toLocaleString()}`} icon={BarChart2} color="text-yellow-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly income vs cost */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-4">רווחיות חודשית (הכנסות מול עלויות) {currentYear}</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={v => `₪${Number(v).toLocaleString()}`} />
                <Bar dataKey="revenue" name="הכנסות" fill="hsl(150,50%,45%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="עלות סחורה" fill="hsl(20,80%,55%)" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
