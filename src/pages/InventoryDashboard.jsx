import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchProductsWithPending } from "@/lib/pendingProducts";
import { AlertCircle, TrendingUp, Package, DollarSign } from "lucide-react";
import { formatDateTime } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function InventoryDashboard() {
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => fetchProductsWithPending(() => base44.entities.Product.list("-created_date")),
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements"],
    queryFn: () => base44.entities.InventoryMovement.list("-created_date", 50),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.Order.list(),
  });

  // Low stock products (below minimum, but not zero)
  const lowStockProducts = products.filter(
    p => p.quantity > 0 && p.quantity <= (p.min_quantity || 0) && p.is_active
  );

  // Out of stock products
  const outOfStockProducts = products.filter(
    p => p.quantity === 0 && p.is_active
  );

  // Most sold products (by movement count)
  const mostSoldProducts = (() => {
    const salesMap = {};
    movements.forEach(m => {
      if (m.movement_type === "יציאה" && m.quantity) {
        salesMap[m.product_id] = (salesMap[m.product_id] || 0) + m.quantity;
      }
    });
    return Object.entries(salesMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([productId, qty]) => {
        const product = products.find(p => p.id === productId);
        return { ...product, total_sold: qty };
      });
  })();

  // Inventory value
  const totalInventoryValue = products.reduce(
    (sum, p) => sum + ((p.quantity || 0) * (p.buy_price || 0)),
    0
  );

  const lowStockValue = lowStockProducts.reduce(
    (sum, p) => sum + ((p.quantity || 0) * (p.buy_price || 0)),
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="לוח בקרה מלאי"
        description="ניטור מלאי, מוצרים בסיכון וערך מלאי"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">סה״כ ערך מלאי</p>
              <p className="text-2xl font-bold">₪{totalInventoryValue.toLocaleString("he-IL")}</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">מוצרים במלאי</p>
              <p className="text-2xl font-bold">{products.length}</p>
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <Package className="w-5 h-5 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-orange-700 mb-1">מלאי נמוך</p>
              <p className="text-2xl font-bold text-orange-700">{lowStockProducts.length}</p>
            </div>
            <div className="p-2 bg-orange-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-red-700 mb-1">אזל מהמלאי</p>
              <p className="text-2xl font-bold text-red-700">{outOfStockProducts.length}</p>
            </div>
            <div className="p-2 bg-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Low Stock Products */}
      {lowStockProducts.length > 0 && (
        <div className="bg-card rounded-lg border border-orange-200 p-4">
          <h3 className="font-semibold text-orange-700 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> מוצרים בסיכון - מלאי נמוך
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם מוצר</TableHead>
                  <TableHead>מק״ט</TableHead>
                  <TableHead>כמות</TableHead>
                  <TableHead>מינימום</TableHead>
                  <TableHead>ערך מלאי</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockProducts.map(p => (
                  <TableRow key={p.id} className="bg-orange-50">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.sku}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-orange-100 text-orange-700">
                        {p.quantity}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.min_quantity || 0}</TableCell>
                    <TableCell>₪{((p.quantity || 0) * (p.buy_price || 0)).toLocaleString("he-IL")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Out of Stock Products */}
      {outOfStockProducts.length > 0 && (
        <div className="bg-card rounded-lg border border-red-200 p-4">
          <h3 className="font-semibold text-red-700 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> אזל מהמלאי
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם מוצר</TableHead>
                  <TableHead>מק״ט</TableHead>
                  <TableHead>סטטוס</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outOfStockProducts.map(p => (
                  <TableRow key={p.id} className="bg-red-50">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.sku}</TableCell>
                    <TableCell>
                      <Badge className="bg-red-100 text-red-700">אזל מהמלאי</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Most Sold Products */}
      {mostSoldProducts.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" /> המוצרים המיותרים
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם מוצר</TableHead>
                  <TableHead>מק״ט</TableHead>
                  <TableHead>כמות נמכרה</TableHead>
                  <TableHead>כמות במלאי</TableHead>
                  <TableHead>מחיר קנייה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mostSoldProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.sku}</TableCell>
                    <TableCell className="font-bold text-green-600">{p.total_sold}</TableCell>
                    <TableCell>{p.quantity || 0}</TableCell>
                    <TableCell>₪{(p.buy_price || 0).toLocaleString("he-IL")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Recent Movements */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="font-semibold mb-4">תנועות מלאי אחרונות</h3>
        {/* Mobile card view */}
        <div className="space-y-2 md:hidden">
          {movements.slice(0, 20).map(m => (
            <div key={m.id} className="border border-border rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{m.product_name}</span>
                <Badge variant={m.movement_type === "יציאה" ? "destructive" : "default"} className="shrink-0 text-xs">
                  {m.movement_type}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>כמות: <span className="font-bold text-foreground">{m.quantity}</span></span>
                <span>{m.quantity_before} ← {m.quantity_after}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{m.reference_type} #{m.reference_number}</span>
                <span>{formatDateTime(m.created_date)}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מוצר</TableHead>
                <TableHead>סוג תנועה</TableHead>
                <TableHead>כמות</TableHead>
                <TableHead>לפני / אחרי</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead>תאריך</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.slice(0, 20).map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.product_name}</TableCell>
                  <TableCell>
                    <Badge variant={m.movement_type === "יציאה" ? "destructive" : "default"}>
                      {m.movement_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-bold">{m.quantity}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.quantity_before} / {m.quantity_after}
                  </TableCell>
                  <TableCell>
                    {m.reference_type} #{m.reference_number}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(m.created_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}