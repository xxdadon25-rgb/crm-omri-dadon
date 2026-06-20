import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { format } from "date-fns";

export default function ImportLogsTable() {
  const { data: logs = [] } = useQuery({
    queryKey: ["import-logs"],
    queryFn: () => base44.entities.ImportLog.list("-created_date", 20),
  });

  if (logs.length === 0) return null;

  const statusStyle = {
    "הושלם": "bg-green-100 text-green-800",
    "הושלם עם שגיאות": "bg-yellow-100 text-yellow-800",
    "נכשל": "bg-red-100 text-red-800",
    "בתהליך": "bg-blue-100 text-blue-800",
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <History className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold text-sm">היסטוריית ייבואים</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>קובץ</TableHead>
              <TableHead>תאריך</TableHead>
              <TableHead>סה״כ</TableHead>
              <TableHead>נוצרו</TableHead>
              <TableHead>עודכנו</TableHead>
              <TableHead>נכשלו</TableHead>
              <TableHead>סטטוס</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-sm font-medium max-w-[180px] truncate">{log.file_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {log.created_date ? format(new Date(log.created_date), "dd/MM/yy HH:mm") : "—"}
                </TableCell>
                <TableCell>{log.total_rows ?? "—"}</TableCell>
                <TableCell className="text-green-600 font-medium">{log.success_rows ?? 0}</TableCell>
                <TableCell className="text-blue-600 font-medium">{log.updated_rows ?? 0}</TableCell>
                <TableCell className="text-red-500 font-medium">{log.failed_rows ?? 0}</TableCell>
                <TableCell>
                  <Badge className={statusStyle[log.status] || "bg-gray-100 text-gray-700"}>
                    {log.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}