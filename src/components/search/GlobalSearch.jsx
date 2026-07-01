import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Search, Users, Package, Truck, ShoppingCart, FileText, Receipt, X } from "lucide-react";

const CATEGORIES = [
  {
    key: "customers",
    label: "לקוחות",
    icon: Users,
    match: (item, q) =>
      item.name?.includes(q) || item.phone?.includes(q) || item.email?.includes(q),
    title: (item) => item.name,
    subtitle: (item) => item.phone || item.email || "",
    navigate: (item) => `/customers/${item.id}`,
  },
  {
    key: "products",
    label: "מוצרים",
    icon: Package,
    match: (item, q) => item.name?.includes(q) || item.barcode?.includes(q) || item.sku?.includes(q),
    title: (item) => item.name,
    subtitle: (item) => item.barcode ? `ברקוד: ${item.barcode}` : item.sku ? `SKU: ${item.sku}` : "",
    navigate: () => "/inventory",
  },
  {
    key: "suppliers",
    label: "ספקים",
    icon: Truck,
    match: (item, q) => item.name?.includes(q) || item.contact_name?.includes(q),
    title: (item) => item.name,
    subtitle: (item) => item.contact_name || "",
    navigate: () => "/suppliers",
  },
  {
    key: "orders",
    label: "הזמנות",
    icon: ShoppingCart,
    match: (item, q) =>
      String(item.order_number || "").includes(q) || item.customer_name?.includes(q),
    title: (item) => `הזמנה #${item.order_number || "—"}`,
    subtitle: (item) => item.customer_name || "",
    navigate: () => "/orders",
  },
  {
    key: "quotes",
    label: "הצעות מחיר",
    icon: FileText,
    match: (item, q) =>
      String(item.quote_number || "").includes(q) || item.customer_name?.includes(q),
    title: (item) => `הצעה #${item.quote_number || "—"}`,
    subtitle: (item) => item.customer_name || "",
    navigate: () => "/quotes",
  },
  {
    key: "invoices",
    label: "חשבוניות",
    icon: Receipt,
    match: (item, q) =>
      String(item.invoice_number || "").includes(q) || item.customer_name?.includes(q),
    title: (item) => `חשבונית #${item.invoice_number || "—"}`,
    subtitle: (item) => item.customer_name || "",
    navigate: () => "/invoices",
  },
];

export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => base44.entities.Customer.list(), enabled: open });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list(), enabled: open });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list(), enabled: open });
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list("-created_date"), enabled: open });
  const { data: quotes = [] } = useQuery({ queryKey: ["quotes"], queryFn: () => base44.entities.Quote.list("-created_date"), enabled: open });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => base44.entities.Invoice.list(), enabled: open });

  const dataByKey = { customers, products, suppliers, orders, quotes, invoices };

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: (dataByKey[cat.key] || []).filter((item) => cat.match(item, q)).slice(0, 5),
    })).filter((cat) => cat.items.length > 0);
  }, [query, customers, products, suppliers, orders, quotes, invoices]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSelect = (cat, item) => {
    navigate(cat.navigate(item));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[10vh] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפש לקוחות, מוצרים, הזמנות..."
            className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-center text-sm text-muted-foreground py-10">הקלד לפחות 2 תווים לחיפוש</p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">אין תוצאות</p>
          ) : (
            results.map((cat) => (
              <div key={cat.key}>
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/50">
                  <cat.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                </div>
                {cat.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(cat, item)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-right"
                  >
                    <cat.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cat.title(item)}</p>
                      {cat.subtitle(item) && (
                        <p className="text-xs text-muted-foreground truncate">{cat.subtitle(item)}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
