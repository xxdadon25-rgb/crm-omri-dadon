import { Search, X, Grid3X3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useRef } from "react";

export default function CatalogFilters({ search, onSearch, categories, selectedCategory, onCategoryChange }) {
  const activeCategories = categories.filter((c) => c.is_active !== false);
  const searchRef = useRef(null);

  return (
    <div className="bg-card border-b border-border shrink-0">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            placeholder="חיפוש לפי שם, מק״ט, ברקוד, תגית..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="pr-9 h-10 text-base"
          />
          {search && (
            <button
              onClick={() => { onSearch(""); searchRef.current?.focus(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category pills — scrollable, sticky */}
      {activeCategories.length > 0 && (
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 px-4 pb-3 min-w-max">
            <button
              onClick={() => onCategoryChange("all")}
              className={`whitespace-nowrap text-sm px-4 py-2 rounded-full border transition-all font-medium ${
                selectedCategory === "all"
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5 inline ml-1.5 opacity-70" />
              הכל
            </button>
            {activeCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => onCategoryChange(cat.name)}
                className={`whitespace-nowrap text-sm px-4 py-2 rounded-full border transition-all font-medium ${
                  selectedCategory === cat.name
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}