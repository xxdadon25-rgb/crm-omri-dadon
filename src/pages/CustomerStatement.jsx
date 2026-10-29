/**
 * Customer account statement (כרטסת לקוח) — printable A4 preview.
 *
 * Follows the pattern the CRM already uses for printable documents
 * (QuotePDFPreview / InvoicePDFPreview): a self-contained route that fetches
 * its own data, renders a fixed 210 mm sheet, and prints with the browser.
 * "Save as PDF" is the browser's own print dialog — no library, no service, and
 * the Hebrew stays real selectable text rather than a raster image.
 *
 * READ-ONLY. It issues SELECTs and nothing else. It changes no invoice, no
 * payment, no customer balance and no status; all arithmetic lives in
 * @/lib/customerStatement and is a pure function of the rows read here.
 *
 * TENANT ISOLATION
 *   Every query is filtered by BOTH the customer id and the signed-in user's
 *   id. RLS already restricts these tables to auth.uid() = user_id, so the
 *   explicit filter is defence in depth rather than the only guard: if a
 *   policy were ever loosened, this page would still not show another
 *   account's ledger. The customer is resolved first and the statement is
 *   refused outright if that read returns nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Printer, ArrowRight } from "lucide-react";
import { buildStatement, toShekels, balanceSide, KIND, STATUS } from "@/lib/customerStatement";

/** The sheet is a fixed A4 page — 210 mm wide. A CSS millimetre is always
 *  96/25.4 px, so this is 793.7 px on every device and the printed layout
 *  matches the preview exactly. */
const SHEET_MM = 210;

/** Rows per request. PostgREST caps a response at the project's max-rows
 *  setting (1000 by default), so a plain .select() SILENTLY returns the first
 *  page and nothing says so. Every financial read here is therefore paged
 *  explicitly. */
const FETCH_PAGE = 1000;

/** A refusal threshold, not a truncation point. Past this the statement stops
 *  and says so rather than printing a balance built from part of the ledger. */
const MAX_FETCH_ROWS = 50000;

/**
 * Read EVERY row of one financial table for one customer.
 *
 * Three properties matter, and each is load-bearing:
 *
 *   COMPLETE — pages until a short page proves the end. A statement built from
 *              the first 1000 of 1500 invoices is not a partial statement, it
 *              is a wrong one, and nothing on the page would reveal it.
 *   ORDERED  — ordered by `id`, which is a unique primary key. Paging without
 *              a total order lets the database return overlapping or skipped
 *              pages between requests, which silently duplicates or loses rows.
 *   FAIL-CLOSED — any error on any page throws. There is no partial result and
 *              no empty-array substitution; the caller renders an error and no
 *              printable sheet.
 */
async function fetchAllForCustomer(table, customerId, userId) {
  const rows = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("customer_id", customerId)
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (error) throw error;
    const page = data || [];
    rows.push(...page);

    // A page shorter than the window is the only proof that the end was
    // reached; an exactly-full page always means "ask again".
    if (page.length < FETCH_PAGE) return rows;

    if (rows.length >= MAX_FETCH_ROWS) {
      throw new Error(
        `נמצאו למעלה מ-${MAX_FETCH_ROWS.toLocaleString("he-IL")} תנועות בטבלה ${table} — ` +
        `הכרטסת לא הופקה כדי לא להציג נתון חלקי. יש לצמצם את טווח התאריכים.`,
      );
    }
  }
}

const money = (agorot) =>
  toShekels(agorot).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateHe = (key) => {
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
};

const STATUS_STYLE = {
  [STATUS.PAID]: { background: "#dcfce7", color: "#166534" },
  [STATUS.PARTIAL]: { background: "#fef3c7", color: "#92400e" },
  [STATUS.UNPAID]: { background: "#fee2e2", color: "#991b1b" },
  [STATUS.CREDITED]: { background: "#e5e7eb", color: "#374151" },
};

export default function CustomerStatement() {
  const { customerId } = useParams();
  const [params] = useSearchParams();
  const from = params.get("from") || null;
  const to = params.get("to") || null;

  const [customer, setCustomer] = useState(null);
  const [biz, setBiz] = useState({});
  const [data, setData] = useState({ invoices: [], payments: [], creditNotes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) { setError("נדרשת התחברות"); return; }

        // The customer gates everything: scoped by id AND owner.
        const { data: custRows, error: cErr } = await supabase
          .from("customers").select("*")
          .eq("id", customerId).eq("user_id", user.id).limit(1);
        if (cErr) throw cErr;
        const cust = custRows?.[0];
        if (!cust) { setError("הלקוח לא נמצא"); return; }

        // Every ledger read is scoped by customer AND owner, and every one is
        // fully paged: the statement covers the customer's ENTIRE history, not
        // the first page of it. Business settings is a single row and needs no
        // paging.
        const [invoices, payments, creditNotes, settings] = await Promise.all([
          fetchAllForCustomer("invoices", customerId, user.id),
          fetchAllForCustomer("payments", customerId, user.id),
          fetchAllForCustomer("credit_notes", customerId, user.id),
          supabase.from("business_settings").select("*").eq("user_id", user.id).limit(1),
        ]);
        // ALL THREE financial reads are fatal, credit notes included —
        // fetchAllForCustomer throws on any page, so a failure anywhere in the
        // paging reaches the catch below and no sheet is rendered.
        //
        // An earlier version substituted an empty array when the credit-note
        // read failed. That is the most dangerous possible failure: credit
        // notes are the only credit besides payments, so losing them
        // OVERSTATES the debt by their full value — a credited ₪500 invoice
        // prints as ₪500 owed instead of ₪0, on business letterhead, with
        // nothing on the page to say a query failed. A statement that cannot
        // be produced is an inconvenience; a confidently wrong one that can be
        // printed and sent is a false demand for money.
        //
        // Business branding stays non-fatal: a missing logo or address cannot
        // change a number, so its error is not checked.
        if (cancelled) return;

        setCustomer(cust);
        setBiz(settings.data?.[0] || {});
        setData({ invoices, payments, creditNotes });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

  const statement = useMemo(
    () => buildStatement({ ...data, from, to }),
    [data, from, to],
  );

  // ── Fit-to-width, copied in spirit from the existing previews ────────────
  // The sheet is never reflowed: it keeps its A4 proportions and is scaled as
  // a single unit when the screen is narrower, the way a PDF viewer does
  // "fit page width". Printing always uses the unscaled sheet.
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const pagePx = (SHEET_MM * 96) / 25.4;
    const next = Math.min(1, frame.clientWidth / pagePx);
    setScale(next > 0 ? next : 1);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, loading]);

  if (loading) {
    return <div dir="rtl" style={{ padding: 40, textAlign: "center", fontFamily: "'Heebo', sans-serif" }}>טוען...</div>;
  }
  // A failed financial read renders NO sheet and NO print button, so there is
  // nothing printable to mistake for a statement — the print path is blocked
  // structurally rather than by disabling a control.
  if (error) {
    return (
      <div dir="rtl" style={{ padding: 40, textAlign: "center", fontFamily: "'Heebo', sans-serif" }}>
        <div style={{ display: "inline-block", maxWidth: 520, padding: "20px 24px", borderRadius: 12,
          background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>לא ניתן להפיק את הכרטסת</div>
          <p style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.6 }}>
            טעינת הנתונים הכספיים נכשלה. כדי למנוע הצגת יתרה שגויה, הכרטסת אינה מוצגת ואינה זמינה להדפסה.
            נסה לרענן את הדף; אם התקלה חוזרת, פנה לתמיכה.
          </p>
          <p style={{ fontSize: 11, margin: 0, color: "#7f1d1d", direction: "ltr", textAlign: "left" }}>{error}</p>
        </div>
      </div>
    );
  }

  const side = balanceSide(statement.closing);
  const periodLabel = `${from ? dateHe(from) : "מתחילת הפעילות"} — ${to ? dateHe(to) : "עד היום"}`;
  const generatedAt = new Date().toLocaleDateString("he-IL");

  return (
    <div dir="rtl" style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "'Heebo', sans-serif" }}>
      {/* Controls — hidden in print. */}
      <div className="print:hidden" style={{ display: "flex", gap: 8, justifyContent: "center", padding: 16, flexWrap: "wrap" }}>
        <Button onClick={() => window.print()}>
          <Printer style={{ width: 16, height: 16, marginInlineEnd: 6 }} /> הדפסה / שמירה כ-PDF
        </Button>
        <Button variant="outline" onClick={() => window.close()}>
          <ArrowRight style={{ width: 16, height: 16, marginInlineEnd: 6 }} /> סגור
        </Button>
      </div>

      <div ref={frameRef} style={{ padding: "0 8px 32px", display: "flex", justifyContent: "center" }}>
        {/* The scale lives on this wrapper, and print CSS resets it by id —
            otherwise a phone-sized preview would print a shrunken page. */}
        <div id="statement-scale" style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
          <div
            id="statement-sheet"
            style={{
              width: `${SHEET_MM}mm`, background: "#fff", padding: "12mm 10mm",
              boxShadow: "0 1px 6px rgba(0,0,0,0.12)", boxSizing: "border-box",
              color: "#111827", fontSize: 11,
            }}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
              borderBottom: "2px solid #111827", paddingBottom: 8 }}>
              <div style={{ maxWidth: "48%" }}>
                {biz.logo_url && (
                  <img src={biz.logo_url} alt="" style={{ maxHeight: 44, maxWidth: 130, marginBottom: 4 }} />
                )}
                <div style={{ fontSize: 15, fontWeight: 700 }}>{biz.business_name || "העסק שלי"}</div>
                {biz.tax_id && <div style={{ fontSize: 10, color: "#6b7280" }}>ע.מ / ח.פ: {biz.tax_id}</div>}
                {biz.address && <div style={{ fontSize: 10, color: "#6b7280" }}>{biz.address}</div>}
                {(biz.phone || biz.email) && (
                  <div style={{ fontSize: 10, color: "#6b7280" }}>
                    {[biz.phone, biz.email].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "left", maxWidth: "48%" }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>כרטסת לקוח</div>
                <div style={{ fontSize: 10, color: "#6b7280" }}>תאריך הפקה: {generatedAt}</div>
                <div style={{ fontSize: 10, color: "#6b7280" }}>תקופה: {periodLabel}</div>
              </div>
            </div>

            {/* ── Customer ───────────────────────────────────────────── */}
            <div style={{ marginTop: 10, padding: "8px 10px", background: "#f9fafb", borderRadius: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{customer.name}</div>
              <div style={{ fontSize: 10, color: "#6b7280", display: "flex", gap: 12, flexWrap: "wrap", marginTop: 2 }}>
                {customer.tax_id && <span>ח.פ / ע.מ: {customer.tax_id}</span>}
                {customer.contact_person && <span>איש קשר: {customer.contact_person}</span>}
                {(customer.phone || customer.mobile) && <span>טלפון: {customer.phone || customer.mobile}</span>}
                {customer.email && <span>{customer.email}</span>}
                {(customer.address || customer.city) && (
                  <span>{[customer.address, customer.city].filter(Boolean).join(", ")}</span>
                )}
                {customer.payment_terms && <span>תנאי תשלום: {customer.payment_terms}</span>}
              </div>
            </div>

            {/* ── Financial summary ──────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
              {[
                { label: "יתרת פתיחה", value: money(statement.opening) },
                { label: "סה״כ חיובים בתקופה", value: money(statement.totals.debit) },
                { label: "סה״כ תשלומים וזיכויים", value: money(statement.totals.credit) },
                { label: "יתרת סגירה", value: money(statement.closing), strong: true },
              ].map((c) => (
                <div key={c.label} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px" }}>
                  <div style={{ fontSize: 9, color: "#6b7280" }}>{c.label}</div>
                  <div style={{ fontSize: c.strong ? 14 : 12, fontWeight: 700 }}>{c.value} ₪</div>
                </div>
              ))}
            </div>

            {/* The headline figure, stated in words so a credit cannot be
                misread as a debt. */}
            <div style={{
              marginTop: 8, padding: "8px 10px", borderRadius: 6,
              background: side.side === "credit" ? "#ecfdf5" : side.side === "debit" ? "#fef2f2" : "#f9fafb",
              border: `1px solid ${side.side === "credit" ? "#a7f3d0" : side.side === "debit" ? "#fecaca" : "#e5e7eb"}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{side.label}</span>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{money(Math.abs(statement.closing))} ₪</span>
            </div>

            {/* ── Transactions ───────────────────────────────────────── */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 10 }}>
              {/* thead repeats on every printed page in browsers that support
                  it, so a multi-page statement stays readable. */}
              <thead style={{ display: "table-header-group" }}>
                <tr style={{ background: "#111827", color: "#fff" }}>
                  {["תאריך", "סוג מסמך", "אסמכתא", "תיאור", "חובה", "זכות", "יתרה", "סטטוס"].map((h, i) => (
                    <th key={h} style={{
                      padding: "5px 6px", textAlign: i >= 4 && i <= 6 ? "left" : "right",
                      whiteSpace: "nowrap", fontWeight: 600,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.rows.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
                    אין תנועות בתקופה המבוקשת
                  </td></tr>
                )}
                {statement.rows.map((r) => (
                  /* break-inside: avoid keeps a row whole across a page break. */
                  <tr key={`${r.kind}-${r.id}`} style={{ borderBottom: "1px solid #e5e7eb", breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                      {dateHe(r.date)}
                      {r.dateFallback && <span style={{ color: "#b45309" }}> *</span>}
                    </td>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                      {r.kind === KIND.INVOICE ? "חשבונית" : r.kind === KIND.PAYMENT ? "תשלום" : "זיכוי"}
                    </td>
                    {/* An invoice with no document number is marked here too,
                        not only in the internal notes, so it is never read as
                        a verified issued document. */}
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap",
                      color: r.unidentified ? "#b45309" : undefined }}>
                      {r.docNumber || (r.unidentified ? "ללא מספר" : "—")}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{r.description}</td>
                    <td style={{ padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap" }}>
                      {r.debit ? money(r.debit) : ""}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap" }}>
                      {r.credit ? money(r.credit) : ""}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600 }}>
                      {money(r.balance)}
                    </td>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                      {r.status ? (
                        <span style={{ ...STATUS_STYLE[r.status], borderRadius: 99, padding: "1px 6px", fontSize: 9 }}>
                          {r.status}
                        </span>
                      ) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
              {statement.rows.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f3f4f6", fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: "5px 6px" }}>סה״כ בתקופה</td>
                    <td style={{ padding: "5px 6px", textAlign: "left" }}>{money(statement.totals.debit)}</td>
                    <td style={{ padding: "5px 6px", textAlign: "left" }}>{money(statement.totals.credit)}</td>
                    <td style={{ padding: "5px 6px", textAlign: "left" }}>{money(statement.closing)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>

            {/* The asterisk covers both substitutions: an invoice falling back
                to its creation date, and a credit note taking the date of the
                invoice it reverses. Disclosed on the printed sheet, because a
                date the customer could check against their own records is not
                the date shown. */}
            {statement.rows.some(r => r.dateFallback) && (
              <p style={{ fontSize: 9, color: "#b45309", marginTop: 6, lineHeight: 1.6 }}>
                * תנועות המסומנות בכוכבית אינן נושאות תאריך מסמך משלהן — נעשה שימוש בתאריך הרישום,
                ולזיכויים בתאריך החשבונית שזוכתה.
              </p>
            )}
            {statement.undated.length > 0 && (
              <p style={{ fontSize: 9, color: "#b45309", marginTop: 4, lineHeight: 1.6 }}>
                {statement.undated.length} תנועות ללא תאריך שניתן לקבוע נכללו ביתרת הפתיחה,
                כדי שלא יופיעו יותר מפעם אחת בין תקופות.
              </p>
            )}

            {/* ── Internal notes — not printed ───────────────────────── */}
            {/* Reconciliation against the CRM's own balance, and any data
                warnings. Deliberately screen-only: it is diagnostic
                information for the business, not for the customer. */}
            {(statement.warnings.length > 0 || statement.reconciliation.delta !== 0) && (
              <div className="print:hidden" style={{
                marginTop: 14, padding: "8px 10px", border: "1px dashed #d1d5db",
                borderRadius: 6, background: "#fffbeb", fontSize: 10, color: "#92400e",
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>הערות פנימיות (אינן מודפסות)</div>
                {statement.reconciliation.delta !== 0 && (
                  <div>
                    יתרה לכל התקופות: {money(statement.allTime.closing)} ₪ ·
                    יתרה במערכת: {money(statement.reconciliation.crmOutstanding)} ₪ ·
                    הפרש: {money(statement.reconciliation.delta)} ₪
                    {statement.reconciliation.causes.length > 0 && (
                      <ul style={{ margin: "4px 0 0", paddingInlineStart: 16 }}>
                        {statement.reconciliation.causes.map(c => (
                          <li key={c.code}>
                            {c.code === "crm_ignores_credit_notes"
                              ? `חישוב המערכת אינו מפחית זיכויים (${money(c.amount)} ₪)`
                              : `חישוב המערכת סופר חשבוניות שזוכו כחוב (${money(c.amount)} ₪)`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {statement.warnings.map(w => <div key={w.code}>· {w.message}</div>)}
              </div>
            )}

            <div style={{ marginTop: 14, paddingTop: 6, borderTop: "1px solid #e5e7eb",
              fontSize: 9, color: "#6b7280", textAlign: "center" }}>
              הכרטסת מציגה חשבוניות שהופקו, תשלומים וזיכויים בלבד. הזמנות שלא הופקה עבורן חשבונית אינן נכללות.
            </div>
          </div>
        </div>
      </div>

      {/* Print rules, mirroring the existing PDF preview pages. */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: #fff; }
          @page { size: A4; margin: 10mm; }
          #statement-sheet { box-shadow: none !important; padding: 0 !important; width: auto !important; }
          /* The on-screen fit-to-width scale must never shrink the paper. */
          #statement-scale { transform: none !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
