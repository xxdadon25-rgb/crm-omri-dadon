import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/utils/formatCurrency";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  return d.slice(0, 10).split("-").reverse().join("/");
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id;
}

// ─── Check queries ───────────────────────────────────────────────────────────

async function checkNegativeStock() {
  const uid = await getUserId();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,barcode,quantity")
    .eq("user_id", uid)
    .lt("quantity", 0);
  if (error) throw error;
  return data ?? [];
}

async function checkBlockedWithOpenOrders() {
  const uid = await getUserId();
  // Fetch open orders
  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select("id,order_number,date,customer_id,customer_name,status")
    .eq("user_id", uid)
    .not("status", "in", '("הושלם","בוטל")');
  if (oErr) throw oErr;
  if (!orders?.length) return [];

  // Fetch blocked customers
  const { data: customers, error: cErr } = await supabase
    .from("customers")
    .select("id,name,is_blocked")
    .eq("user_id", uid)
    .eq("is_blocked", true);
  if (cErr) throw cErr;

  const blockedIds = new Set((customers ?? []).map(c => c.id));
  return orders.filter(o => blockedIds.has(o.customer_id));
}

async function checkOverpaidInvoices() {
  const uid = await getUserId();
  const { data, error } = await supabase
    .from("invoices")
    .select("id,invoice_number,customer_name,total,paid_amount")
    .eq("user_id", uid)
    .filter("paid_amount", "gt", "total");
  if (error) throw error;
  // supabase column comparison filter may not work cross-column; filter client-side as fallback
  const all = data ?? [];
  return all.filter(i => (i.paid_amount || 0) > (i.total || 0));
}

async function checkOverpaidInvoicesFallback() {
  const uid = await getUserId();
  const { data, error } = await supabase
    .from("invoices")
    .select("id,invoice_number,customer_name,total,paid_amount")
    .eq("user_id", uid)
    .gt("paid_amount", 0);
  if (error) throw error;
  return (data ?? []).filter(i => (i.paid_amount || 0) > (i.total || 0));
}

async function checkHighDebtNotBlocked() {
  const uid = await getUserId();
  const [{ data: customers, error: cErr }, { data: invoices, error: iErr }] = await Promise.all([
    supabase.from("customers").select("id,name,is_blocked").eq("user_id", uid).eq("is_blocked", false),
    supabase.from("invoices").select("customer_id,total,paid_amount").eq("user_id", uid),
  ]);
  if (cErr) throw cErr;
  if (iErr) throw iErr;

  const debtMap = new Map();
  for (const inv of invoices ?? []) {
    const debt = (inv.total || 0) - (inv.paid_amount || 0);
    if (debt > 0) debtMap.set(inv.customer_id, (debtMap.get(inv.customer_id) || 0) + debt);
  }

  return (customers ?? [])
    .map(c => ({ ...c, totalDebt: debtMap.get(c.id) || 0 }))
    .filter(c => c.totalDebt > 5000);
}

async function checkFulfilledNoDeduction() {
  const uid = await getUserId();
  // Orders that are fulfilled but inventory_deducted is false or null
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_number,date,customer_name,fulfilled,inventory_deducted")
    .eq("user_id", uid)
    .eq("fulfilled", true)
    .or("inventory_deducted.is.null,inventory_deducted.eq.false");
  if (error) throw error;
  return data ?? [];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CheckCard({ title, description, isLoading, error, issues, children }) {
  const count = issues?.length ?? 0;
  const ok = !error && count === 0;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-border">
        <div>
          <h3 className="font-semibold text-base">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        <div className="shrink-0 mt-0.5">
          {isLoading ? (
            <Badge className="bg-gray-100 text-gray-500">בודק...</Badge>
          ) : error ? (
            <Badge className="bg-red-100 text-red-700">שגיאה</Badge>
          ) : ok ? (
            <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> תקין
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {count} בעיות
            </Badge>
          )}
        </div>
      </div>

      {!isLoading && !error && count > 0 && (
        <div className="overflow-x-auto">{children}</div>
      )}

      {!isLoading && !error && ok && (
        <div className="px-5 py-4 text-sm text-green-600 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> לא נמצאו בעיות
        </div>
      )}

      {error && (
        <div className="px-5 py-4 text-sm text-red-600">
          שגיאה בטעינה: {error.message}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function QualityControl() {
  const queryClient = useQueryClient();

  const { data: negStock = [],        isLoading: l1, error: e1 } = useQuery({ queryKey: ["qc_neg_stock"],           queryFn: checkNegativeStock });
  const { data: blockedOrders = [],   isLoading: l2, error: e2 } = useQuery({ queryKey: ["qc_blocked_orders"],      queryFn: checkBlockedWithOpenOrders });
  const { data: overpaid = [],        isLoading: l3, error: e3 } = useQuery({ queryKey: ["qc_overpaid"],            queryFn: checkOverpaidInvoicesFallback });
  const { data: highDebt = [],        isLoading: l4, error: e4 } = useQuery({ queryKey: ["qc_high_debt"],           queryFn: checkHighDebtNotBlocked });
  const { data: fulfilledNoDeduct=[], isLoading: l5, error: e5 } = useQuery({ queryKey: ["qc_fulfilled_no_deduct"], queryFn: checkFulfilledNoDeduction });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["qc_neg_stock"] });
    queryClient.invalidateQueries({ queryKey: ["qc_blocked_orders"] });
    queryClient.invalidateQueries({ queryKey: ["qc_overpaid"] });
    queryClient.invalidateQueries({ queryKey: ["qc_high_debt"] });
    queryClient.invalidateQueries({ queryKey: ["qc_fulfilled_no_deduct"] });
  }

  const totalIssues = negStock.length + blockedOrders.length + overpaid.length + highDebt.length + fulfilledNoDeduct.length;

  return (
    <div dir="rtl">
      <div className="overflow-y-auto thin-scrollbar max-h-[calc(100vh-4rem)]">

        <div className="sticky top-0 z-10 bg-background shadow-md border-b border-gray-200 pb-3">
          <div className="flex items-center justify-between pr-4">
            <PageHeader title="מרכז בקרה" description="בדיקות תקינות מערכת" />
            <div className="flex items-center gap-3 ml-4">
              {totalIssues > 0 && (
                <Badge className="bg-amber-100 text-amber-700">{totalIssues} בעיות סה״כ</Badge>
              )}
              <Button variant="outline" size="sm" onClick={refresh} className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> רענן בדיקות
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">

          {/* CHECK 1 — Negative stock */}
          <CheckCard
            title="מוצרים עם מלאי שלילי"
            description="מוצרים שכמות המלאי שלהם ירדה מתחת לאפס"
            isLoading={l1} error={e1} issues={negStock}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">שם מוצר</TableHead>
                  <TableHead className="text-right">מק״ט</TableHead>
                  <TableHead className="text-right">ברקוד</TableHead>
                  <TableHead className="text-right">כמות נוכחית</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {negStock.map(p => (
                  <TableRow key={p.id} className="bg-red-50/50">
                    <TableCell className="font-medium text-right">{p.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{p.sku || "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{p.barcode || "—"}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{p.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 2 — Blocked customer with open orders */}
          <CheckCard
            title="לקוח חסום עם הזמנות פתוחות"
            description="הזמנות פעילות ששייכות ללקוחות המסומנים כחסומים"
            isLoading={l2} error={e2} issues={blockedOrders}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">שם לקוח</TableHead>
                  <TableHead className="text-right">מספר הזמנה</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedOrders.map(o => (
                  <TableRow key={o.id} className="bg-amber-50/50">
                    <TableCell className="font-medium text-right">{o.customer_name || "—"}</TableCell>
                    <TableCell className="text-right">#{o.order_number}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(o.date)}</TableCell>
                    <TableCell className="text-right">
                      <Badge className="bg-amber-100 text-amber-700">{o.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 3 — Overpaid invoices */}
          <CheckCard
            title="חשבונית ששולמה יותר מהסכום שלה"
            description="חשבוניות שבהן סכום התשלום גבוה מסכום החשבונית"
            isLoading={l3} error={e3} issues={overpaid}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">מספר חשבונית</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">סכום חשבונית</TableHead>
                  <TableHead className="text-right">שולם</TableHead>
                  <TableHead className="text-right">עודף</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overpaid.map(inv => (
                  <TableRow key={inv.id} className="bg-red-50/50">
                    <TableCell className="font-medium text-right">#{inv.invoice_number}</TableCell>
                    <TableCell className="text-right">{inv.customer_name || "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(inv.total)}</TableCell>
                    <TableCell className="text-right text-red-600 font-medium">{formatCurrency(inv.paid_amount)}</TableCell>
                    <TableCell className="text-right font-bold text-red-700">
                      {formatCurrency((inv.paid_amount || 0) - (inv.total || 0))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 4 — High debt, not blocked */}
          <CheckCard
            title="לקוח עם חוב מעל 5,000₪ שאינו חסום"
            description="לקוחות עם חוב מצטבר גבוה שטרם סומנו כחסומים"
            isLoading={l4} error={e4} issues={highDebt}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">שם לקוח</TableHead>
                  <TableHead className="text-right">חוב כולל</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {highDebt.map(c => (
                  <TableRow key={c.id} className="bg-amber-50/50">
                    <TableCell className="font-medium text-right">{c.name}</TableCell>
                    <TableCell className="text-right font-bold text-amber-700">{formatCurrency(c.totalDebt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 5 — Fulfilled but inventory not deducted */}
          <CheckCard
            title="הזמנה סופקה אבל מלאי לא הופחת"
            description="הזמנות שסומנו כ'סופק' אך ללא רישום ניכוי מלאי"
            isLoading={l5} error={e5} issues={fulfilledNoDeduct}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">מספר הזמנה</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fulfilledNoDeduct.map(o => (
                  <TableRow key={o.id} className="bg-amber-50/50">
                    <TableCell className="font-medium text-right">#{o.order_number}</TableCell>
                    <TableCell className="text-right">{o.customer_name || "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(o.date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

        </div>
      </div>
    </div>
  );
}
