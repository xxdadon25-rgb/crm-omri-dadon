import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/utils/formatCurrency";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";

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
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_number,date,customer_name,fulfilled,inventory_deducted")
    .eq("user_id", uid)
    .eq("fulfilled", true)
    .or("inventory_deducted.is.null,inventory_deducted.eq.false");
  if (error) throw error;
  return data ?? [];
}

async function checkStaleSupplierOrders() {
  const uid = await getUserId();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: orders, error: oErr }, { data: suppliers, error: sErr }] = await Promise.all([
    supabase.from("supplier_orders")
      .select("id,supplier_id,order_date,status,created_at")
      .eq("user_id", uid)
      .not("status", "in", '("הושלם","בוטל")')
      .lt("created_at", cutoff),
    supabase.from("suppliers").select("id,name").eq("user_id", uid),
  ]);
  if (oErr) throw oErr;
  if (sErr) throw sErr;
  const nameMap = Object.fromEntries((suppliers ?? []).map(s => [s.id, s.name]));
  return (orders ?? []).map(o => ({ ...o, supplier_name: nameMap[o.supplier_id] || "—" }));
}

async function checkConvertedQuotesWrongStatus() {
  const uid = await getUserId();
  const [{ data: quotes, error: qErr }, { data: orders, error: oErr }] = await Promise.all([
    supabase.from("quotes")
      .select("id,quote_number,customer_name,status")
      .eq("user_id", uid)
      .in("status", ["טיוטה", "ממתין לאישור"]),
    supabase.from("orders").select("quote_id").eq("user_id", uid).not("quote_id", "is", null),
  ]);
  if (qErr) throw qErr;
  if (oErr) throw oErr;
  const linkedQuoteIds = new Set((orders ?? []).map(o => o.quote_id).filter(Boolean));
  return (quotes ?? []).filter(q => linkedQuoteIds.has(q.id));
}

async function checkOrderMissingProducts() {
  const uid = await getUserId();
  const [{ data: orders, error: oErr }, { data: products, error: pErr }] = await Promise.all([
    supabase.from("orders")
      .select("id,order_number,customer_name,items")
      .eq("user_id", uid)
      .not("status", "in", '("הושלם","בוטל")'),
    supabase.from("products").select("id").eq("user_id", uid),
  ]);
  if (oErr) throw oErr;
  if (pErr) throw pErr;
  const productIds = new Set((products ?? []).map(p => p.id));
  const issues = [];
  for (const order of orders ?? []) {
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      if (item.product_id && !productIds.has(item.product_id)) {
        issues.push({
          key: `${order.id}-${item.product_id}`,
          order_number: order.order_number,
          customer_name: order.customer_name,
          missing_name: item.name || item.product_name || "—",
          missing_id: item.product_id,
        });
      }
    }
  }
  return issues;
}

async function checkDuplicateDocNumbers() {
  const uid = await getUserId();
  const [{ data: invoices }, { data: quotes }, { data: orders }] = await Promise.all([
    supabase.from("invoices").select("invoice_number").eq("user_id", uid),
    supabase.from("quotes").select("quote_number").eq("user_id", uid),
    supabase.from("orders").select("order_number").eq("user_id", uid),
  ]);
  const dupes = [];
  const findDupes = (rows, field, label) => {
    const counts = {};
    for (const r of rows ?? []) {
      const v = r[field];
      if (v != null) counts[v] = (counts[v] || 0) + 1;
    }
    for (const [num, count] of Object.entries(counts)) {
      if (count > 1) dupes.push({ key: `${label}-${num}`, type: label, number: num, count });
    }
  };
  findDupes(invoices, "invoice_number", "חשבונית");
  findDupes(quotes, "quote_number", "הצעת מחיר");
  findDupes(orders, "order_number", "הזמנה");
  return dupes;
}

async function checkBuyPriceHigherThanSell() {
  const uid = await getUserId();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,buy_price,sell_price")
    .eq("user_id", uid)
    .gt("buy_price", 0)
    .gt("sell_price", 0);
  if (error) throw error;
  return (data ?? []).filter(p => (p.buy_price || 0) >= (p.sell_price || 0));
}

// ─── Technical health checks ────────────────────────────────────────────────

async function pingDatabase() {
  const t0 = performance.now();
  const { error } = await supabase.from("products").select("count", { count: "exact", head: true });
  const ms = Math.round(performance.now() - t0);
  if (error) return { status: "error", ms };
  if (ms > 5000) return { status: "slow_critical", ms };
  if (ms > 2000) return { status: "slow", ms };
  return { status: "ok", ms };
}

async function pingStorage(bucket) {
  const { error } = await supabase.storage.from(bucket).list("", { limit: 1 });
  return { status: error ? "error" : "ok", error: error?.message };
}

async function pingProductsFetch() {
  const t0 = performance.now();
  const { error } = await supabase.from("products").select("id");
  const ms = Math.round(performance.now() - t0);
  if (error) return { status: "error", ms };
  if (ms > 3000) return { status: "very_slow", ms };
  if (ms > 1000) return { status: "slow", ms };
  return { status: "ok", ms };
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

function TechCheckCard({ title, description, loading, badge, detail }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          {!loading && detail && <p className="text-sm mt-1 font-medium">{detail}</p>}
        </div>
        <div className="shrink-0 mt-0.5">
          {loading ? (
            <Badge className="bg-gray-100 text-gray-500 flex items-center gap-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> בודק...
            </Badge>
          ) : badge}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function QualityControl() {
  const queryClient = useQueryClient();

  const initTech = { loading: true, result: null };
  const [tech11, setTech11] = useState(initTech);
  const [tech12, setTech12] = useState(initTech);
  const [tech13, setTech13] = useState(initTech);
  const [tech14, setTech14] = useState(initTech);

  const runTechChecks = useCallback(async () => {
    setTech11({ loading: true, result: null });
    setTech12({ loading: true, result: null });
    setTech13({ loading: true, result: null });
    setTech14({ loading: true, result: null });
    const [r11, r12, r13, r14] = await Promise.all([
      pingDatabase(),
      pingStorage("product-images"),
      pingStorage("delivery-documents"),
      pingProductsFetch(),
    ]);
    setTech11({ loading: false, result: r11 });
    setTech12({ loading: false, result: r12 });
    setTech13({ loading: false, result: r13 });
    setTech14({ loading: false, result: r14 });
  }, []);

  useEffect(() => { runTechChecks(); }, [runTechChecks]);

  const { data: negStock = [],          isLoading: l1, error: e1 } = useQuery({ queryKey: ["qc_neg_stock"],             queryFn: checkNegativeStock });
  const { data: blockedOrders = [],     isLoading: l2, error: e2 } = useQuery({ queryKey: ["qc_blocked_orders"],        queryFn: checkBlockedWithOpenOrders });
  const { data: overpaid = [],          isLoading: l3, error: e3 } = useQuery({ queryKey: ["qc_overpaid"],              queryFn: checkOverpaidInvoicesFallback });
  const { data: highDebt = [],          isLoading: l4, error: e4 } = useQuery({ queryKey: ["qc_high_debt"],             queryFn: checkHighDebtNotBlocked });
  const { data: fulfilledNoDeduct = [], isLoading: l5, error: e5 } = useQuery({ queryKey: ["qc_fulfilled_no_deduct"],   queryFn: checkFulfilledNoDeduction });
  const { data: staleSupplierOrders=[], isLoading: l6, error: e6 } = useQuery({ queryKey: ["qc_stale_supplier_orders"], queryFn: checkStaleSupplierOrders });
  const { data: convertedQuotes = [],   isLoading: l7, error: e7 } = useQuery({ queryKey: ["qc_converted_quotes"],      queryFn: checkConvertedQuotesWrongStatus });
  const { data: missingProducts = [],   isLoading: l8, error: e8 } = useQuery({ queryKey: ["qc_missing_products"],      queryFn: checkOrderMissingProducts });
  const { data: dupeDocs = [],          isLoading: l9, error: e9 } = useQuery({ queryKey: ["qc_dupe_docs"],             queryFn: checkDuplicateDocNumbers });
  const { data: buyGtSell = [],         isLoading: l10,error: e10} = useQuery({ queryKey: ["qc_buy_gt_sell"],           queryFn: checkBuyPriceHigherThanSell });

  function refresh() {
    ["qc_neg_stock","qc_blocked_orders","qc_overpaid","qc_high_debt","qc_fulfilled_no_deduct",
     "qc_stale_supplier_orders","qc_converted_quotes","qc_missing_products","qc_dupe_docs","qc_buy_gt_sell"
    ].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
    runTechChecks();
  }

  const totalIssues = negStock.length + blockedOrders.length + overpaid.length + highDebt.length +
    fulfilledNoDeduct.length + staleSupplierOrders.length + convertedQuotes.length +
    missingProducts.length + dupeDocs.length + buyGtSell.length;

  return (
    <div dir="rtl">

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

          {/* CHECK 6 — Stale open supplier orders (>30 days) */}
          <CheckCard
            title="הזמנה לספק לא נסגרה (מעל 30 יום)"
            description="הזמנות ספק שסטטוסן לא 'הושלם' או 'בוטל' ומועד פתיחתן לפני יותר מ-30 יום"
            isLoading={l6} error={e6} issues={staleSupplierOrders}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">ספק</TableHead>
                  <TableHead className="text-right">תאריך הזמנה</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staleSupplierOrders.map(o => (
                  <TableRow key={o.id} className="bg-amber-50/50">
                    <TableCell className="font-medium text-right">{o.supplier_name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtDate(o.order_date || o.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Badge className="bg-amber-100 text-amber-700">{o.status || "—"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 7 — Converted quotes with wrong status */}
          <CheckCard
            title="הצעת מחיר שהומרה אבל סטטוס לא עודכן"
            description="הצעות מחיר שיש להן הזמנה מקושרת אך סטטוסן עדיין 'טיוטה' או 'ממתין לאישור'"
            isLoading={l7} error={e7} issues={convertedQuotes}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">מספר הצעה</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {convertedQuotes.map(q => (
                  <TableRow key={q.id} className="bg-amber-50/50">
                    <TableCell className="font-medium text-right">#{q.quote_number}</TableCell>
                    <TableCell className="text-right">{q.customer_name || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge className="bg-gray-100 text-gray-600">{q.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 8 — Open orders with deleted products */}
          <CheckCard
            title="הזמנה עם מוצרים שלא קיימים בקטלוג"
            description="הזמנות פתוחות שמכילות פריטים שמוצר הבסיס שלהם נמחק מהקטלוג"
            isLoading={l8} error={e8} issues={missingProducts}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">מספר הזמנה</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">מוצר חסר</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missingProducts.map(row => (
                  <TableRow key={row.key} className="bg-red-50/50">
                    <TableCell className="font-medium text-right">#{row.order_number}</TableCell>
                    <TableCell className="text-right">{row.customer_name || "—"}</TableCell>
                    <TableCell className="text-right text-red-600">{row.missing_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 9 — Duplicate document numbers */}
          <CheckCard
            title="מספרי מסמכים כפולים"
            description="מספרי חשבוניות, הצעות מחיר או הזמנות שמופיעים יותר מפעם אחת במערכת"
            isLoading={l9} error={e9} issues={dupeDocs}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">סוג מסמך</TableHead>
                  <TableHead className="text-right">מספר</TableHead>
                  <TableHead className="text-right">כמות כפולים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dupeDocs.map(row => (
                  <TableRow key={row.key} className="bg-red-50/50">
                    <TableCell className="font-medium text-right">{row.type}</TableCell>
                    <TableCell className="text-right">#{row.number}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{row.count}×</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* CHECK 10 — Buy price >= sell price */}
          <CheckCard
            title="מחיר קנייה גבוה ממחיר מכירה"
            description="מוצרים שמחיר הקנייה שלהם שווה או גבוה ממחיר המכירה — פוטנציאל הפסד"
            isLoading={l10} error={e10} issues={buyGtSell}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">שם מוצר</TableHead>
                  <TableHead className="text-right">מק״ט</TableHead>
                  <TableHead className="text-right">מחיר קנייה</TableHead>
                  <TableHead className="text-right">מחיר מכירה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyGtSell.map(p => (
                  <TableRow key={p.id} className="bg-red-50/50">
                    <TableCell className="font-medium text-right">{p.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{p.sku || "—"}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(p.buy_price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.sell_price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CheckCard>

          {/* ── Technical health checks section ── */}
          <div className="pt-2">
            <h2 className="text-base font-bold text-muted-foreground px-1 pb-3 border-b border-border mb-4">בדיקות טכניות</h2>

            {/* CHECK 11 — Supabase connection */}
            <div className="space-y-4">
            <TechCheckCard
              title="חיבור לSupabase"
              description="בדיקת תקינות החיבור למסד הנתונים"
              loading={tech11.loading}
              detail={tech11.result?.ms != null ? `זמן תגובה: ${tech11.result.ms}ms` : undefined}
              badge={
                tech11.result?.status === "ok" ? (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> תקין</Badge>
                ) : tech11.result?.status === "slow" ? (
                  <Badge className="bg-amber-100 text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> איטי</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> כשל</Badge>
                )
              }
            />

            {/* CHECK 12 — product-images storage */}
            <TechCheckCard
              title="Storage — תמונות מוצרים"
              description={`גישה ל-bucket: product-images`}
              loading={tech12.loading}
              detail={tech12.result?.error || undefined}
              badge={
                tech12.result?.status === "ok" ? (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> נגיש</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> לא נגיש</Badge>
                )
              }
            />

            {/* CHECK 13 — delivery-documents storage */}
            <TechCheckCard
              title="Storage — מסמכי משלוח"
              description={`גישה ל-bucket: delivery-documents`}
              loading={tech13.loading}
              detail={tech13.result?.error || undefined}
              badge={
                tech13.result?.status === "ok" ? (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> נגיש</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> לא נגיש</Badge>
                )
              }
            />

            {/* CHECK 14 — products fetch latency */}
            <TechCheckCard
              title="זמן תגובה כללי"
              description="זמן טעינת רשימת המוצרים המלאה"
              loading={tech14.loading}
              detail={tech14.result?.ms != null ? `זמן תגובה: ${tech14.result.ms}ms` : undefined}
              badge={
                tech14.result?.status === "ok" ? (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> מהיר</Badge>
                ) : tech14.result?.status === "slow" ? (
                  <Badge className="bg-amber-100 text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> איטי</Badge>
                ) : tech14.result?.status === "very_slow" ? (
                  <Badge className="bg-red-100 text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> איטי מאוד</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> כשל</Badge>
                )
              }
            />
            </div>
          </div>

        </div>
    </div>
  );
}
