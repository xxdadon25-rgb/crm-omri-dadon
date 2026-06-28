import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Package } from "lucide-react";

export default function ProductCatalog() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const queryClient = useQueryClient();

  // Clear stale sessionStorage ghost products on mount and sync cache with DB
  useEffect(() => {
    sessionStorage.removeItem("pendingProducts");
    sessionStorage.removeItem("pendingProductUpdates");
    sessionStorage.removeItem("pendingDeletedProducts");
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }, []);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => fetchProductsWithPending(() => base44.entities.Product.list("-created_date")),
  });

  const categories = ["all", ...new Set(products.map((p) => p.category).filter(Boolean))];

  const filtered = products.filter((p) => {
    const matchSearch =
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase());
    const matchCat = selectedCategory === "all" || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  return (
    <div>
      <PageHeader title="קטלוג מוצרים" description={`${products.length} מוצרים`} />

      <div className="flex flex-col gap-3 mb-6">
        <div className="relative w-full">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="חיפוש מוצר לפי שם או מק״ט..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-11 h-12 text-base w-full"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat === "all" ? "הכל" : cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={BookOpen} title="אין מוצרים" description="לא נמצאו מוצרים תואמים" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((product) => (
            <div key={product.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow">
              <div className="h-48 bg-muted flex items-center justify-center overflow-hidden">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onLoad={() => console.log("[img ok]", product.name, product.image_url)}
                    onError={(e) => {
                      console.warn("[img error]", product.name, product.image_url, e.type);
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <Package className="w-10 h-10 text-muted-foreground" />
                )}
              </div>
              <div className="p-3">
                <p className="font-medium text-sm leading-tight">{product.name}</p>
                {product.sku && <p className="text-xs text-muted-foreground">{product.sku}</p>}
                {product.category && (
                  <Badge variant="secondary" className="mt-1 text-xs">{product.category}</Badge>
                )}
                <p className="text-sm font-bold mt-2">₪{product.sell_price?.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}