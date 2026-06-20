import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";

export default function CsvPreview({ headers, rows }) {
  const [showAll, setShowAll] = useState(false);
  const preview = showAll ? rows : rows.slice(0, 8);
  const visibleHeaders = headers.slice(0, 8);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">תצוגה מקדימה</span>
          <Badge variant="secondary">{rows.length} שורות</Badge>
          <Badge variant="secondary">{headers.length} עמודות</Badge>
        </div>
        {rows.length > 8 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-primary hover:underline">
            {showAll ? "הצג פחות" : `הצג הכל (${rows.length})`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto max-h-64">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleHeaders.map((h) => (
                <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>
              ))}
              {headers.length > 8 && <TableHead className="text-xs text-muted-foreground">+{headers.length - 8} נוספות</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((row, i) => (
              <TableRow key={i}>
                {visibleHeaders.map((h) => (
                  <TableCell key={h} className="text-xs max-w-[140px] truncate">{row[h] || "—"}</TableCell>
                ))}
                {headers.length > 8 && <TableCell />}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}