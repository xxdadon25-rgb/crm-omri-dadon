import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar 
        collapsed={collapsed} 
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <TopBar onMenuClick={() => setMobileOpen(true)} collapsed={collapsed} />
      <main className={cn(
        "pt-16 min-h-screen transition-all duration-300",
        // On desktop (≥1024px) offset by sidebar width; tablets/mobile get no offset (sidebar is a drawer)
        collapsed ? "lg:pr-[72px]" : "lg:pr-[240px]"
      )}>
        <div className="p-3 md:p-4 lg:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}