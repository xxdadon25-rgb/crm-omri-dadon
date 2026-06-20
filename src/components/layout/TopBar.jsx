import { Menu, LogOut, User } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function TopBar({ onMenuClick, collapsed }) {
  const { user } = useAuth();

  const handleLogout = () => {
    base44.auth.logout();
  };

  const initials = user?.full_name
    ? user.full_name.split(" ").map(n => n[0]).join("").slice(0, 2)
    : "U";

  return (
    // On desktop (≥1024px): offset right by sidebar width. On tablet/mobile: full-width (sidebar is drawer)
    <header className={cn(
      "fixed top-0 left-0 right-0 h-16 bg-card/80 backdrop-blur-sm border-b border-border z-30 transition-all duration-300",
      collapsed ? "lg:right-[72px]" : "lg:right-[240px]"
    )}>
      <div className="h-full flex items-center justify-between px-4 lg:px-6">
        <button onClick={onMenuClick} className="p-2 rounded-lg hover:bg-muted lg:hidden">
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden lg:block" />

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
  );
}