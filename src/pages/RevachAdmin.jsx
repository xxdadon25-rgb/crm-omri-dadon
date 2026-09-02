import { useState, useEffect, useCallback, Fragment } from "react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Clock, CheckCircle2, Ban, RefreshCw, MessageSquare, Trash2, SearchX, Link2 } from "lucide-react";
import { listCustomers, approveCustomer, blockCustomer, cancelCustomer, deleteCustomer, deleteSupportMessage, bindRecurringContract } from "@/lib/revachAdmin";

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
  // Unverified checkouts and unattributed recurring charges. Kept in their own
  // state, never merged into `customers`, so the approval queue is unaffected.
  const [stuckIntents, setStuckIntents] = useState([]);
  const [unresolvedCharges, setUnresolvedCharges] = useState([]);
  const [bindingId, setBindingId] = useState(null);
  // Which charge is being bound, and the business the admin picked for it.
  const [bindTarget, setBindTarget] = useState(null);
  const [bindBusinessId, setBindBusinessId] = useState("");
  const [actingId, setActingId] = useState(null);
  const [deletingMsgId, setDeletingMsgId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listCustomers();
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setStuckIntents(Array.isArray(data.stuck_intents) ? data.stuck_intents : []);
      setUnresolvedCharges(Array.isArray(data.unresolved_charges) ? data.unresolved_charges : []);
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
    const bizName = customer.business_name || "העסק";
    const confirmMsg =
      kind === "delete"
        ? `⚠️ פעולה זו תמחק את "${bizName}" לצמיתות מהמערכת — עסק, פרופיל, מנוי, וגישה.\n\nלא ניתן לשחזר. להמשיך?`
        : kind === "cancel"
          ? `לבטל את המנוי של "${bizName}"?`
          : `${kind === "approve" ? "לאשר" : "לחסום"} את "${bizName}"?`;
    if (!window.confirm(confirmMsg)) return;
    setActingId(customer.business_id);
    try {
      let result;
      if (kind === "approve") {
        result = await approveCustomer(customer.business_id);
        toast.success("הלקוח אושר בהצלחה");
        if (result?.whatsapp_url) {
          window.open(result.whatsapp_url, "_blank");
        }
      } else if (kind === "cancel") {
        await cancelCustomer(customer.business_id);
        toast.success("המנוי בוטל בהצלחה");
      } else if (kind === "delete") {
        await deleteCustomer(customer.business_id);
        toast.success("הלקוח נמחק בהצלחה");
      } else {
        await blockCustomer(customer.business_id);
        toast.success("הלקוח נחסם בהצלחה");
      }
      await load();
    } catch (err) {
      toast.error(err.message || "אירעה שגיאה בביצוע הפעולה");
    } finally {
      setActingId(null);
    }
  };

  // Deletes one support message. Its own in-flight id, separate from actingId,
  // so deleting a message never disables the customer-row buttons and vice
  // versa. Holding the id also blocks a double-click on the same message.
  const removeMessage = async (msg) => {
    if (deletingMsgId) return;
    if (!window.confirm("למחוק את הודעת התמיכה?")) return;
    setDeletingMsgId(msg.id);
    try {
      await deleteSupportMessage(msg.id);
      // Dropped from local state rather than reloading, so the page keeps its
      // scroll position and the customer table is not refetched.
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      toast.success("ההודעה נמחקה");
    } catch (err) {
      toast.error(err.message || "שגיאה במחיקת ההודעה");
    } finally {
      setDeletingMsgId(null);
    }
  };

  // The admin has already confirmed in Grow which business this standing order
  // belongs to. Nothing here infers it: the id comes from a human, and the
  // server refuses the bind unless that business has a verified monthly intent.
  // The admin picks the business from the known customer list — never by typing
  // an id. A mistyped uuid would attach someone else's standing order to this
  // customer and extend their subscription with another person's money, and a
  // raw uuid gives the admin nothing to sanity-check against. The confirmation
  // names the business so the choice is verified in words, not in hex.
  const confirmBind = async (charge) => {
    const chosen = customers.find((c) => c.business_id === bindBusinessId);
    if (!chosen) {
      toast.error("יש לבחור עסק מהרשימה");
      return;
    }

    const label = chosen.business_name || chosen.owner_name || chosen.business_id;
    const okToBind = window.confirm(
      `לשייך את הוראת הקבע לעסק "${label}"?\n\n` +
      `מזהה Grow: ${charge.grow_identifier}\n` +
      `סכום: ${charge.amount ?? "—"}\n\n` +
      "יש לוודא בממשק Grow שהוראת הקבע אכן שייכת לעסק זה. " +
      "שיוך שגוי יאריך את המנוי של הלקוח הלא נכון."
    );
    if (!okToBind) return;

    setBindingId(charge.id);
    try {
      const res = await bindRecurringContract(charge.id, chosen.business_id);
      if (res.settled === false) {
        toast.warning(`הוראת הקבע שויכה, אך החיוב טרם הוחל: ${res.applied || "—"}`);
      } else {
        toast.success(`הוראת הקבע שויכה ל-${label}. תוצאה: ${res.applied || "—"}`);
      }
      setBindTarget(null);
      setBindBusinessId("");
      await load();
    } catch (err) {
      toast.error(err.message || "שיוך הוראת הקבע נכשל");
    } finally {
      setBindingId(null);
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
                        <TableHead className="text-right">אימייל</TableHead>
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
                          <TableCell className="whitespace-nowrap">{c.owner_name || c.contact_name || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.owner_email || c.email || "—"}</TableCell>
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
                        <TableHead className="text-right">אימייל</TableHead>
                        <TableHead className="text-right">חבילה</TableHead>
                        <TableHead className="text-right">מחזור</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right">סריקות</TableHead>
                        <TableHead className="text-right">חשבוניות</TableHead>
                        <TableHead className="text-right">הצטרפות</TableHead>
                        <TableHead className="text-right">תוקף מנוי</TableHead>
                        <TableHead className="text-right">ביטול</TableHead>
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
                          <TableCell className="whitespace-nowrap">{c.owner_name || c.contact_name || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.owner_email || c.email || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.plan_id || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.billing_cycle === "yearly"
                              ? "שנתי"
                              : c.billing_cycle === "monthly"
                                ? "חודשי"
                                : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {statusBadge(c.status)}
                              {c.status === "pending" && (c.paid_at || c.last_payment_at) && (
                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100/90 text-[10px]">
                                  ✅ שילם
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.scans_used ?? 0} / {c.scan_quota ?? 0}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{c.invoices_count ?? 0}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmtDate(c.business_created_at || c.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{fmtDate(c.subscription_end)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {c.cancel_at ? (
                              <span className="text-destructive">לחסום ב-{fmtDate(c.cancel_at)}</span>
                            ) : c.status === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAction(c, "cancel")}
                                disabled={actingId === c.business_id}
                              >
                                בטל מנוי
                              </Button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
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
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => runAction(c, "delete")}
                                disabled={actingId === c.business_id}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
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

          {/* Unverified checkouts.
              NOT customers and NOT an approval queue. A row here means a
              checkout was started and never verified — which may be an
              abandoned checkout OR a payment we failed to record. We store no
              Grow-side payment status, so the two cannot be told apart here.
              Deliberately offers no approve action. */}
          {stuckIntents.length > 0 && (
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-700">
                  <SearchX className="w-5 h-5" />
                  תשלומים שלא הושלמו — נדרשת בדיקה ב-Grow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  התשלומים הבאים <strong>לא אומתו</strong>. ייתכן שהלקוח נטש את התשלום,
                  וייתכן שהתשלום בוצע ולא התקבל אישור. אין לאשר לקוח על סמך רשומה זו —
                  יש לבדוק תחילה בממשק Grow אם הכסף נגבה בפועל.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>עסק</TableHead>
                        <TableHead>חבילה</TableHead>
                        <TableHead>סכום צפוי</TableHead>
                        <TableHead>ממתין</TableHead>
                        <TableHead>Grow Process ID</TableHead>
                        <TableHead>מזהה תשלום</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stuckIntents.map((s) => (
                        <TableRow key={s.intent_id}>
                          <TableCell className="font-medium">{s.business_name || "—"}</TableCell>
                          <TableCell>
                            {s.plan_id || "—"}
                            <span className="text-muted-foreground text-xs">
                              {" "}({s.billing_cycle === "yearly" ? "שנתי" : "חודשי"})
                            </span>
                          </TableCell>
                          <TableCell>{s.expected_amount ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-amber-400 text-amber-700">
                              {s.minutes_pending >= 60
                                ? `${Math.floor(s.minutes_pending / 60)} שעות`
                                : `${s.minutes_pending} דקות`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{s.grow_process_id || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.intent_id}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recurring charges that matched no standing order.
              Money HAS moved for these — Grow charged the card — but we cannot
              tell which business without a human checking Grow. The system
              never guesses from amount, name or phone. */}
          {unresolvedCharges.length > 0 && (
            <Card className="border-orange-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-700">
                  <Link2 className="w-5 h-5" />
                  חיובים חוזרים ללא שיוך
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                  התקבלו חיובים חוזרים מ-Grow שלא נמצאה עבורם הוראת קבע במערכת.
                  יש לזהות בממשק Grow לאיזה עסק שייך כל חיוב ולשייך אותו כאן.
                  המערכת לעולם אינה מנחשת את העסק לפי סכום או פרטי לקוח.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>מזהה Grow</TableHead>
                        <TableHead>סיבה</TableHead>
                        <TableHead>סכום</TableHead>
                        <TableHead>אסמכתה</TableHead>
                        <TableHead>תאריך</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unresolvedCharges.map((c) => (
                        <Fragment key={c.id}>
                        <TableRow>
                          <TableCell className="font-mono text-xs">{c.grow_identifier}</TableCell>
                          <TableCell className="text-xs">
                            {c.reason === "ambiguous_identifier"
                              ? "מזהה תואם יותר מהוראת קבע אחת"
                              : "לא נמצאה הוראת קבע"}
                          </TableCell>
                          <TableCell>{c.amount ?? "—"}</TableCell>
                          <TableCell className="text-xs">{c.asmachta || "—"}</TableCell>
                          <TableCell>{fmtDate(c.created_at)}</TableCell>
                          <TableCell className="text-left">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={bindingId === c.id}
                              onClick={() => {
                                setBindTarget(bindTarget === c.id ? null : c.id);
                                setBindBusinessId("");
                              }}
                            >
                              {bindTarget === c.id ? "ביטול" : "שייך לעסק"}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {bindTarget === c.id && (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/30">
                              <div className="flex flex-wrap items-center gap-2 py-1">
                                <span className="text-sm">בחר את העסק שאליו שייכת הוראת הקבע:</span>
                                <select
                                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                  value={bindBusinessId}
                                  onChange={(e) => setBindBusinessId(e.target.value)}
                                >
                                  <option value="">— בחר עסק —</option>
                                  {[...regularCustomers]
                                    .sort((a, b) =>
                                      String(a.business_name || "").localeCompare(
                                        String(b.business_name || ""), "he"
                                      )
                                    )
                                    .map((cust) => (
                                      <option key={cust.business_id} value={cust.business_id}>
                                        {cust.business_name || cust.owner_name || cust.business_id}
                                        {cust.plan_id ? ` · ${cust.plan_id}` : ""}
                                      </option>
                                    ))}
                                </select>
                                <Button
                                  size="sm"
                                  disabled={!bindBusinessId || bindingId === c.id}
                                  onClick={() => confirmBind(c)}
                                >
                                  אישור שיוך
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  יש לוודא תחילה בממשק Grow למי שייכת הוראת הקבע.
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

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
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{fmtDate(m.created_at)}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title="מחק הודעה"
                            disabled={deletingMsgId === m.id}
                            onClick={() => removeMessage(m)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
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
