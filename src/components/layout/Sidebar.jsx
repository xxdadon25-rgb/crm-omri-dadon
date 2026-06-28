import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Package, Users, FileText, Receipt,
  Settings, Truck, ChevronLeft, ChevronRight, X, ScrollText,
  Upload, BookOpen, ShoppingCart, BarChart2, Bell, Link2, DatabaseBackup, Store, BookUser,
  TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "ראשי",
    items: [
      { path: "/", label: "דשבורד", icon: LayoutDashboard },
    ],
  },
  {
    label: "שירות ותיקונים",
    items: [
      { path: "/profit-tracking", label: "מעקב רווחיות", icon: TrendingUp },
    ],
  },
  {
    label: "מוצרים",
    items: [
      { path: "/inventory", label: "מלאי", icon: Package },
      { path: "/product-catalog", label: "קטלוג מוצרים", icon: BookOpen },
      { path: "/import-products", label: "ייבוא מוצרים", icon: Upload },
    ],
  },
  {
    label: "מסחר",
    items: [
      { path: "/sales-catalog", label: "מכירה + קטלוג", icon: Store },
      { path: "/customers", label: "לקוחות", icon: Users },
      { path: "/suppliers", label: "ספקים", icon: Truck },
      { path: "/quotes", label: "הצעות מחיר", icon: FileText },
      { path: "/orders", label: "הזמנות", icon: ShoppingCart },
      { path: "/invoices", label: "חשבוניות", icon: Receipt },
      { path: "/customer-ledger", label: "כרטסת לקוח", icon: BookUser },
    ],
  },
  {
    label: "ניהול",
    items: [
      { path: "/reports", label: "דוחות", icon: BarChart2 },
      { path: "/alerts", label: "התראות", icon: Bell },
      { path: "/invoice-logs", label: "לוגי API", icon: ScrollText },
      { path: "/settings", label: "הגדרות", icon: Settings },
      { path: "/api-settings", label: "הגדרות API", icon: Link2 },
      { path: "/backup", label: "גיבוי ושחזור", icon: DatabaseBackup },
    ],
  },
];

export default function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const location = useLocation();

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={cn(
        "fixed top-0 right-0 h-full bg-card border-l border-border z-50 transition-all duration-300 flex flex-col",
        collapsed ? "w-[72px]" : "w-[240px]",
        // Hidden off-screen on tablet/mobile; slides in as drawer when mobileOpen
        mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
      )}>
        <div className={cn(
          "h-16 flex items-center border-b border-border px-4",
          collapsed ? "justify-center" : "justify-between"
        )}>
          {!collapsed && (
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-primary">ERP</span> Pro
            </h1>
          )}
          <button
            onClick={() => {
              if (mobileOpen) setMobileOpen(false);
              else setCollapsed(!collapsed);
            }}
            className="p-3 rounded-md hover:bg-muted transition-colors lg:block min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <span className="hidden lg:block">
              {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
            <X className="w-4 h-4 lg:hidden" />
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 overflow-y-auto space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-3 mb-1">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path ||
                    (item.path !== "/" && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-200 min-h-[44px]",
                        collapsed && "justify-center px-2",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}