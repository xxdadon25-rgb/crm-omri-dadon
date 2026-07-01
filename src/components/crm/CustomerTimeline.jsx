import { useMemo } from "react";
import { FileText, ShoppingCart, Receipt, UserPlus, ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { formatCurrency } from "@/utils/formatCurrency";

function TimelineItem({ icon: Icon, color, title, subtitle, date }) {
  return (
    <div className="flex gap-3 relative">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 pb-4 border-b border-border last:border-0">
        <p className="text-sm font-medium">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        <p className="text-xs text-muted-foreground mt-0.5">{date}</p>
      </div>
    </div>
  );
}

export default function CustomerTimeline({ customer, quotes, orders, invoices }) {
  const events = useMemo(() => {
    const list = [];

    if (customer?.created_date) {
      list.push({ date: customer.created_date, type: "created", title: "לקוח נוצר במערכת", icon: UserPlus, color: "bg-sky-100 text-sky-700" });
    }

    (quotes || []).forEach(q => {
      if (q.created_date) {
        list.push({ date: q.created_date, type: "quote", title: `הצעת מחיר #${q.quote_number} נוצרה`, subtitle: `${formatCurrency(q.total)} — ${q.status}`, icon: FileText, color: "bg-purple-100 text-purple-700" });
      }
      if (q.status === "נשלח" && q.updated_date) {
        list.push({ date: q.updated_date, type: "quote_sent", title: `הצעת מחיר #${q.quote_number} נשלחה`, subtitle: `${formatCurrency(q.total)}`, icon: ArrowRight, color: "bg-blue-100 text-blue-700" });
      }
      if ((q.status === "הומרה להזמנה" || q.status === "הומרה לחשבונית") && q.updated_date) {
        list.push({ date: q.updated_date, type: "converted", title: `הצעת מחיר #${q.quote_number} הומרה`, subtitle: q.status, icon: ArrowRight, color: "bg-green-100 text-green-700" });
      }
    });

    (orders || []).forEach(o => {
      if (o.created_date) {
        list.push({ date: o.created_date, type: "order", title: `הזמנה #${o.order_number} נוצרה`, subtitle: `${formatCurrency(o.total)} — ${o.status}`, icon: ShoppingCart, color: "bg-yellow-100 text-yellow-700" });
      }
    });

    (invoices || []).forEach(inv => {
      if (inv.created_date) {
        const fromOrder = inv.order_id ? ` (מהזמנה)` : "";
        list.push({ date: inv.created_date, type: "invoice", title: `חשבונית #${inv.invoice_number} הופקה${fromOrder}`, subtitle: `${formatCurrency(inv.total)} — ${inv.payment_status}`, icon: Receipt, color: "bg-orange-100 text-orange-700" });
      }
    });

    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [customer, quotes, orders, invoices]);

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">אין פעילות עדיין</p>;
  }

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
      {events.map((ev, i) => (
        <TimelineItem key={i} icon={ev.icon} color={ev.color} title={ev.title} subtitle={ev.subtitle} date={formatDate(ev.date)} />
      ))}
    </div>
  );
}