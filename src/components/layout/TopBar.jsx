import { useState, useEffect } from "react";
import { Menu, LogOut, User, Search } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import GlobalSearch from "@/components/search/GlobalSearch";

// ─── NEW TOPBAR (Heillo style) ────────────────────────────────────────────────

export default function TopBar({ onMenuClick, collapsed }) {
  const { user, logout } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  const handleLogout = () => logout();

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const initials = user?.full_name
    ? user.full_name.split(" ").map(n => n[0]).join("").slice(0, 2)
    : "U";

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-30 transition-all duration-300",
          collapsed ? "lg:right-[72px]" : "lg:right-[260px]"
        )}
        style={{
          background: "transparent",
          borderBottom: "1px solid rgba(0,0,0,0.04)",
          height: 64,
          paddingTop: "env(safe-area-inset-top)",
          fontFamily: "'Heebo', sans-serif",
        }}
      >
        <div
          dir="rtl"
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 32px",
            gap: 16,
          }}
        >
          {/* Right side (RTL): page context — visible on desktop */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Mobile menu button moved here for mobile only; desktop keeps this slot for branding */}
          </div>

          {/* Mobile hamburger — shown only on mobile */}
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-lg"
            style={{ color: "#B2B0B1", background: "transparent", border: "none", cursor: "pointer" }}
          >
            <Menu style={{ width: 22, height: 22 }} />
          </button>

          {/* Center: search bar */}
          <div className="flex-1 flex justify-center">
            {/* Desktop search */}
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2"
              style={{
                width: 320,
                height: 44,
                background: "#F8F8FA",
                borderRadius: 16,
                border: "none",
                padding: "0 16px",
                cursor: "text",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#F1F1F4"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8F8FA"}
              dir="rtl"
            >
              <Search style={{ width: 18, height: 18, color: "#B2B0B1", flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "right", fontSize: 13, color: "#B2B0B1", fontFamily: "'Heebo', sans-serif" }}>
                חפש כאן...
              </span>
              <kbd style={{
                fontSize: 11,
                color: "#B2B0B1",
                background: "rgba(0,0,0,0.04)",
                borderRadius: 6,
                padding: "2px 6px",
                border: "1px solid rgba(0,0,0,0.08)",
              }}>
                ⌘K
              </kbd>
            </button>

            {/* Mobile search icon */}
            <button
              onClick={() => setSearchOpen(true)}
              className="md:hidden p-2 rounded-xl"
              style={{ background: "#F8F8FA", border: "none", cursor: "pointer", color: "#B2B0B1" }}
            >
              <Search style={{ width: 18, height: 18 }} />
            </button>
          </div>

          {/* Left side (RTL): icons + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* Avatar + dropdown */}
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <button
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    borderRadius: 12,
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "#F5885E",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    flexShrink: 0,
                    fontFamily: "'Heebo', sans-serif",
                  }}>
                    {initials}
                  </div>
                  <span className="hidden sm:block" style={{ fontSize: 13, fontWeight: 600, color: "#120F1C", fontFamily: "'Heebo', sans-serif" }}>
                    {user?.full_name}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="gap-2 cursor-pointer">
                  <User className="w-4 h-4" /> פרופיל
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer text-destructive">
                  <LogOut className="w-4 h-4" /> התנתקות
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* OLD CODE START
      <header
        className={cn(
          "fixed top-0 left-0 right-0 bg-card/80 backdrop-blur-sm border-b border-border z-30 transition-all duration-300",
          collapsed ? "lg:right-[72px]" : "lg:right-[240px]"
        )}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-16 flex items-center justify-between px-4 lg:px-6">
          <button onClick={onMenuClick} className="p-2 rounded-lg hover:bg-muted lg:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 hidden md:flex justify-center">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 w-72 px-4 py-2 rounded-lg border border-gray-900 bg-white shadow-sm hover:border-gray-300 hover:shadow-md transition-all text-sm text-gray-400"
              dir="rtl"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-right">חפש לקוח, מוצר, הזמנה...</span>
              <kbd className="inline-flex items-center text-xs bg-gray-100 px-1.5 py-0.5 rounded border border-gray-900 text-gray-400">
                ⌘K
              </kbd>
            </button>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="md:hidden p-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-muted-foreground"
          >
            <Search className="w-4 h-4" />
          </button>
          <DropdownMenu dir="rtl">
            <DropdownMenuTrigger className="flex items-center gap-2 hover:bg-muted px-3 py-1.5 rounded-lg transition-colors">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:block">{user?.full_name}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem className="gap-2 cursor-pointer">
                <User className="w-4 h-4" /> פרופיל
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer text-destructive">
                <LogOut className="w-4 h-4" /> התנתקות
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      OLD CODE END */}
    </>
  );
}
