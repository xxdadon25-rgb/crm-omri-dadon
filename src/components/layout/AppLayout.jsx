import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useRealtimeSync();

  const location = useLocation();

  return (
    <div className="min-h-screen bg-background" style={{ background: "#ECEDF0" }}>
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <TopBar onMenuClick={() => setMobileOpen(true)} collapsed={collapsed} />
      {/* OLD - can restore: "min-h-screen transition-all duration-300" (no overflow-y-auto/h-screen) */}
      <main
        className={cn(
          "h-screen overflow-y-auto transition-all duration-300",
          collapsed ? "lg:pr-[72px]" : "lg:pr-[240px]"
        )}
        style={{ paddingTop: "calc(4rem + env(safe-area-inset-top))" }}
      >
        <div
          key={location.pathname}
          className="p-3 md:p-4 lg:p-6 animate-in fade-in duration-150"
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}