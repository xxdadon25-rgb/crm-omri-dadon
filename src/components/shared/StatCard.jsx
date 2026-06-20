import { cn } from "@/lib/utils";

export default function StatCard({ title, value, icon: Icon, trend, className }) {
  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-5 flex items-start justify-between transition-shadow hover:shadow-md",
      className
    )}>
      <div>
        <p className="text-sm text-muted-foreground font-medium">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {trend && (
          <p className={cn(
            "text-xs mt-1 font-medium",
            trend > 0 ? "text-green-600" : "text-destructive"
          )}>
            {trend > 0 ? "+" : ""}{trend}%
          </p>
        )}
      </div>
      {Icon && (
        <div className="p-2.5 rounded-lg bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      )}
    </div>
  );
}