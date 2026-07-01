import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProductCatalogModal from "@/components/products/ProductCatalogModal";

/**
 * ItemsEditor — NET-FIRST pricing model.
 *
 * unit_price is stored BEFORE VAT (net).
 * line.total = qty × unit_price × (1 - discount/100)  ← net
 *
 * For business customers: show net subtotal + VAT breakdown in DocumentTotals.
 * For private customers: show only gross total in DocumentTotals.
 * The line items themselves are always net — the distinction is only in the summary.
 */
export default function ItemsEditor({ items, setItems, products, vatRate = 18, categories = [], defaultDiscount = 0 }) {
  const [catalogOpen, setCatalogOpen] = useState(false);

  const addProductsFromCatalog = (selectedItems) => {
    setItems([...items, ...selectedItems]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    const qty = parseFloat(updated[index].quantity) || 0;
    const price = parseFloat(updated[index].unit_price) || 0;
    const disc = parseFloat(updated[index].discount) || 0;
    updated[index].total = qty * price * (1 - disc / 100);
    setItems(updated);
  };

  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">פריטים</h3>
        <Button size="sm" variant="outline" onClick={() => setCatalogOpen(true)}>
          <Plus className="w-4 h-4 ml-1" /> הוסף מוצרים
        </Button>
      </div>

      <ProductCatalogModal
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        products={products}
        onAddProducts={addProductsFromCatalog}
        categories={categories}
        defaultDiscount={defaultDiscount}
      />

      {items.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-right px-3 py-2 font-medium">מוצר</th>
                  <th className="text-right px-3 py-2 font-medium w-20">כמות</th>
                  <th className="text-right px-3 py-2 font-medium w-32">מחיר לפני מע״מ</th>
                  <th className="text-right px-3 py-2 font-medium w-20">הנחה %</th>
                  <th className="text-right px-3 py-2 font-medium w-28">סה״כ לפני מע״מ</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">
                      <Input type="number" min="1" value={item.quantity}
                        onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                        className="h-8 w-20" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" step="0.01" value={item.unit_price}
                        onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                        className="h-8 w-28" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" min="0" max="100" value={item.discount}
                        onChange={(e) => updateItem(i, "discount", parseFloat(e.target.value) || 0)}
                        className="h-8 w-20" />
                    </td>
                    {/* <td className="px-3 py-2 font-medium">₪{(item.total || 0).toFixed(2)}</td> */}
                    <td className="px-3 py-2 font-medium">{formatCurrency(item.total)}</td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(i)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout */}
          <div className="lg:hidden divide-y divide-border">
            {items.map((item, i) => (
              <div key={i} className="p-3 bg-card">
                <div className="flex items-start justify-between mb-3">
                  <span className="font-medium text-sm">{item.name}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive -mt-1" onClick={() => removeItem(i)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">כמות</label>
                    <Input type="number" inputMode="numeric" min="1" value={item.quantity}
                      onChange={(e) => updateItem(i, "quantity", parseFloat(e.target.value) || 0)} className="h-10" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">מחיר לפני מע״מ</label>
                    <Input type="number" inputMode="decimal" step="0.01" value={item.unit_price}
                      onChange={(e) => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)} className="h-10" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">הנחה %</label>
                    <Input type="number" inputMode="numeric" min="0" max="100" value={item.discount}
                      onChange={(e) => updateItem(i, "discount", parseFloat(e.target.value) || 0)} className="h-10" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">סה״כ לפני מע״מ</label>
                    {/* <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm font-semibold">₪{(item.total || 0).toFixed(2)}</div> */}
                    <div className="h-10 flex items-center px-3 bg-muted/30 rounded-md text-sm font-semibold">{formatCurrency(item.total)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-border rounded-lg py-8 text-center text-sm text-muted-foreground">
          אין פריטים. לחץ "הוסף מוצרים" להתחיל
        </div>
      )}
    </div>
  );
}