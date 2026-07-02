import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Package, Users, FileText, Receipt,
  Settings, Truck, ChevronLeft, ChevronRight, X, ScrollText,
  Upload, BookOpen, ShoppingCart, BarChart2, Bell, Link2, DatabaseBackup, Store, BookUser,
  Landmark, FolderOpen, Shield
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";

const navGroups = [
  {
    label: "ראשי",
    items: [
      { path: "/", label: "דשבורד", icon: LayoutDashboard },
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
      { path: "/debt-summary", label: "יתרות חוב", icon: Landmark },
      { path: "/documents", label: "מרכז מסמכים", icon: FolderOpen },
    ],
  },
  {
    label: "ניהול",
    items: [
      { path: "/quality-control", label: "מרכז בקרה", icon: Shield },
      { path: "/reports", label: "דוחות", icon: BarChart2 },
      { path: "/alerts", label: "התראות", icon: Bell },
      { path: "/invoice-logs", label: "לוגי API", icon: ScrollText },
      { path: "/settings", label: "הגדרות", icon: Settings },
      { path: "/api-settings", label: "הגדרות API", icon: Link2 },
      { path: "/backup", label: "גיבוי ושחזור", icon: DatabaseBackup },
    ],
  },
];

// ─── NEW SIDEBAR (Heillo style) ───────────────────────────────────────────────

export default function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const location = useLocation();
  const { user } = useAuth();

  const displayName = user?.full_name || user?.email?.split("@")[0] || "משתמש";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        style={{
          background: "#F5F3F6",
          borderLeft: "1px solid rgba(0,0,0,0.04)",
          fontFamily: "'Heebo', sans-serif",
          width: collapsed ? 72 : 260,
          transition: "width 0.3s ease",
        }}
        className={cn(
          "fixed top-0 right-0 h-full flex flex-col",
          mobileOpen ? "z-50" : "z-30 lg:z-50",
          mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
      >
        {/* ── Logo + collapse button ── */}
        <div
          style={{ padding: collapsed ? "20px 0" : "20px 24px" }}
          className="flex items-center justify-between shrink-0"
        >
          {!collapsed && (
            <div style={{ fontWeight: 700, fontSize: 20, color: "#120F1C", letterSpacing: "-0.3px" }}>
              ERP<span style={{ color: "#F5885E" }}>.</span>Pro
            </div>
          )}
          <button
            onClick={() => {
              if (mobileOpen) setMobileOpen(false);
              else setCollapsed(!collapsed);
            }}
            style={{
              background: "rgba(0,0,0,0.04)",
              border: "none",
              borderRadius: 10,
              padding: 8,
              cursor: "pointer",
              color: "#B2B0B1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
              marginRight: collapsed ? "auto" : undefined,
              marginLeft: collapsed ? "auto" : undefined,
              minWidth: 36,
              minHeight: 36,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
          >
            <span className="hidden lg:block">
              {collapsed
                ? <ChevronLeft style={{ width: 16, height: 16 }} />
                : <ChevronRight style={{ width: 16, height: 16 }} />
              }
            </span>
            <X style={{ width: 16, height: 16 }} className="lg:hidden" />
          </button>
        </div>

        {/* ── Nav ── */}
        <nav
          style={{ padding: collapsed ? "0 8px" : "0 16px", flex: 1, overflowY: "auto" }}
          className="thin-scrollbar"
        >
          {navGroups.map((group) => (
            <div key={group.label} style={{ marginTop: 8 }}>
              {!collapsed && (
                <p style={{
                  fontSize: 10,
                  color: "#B2B0B1",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 500,
                  padding: "12px 10px 4px",
                  margin: 0,
                }}>
                  {group.label}
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {group.items.map((item) => {
                  const isActive =
                    location.pathname === item.path ||
                    (item.path !== "/" && location.pathname.startsWith(item.path));

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: collapsed ? 0 : 10,
                        justifyContent: collapsed ? "center" : "flex-start",
                        padding: collapsed ? "10px 0" : "10px 14px",
                        borderRadius: 14,
                        textDecoration: "none",
                        fontWeight: isActive ? 600 : 400,
                        fontSize: isActive ? 14 : 13,
                        color: isActive ? "#120F1C" : "#B2B0B1",
                        background: isActive ? "#FFFFFF" : "transparent",
                        boxShadow: isActive ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                        transition: "all 0.2s ease",
                        minHeight: 40,
                      }}
                      onMouseEnter={e => {
                        if (!isActive) e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                      }}
                      onMouseLeave={e => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <item.icon
                        style={{
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          color: isActive ? "#120F1C" : "#B2B0B1",
                          strokeWidth: 1.8,
                        }}
                      />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User section ── */}
        <div style={{
          borderTop: "1px solid rgba(0,0,0,0.05)",
          padding: collapsed ? "16px 8px" : "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#F5885E",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
          }}>
            {initials}
          </div>
          {!collapsed && (
            <div style={{ overflow: "hidden" }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: "#120F1C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {displayName}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#B2B0B1" }}>
                {user?.email || ""}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* OLD CODE START
      <aside className={cn(
        "fixed top-0 right-0 h-full bg-card border-l border-border transition-all duration-300 flex flex-col",
        collapsed ? "w-[72px]" : "w-[240px]",
        mobileOpen ? "z-50" : "z-30 lg:z-50",
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
      OLD CODE END */}
    </>
  );
}
