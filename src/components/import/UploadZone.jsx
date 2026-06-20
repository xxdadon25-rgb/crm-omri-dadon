import { useRef } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

export default function UploadZone({ onFile, disabled }) {
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const handleChange = (e) => {
    const file = e.target.files[0];
    if (file) { onFile(file); e.target.value = ""; }
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => !disabled && inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 cursor-pointer transition-all",
        disabled ? "opacity-50 pointer-events-none bg-muted" : "hover:border-primary hover:bg-primary/5 border-border"
      )}
    >
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <Upload className="w-8 h-8 text-primary" />
      </div>
      <p className="font-semibold text-base">גרור קובץ לכאן או לחץ לבחירה</p>
      <p className="text-sm text-muted-foreground mt-1">CSV, XLSX — מוצרי WooCommerce</p>
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span>תומך בקובץ ייצוא WooCommerce</span>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleChange} />
    </div>
  );
}