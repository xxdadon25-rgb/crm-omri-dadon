import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/dateUtils";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";

/* OLD statusConfig className: "bg-green-100 text-green-700" / "bg-red-100 text-red-700" / "bg-amber-100 text-amber-700" */
const statusConfig = {
  success: { label: "הצלחה", badgeStyle: { background: "rgba(22,163,74,0.1)", color: "#15803d" }, icon: CheckCircle2 },
  error:   { label: "כשל",   badgeStyle: { background: "rgba(239,68,68,0.1)", color: "#ef4444" }, icon: XCircle },
  pending: { label: "ממתין", badgeStyle: { background: "rgba(245,136,94,0.1)", color: "#F5885E" }, icon: Clock },
};

const DARK  = "#120F1C";
const MUTED = "#B2B0B1";
const ACCENT = "#F5885E";
const thStyle = { padding: "12px 20px", textAlign: "right", whiteSpace: "nowrap" };
const tdStyle = { padding: "12px 20px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif" };

export default function InvoiceLogs() {
  const [selected, setSelected] = useState(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["invoice-logs"],
    queryFn: () => base44.entities.InvoiceLog.list("-created_date", 100),
  });

  return (
    /* OLD: <div> */
    <div className="heillo-page" dir="rtl">

      {/* OLD: <PageHeader title="לוגי חשבוניות API" description={...} /> */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>לוגי חשבוניות API</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "3px 0 0", fontFamily: "'Heebo', sans-serif" }}>{logs.length} רשומות</p>
      </div>

      {isLoading ? (
        /* OLD: <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 ...animate-spin" /></div> */
        <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
          <div style={{ width: 32, height: 32, border: `4px solid rgba(0,0,0,0.08)`, borderTopColor: ACCENT, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : logs.length === 0 ? (
        /* OLD: <EmptyState icon={CheckCircle2} title="אין לוגים" description="..." /> */
        <div className="heillo-card" style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: "50%", background: "rgba(22,163,74,0.08)" }}>
            <CheckCircle2 style={{ width: 28, height: 28, color: "#16a34a" }} />
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, color: DARK, margin: 0, fontFamily: "'Heebo', sans-serif" }}>אין לוגים</p>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>לוגים ייווצרו לאחר שליחת חשבוניות דרך API</p>
        </div>
      ) : (
        /* OLD: <div className="bg-card rounded-xl border border-border overflow-hidden"><div className="overflow-x-auto"><Table>... */
        <div className="heillo-card" style={{ overflow: "hidden", padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
              {/* OLD: <TableHeader><TableRow className="bg-muted/50"> */}
              <thead className="heillo-table-header"><tr>
                <th style={thStyle}>תאריך</th>
                <th style={thStyle}>לקוח</th>
                <th style={thStyle}>מספר חיצוני</th>
                <th style={thStyle}>סטטוס</th>
                <th style={{ ...thStyle, width: 60 }}>פרטים</th>
              </tr></thead>
              <tbody>
                {logs.map(log => {
                  const cfg = statusConfig[log.status] || statusConfig.pending;
                  return (
                    /* OLD: <TableRow key={log.id} className="hover:bg-muted/30"> */
                    <tr key={log.id} className="heillo-table-row">
                      <td style={tdStyle}>{formatDateTime(log.created_date)}</td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{log.customer_name}</td>
                      <td style={{ ...tdStyle, color: MUTED }}>{log.external_invoice_number || "—"}</td>
                      <td style={tdStyle}>
                        {/* OLD: <Badge className={cfg.className}>{cfg.label}</Badge> */}
                        <span className="heillo-badge" style={cfg.badgeStyle}>{cfg.label}</span>
                      </td>
                      <td style={tdStyle}>
                        {/* OLD: <Button variant="ghost" size="icon" className="h-8 w-8" onClick={...}> */}
                        <button
                          className="heillo-icon-btn"
                          onClick={() => setSelected(log)}
                          title="פרטים"
                        >
                          <Eye style={{ width: 14, height: 14 }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>לוג חשבונית — {selected?.customer_name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">סטטוס: </span>
                  {/* OLD: <Badge className={statusConfig[selected.status]?.className}> */}
                  <span className="heillo-badge" style={statusConfig[selected.status]?.badgeStyle}>{statusConfig[selected.status]?.label}</span>
                </div>
                <div><span className="text-muted-foreground">תאריך: </span>{formatDateTime(selected.created_date)}</div>
                {selected.external_invoice_number && <div><span className="text-muted-foreground">מספר חיצוני: </span><strong>{selected.external_invoice_number}</strong></div>}
                {selected.pdf_url && <div><a href={selected.pdf_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">הורדת PDF</a></div>}
              </div>
              {selected.error_message && (
                <div>
                  <p className="font-medium text-red-600 mb-1">הודעת שגיאה:</p>
                  <div className="bg-red-50 rounded p-2 text-red-700">{selected.error_message}</div>
                </div>
              )}
              <div>
                <p className="font-medium mb-1">בקשה שנשלחה:</p>
                <pre className="bg-muted rounded p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap">{selected.request_payload}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">תגובה מה-API:</p>
                <pre className={`rounded p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap ${selected.status === "success" ? "bg-green-50" : "bg-red-50"}`}>{selected.response_payload}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}