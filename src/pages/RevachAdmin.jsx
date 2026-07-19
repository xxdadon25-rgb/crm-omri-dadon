import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Clock, CheckCircle2, Ban, RefreshCw, MessageSquare } from "lucide-react";
import { listCustomers, approveCustomer, blockCustomer } from "@/lib/revachAdmin";

function fmtDate(d) {
  if (!d) return "—";
  return String(d).slice(0, 10).split("-").reverse().join("/");
}

function statusBadge(status) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-600 text-white hover:bg-green-600/90">פעיל</Badge>;
    case "blocked":
      return <Badge variant="destructive">חסום</Badge>;
    case "expired":
      return <Badge variant="outline">פג תוקף</Badge>;
    case "pending":
    default:
      return <Badge variant="secondary">ממתין</Badge>;
  }
}

export default function RevachAdmin() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listCustomers();
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (err) {
      setError(err.message || "שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (customer, kind) => {
    const label = kind === "approve" ? "לאשר" : "לחסום";
    if (!window.confirm(`${label} את "${customer.business_name || "העסק"}"?`)) return;
    setActingId(customer.business_id);
    try {
      if (kind === "approve") await approveCustomer(customer.business_id);
      else await blockCustomer(customer.business_id);
      toast.success(kind === "approve" ? "הלקוח אושר בהצלחה" : "הלקוח נחסם בהצלחה");
      await load();
    } catch (err) {
      toast.error(err.message || "אירעה שגיאה בביצוע הפעולה");
    } finally {
      setActingId(null);
    }
  };

  const admins = customers.filter((c) => c.is_admin);
  const regularCustomers = customers.filter((c) => !c.is_admin);

  const counts = {
    total: regularCustomers.length,
    pending: regularCustomers.filter((c) => c.status === "pending").length,
    active: regularCustomers.filter((c) => c.status === "active").length,
    blocked: regularCustomers.filter((c) => c.status === "blocked").length,
  };

  // Pending first (they need action), then by signup date descending.
  const sortedCustomers = [...regularCustomers].sort((a, b) => {
    const ap = a.status === "pending" ? 0 : 1;
    const bp = b.status === "pending" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (
      new Date(b.business_created_at || b.created_at || 0) -
      new Date(a.business_created_at || a.created_at || 0)
    );
  });

  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  return (
    <div>
      <PageHeader title="רווח פלוס" description="ניהול לקוחות המערכת רווח פלוס">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          רענון
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-destructive font-medium mb-4">{error}</p>
            <Button variant="outline" onClick={load}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Summary counts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="סה״כ לקוחות" value={counts.total} icon={Users} />
            <StatCard title="ממתינים לאישור" value={counts.pending} icon={Clock} />
            <StatCard title="פעילים" value={counts.active} icon={CheckCircle2} />
            <StatCard title="חסומים" value={counts.blocked} icon={Ban} />
          </div>

          {/* System admin(s) — read-only, separated from customers */}
          {admins.length > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle>מנהל מערכת</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">עסק</TableHead>
                        <TableHead className="text-right">איש קשר</TableHead>
                        <TableHead className="text-right">חבילה</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right">סריקות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins.map((c) => (
                        <TableRow key={c.business_id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {c.business_name || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{c.contact_name || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.plan_id || "—"}</TableCell>
                          <TableCell>{statusBadge(c.status)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.scans_used ?? 0} / {c.scan_quota ?? 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Customer list */}
          <Card>
            <CardHeader>
              <CardTitle>לקוחות</CardTitle>
            </CardHeader>
            <CardContent>
              {sortedCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">אין לקוחות להצגה</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">עסק</TableHead>
                        <TableHead className="text-right">איש קשר</TableHead>
                        <TableHead className="text-right">חבילה</TableHead>
                        <TableHead className="text-right">מחזור</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right">סריקות</TableHead>
                        <TableHead className="text-right">חשבוניות</TableHead>
                        <TableHead className="text-right">הצטרפות</TableHead>
                        <TableHead className="text-right">תוקף מנוי</TableHead>
                        <TableHead className="text-right">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedCustomers.map((c) => (
                        <TableRow key={c.business_id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {c.business_name || "—"}
                            {c.is_admin && (
                              <Badge variant="outline" className="mr-2 text-[10px]">
                                אדמין
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{c.contact_name || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.plan_id || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.billing_cycle === "yearly"
                              ? "שנתי"
                              : c.billing_cycle === "monthly"
                                ? "חודשי"
                                : "—"}
                          </TableCell>
                          <TableCell>{statusBadge(c.status)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.scans_used ?? 0} / {c.scan_quota ?? 0}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{c.invoices_count ?? 0}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmtDate(c.business_created_at || c.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{fmtDate(c.subscription_end)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex gap-2">
                              {(c.status === "pending" || c.status === "blocked") && (
                                <Button
                                  size="sm"
                                  onClick={() => runAction(c, "approve")}
                                  disabled={actingId === c.business_id}
                                >
                                  אישור
                                </Button>
                              )}
                              {c.status === "active" && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => runAction(c, "block")}
                                  disabled={actingId === c.business_id}
                                >
                                  חסימה
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Support messages */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                הודעות תמיכה
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sortedMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">אין הודעות</p>
              ) : (
                <div className="space-y-3">
                  {sortedMessages.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <span className="font-medium">{m.full_name || "—"}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(m.created_at)}</span>
                      </div>
                      {m.email && <p className="text-xs text-muted-foreground mb-2">{m.email}</p>}
                      <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
