import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";

const UNITS = ["יחידה", "ק״ג", "ליטר", "מטר", "קרטון", "אריזה"];

const emptyProduct = {
  name: "", sku: "", barcode: "", category: "", supplier: "",
  buy_price: "", sell_price: "", quantity: "", min_quantity: "",
  unit: "יחידה", image_url: "", notes: ""
};

export default function ProductDialog({ open, onOpenChange, product, onSaved, categories, suppliers }) {
  const [form, setForm] = useState(emptyProduct);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setForm({
        ...emptyProduct,
        ...product,
        buy_price: product.buy_price ?? "",
        sell_price: product.sell_price ?? "",
        quantity: product.quantity ?? "",
        min_quantity: product.min_quantity ?? "",
      });
    } else {
      setForm(emptyProduct);
    }
  }, [product, open]);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleChange("image_url", reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...form,
        buy_price: parseFloat(form.buy_price) || 0,
        sell_price: parseFloat(form.sell_price) || 0,
        quantity: parseInt(form.quantity) || 0,
        min_quantity: parseInt(form.min_quantity) || 0,
      };
      if (product?.id) {
        const updated = await base44.entities.Product.update(product.id, data);
        onOpenChange(false);
        onSaved(updated);
      } else {
        const created = await base44.entities.Product.create(data);
        onOpenChange(false);
        onSaved(created);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{product?.id ? "עריכת מוצר" : "מוצר חדש"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <Label>שם מוצר *</Label>
            <Input value={form.name} onChange={(e) => handleChange("name", e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>מק״ט</Label>
            <Input value={form.sku} onChange={(e) => handleChange("sku", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ברקוד</Label>
            <Input value={form.barcode} onChange={(e) => handleChange("barcode", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>קטגוריה</Label>
            <Input value={form.category} onChange={(e) => handleChange("category", e.target.value)} list="categories" />
            <datalist id="categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>ספק</Label>
            <Input value={form.supplier} onChange={(e) => handleChange("supplier", e.target.value)} list="suppliers" />
            <datalist id="suppliers">
              {suppliers.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>יחידת מידה</Label>
            <Select value={form.unit} onValueChange={(v) => handleChange("unit", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>מחיר קנייה לפני מע״מ</Label>
            <Input type="number" step="0.01" value={form.buy_price} onChange={(e) => handleChange("buy_price", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>מחיר מכירה לפני מע״מ *</Label>
            <Input type="number" step="0.01" value={form.sell_price} onChange={(e) => handleChange("sell_price", e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>כמות במלאי</Label>
            <Input type="number" value={form.quantity} onChange={(e) => handleChange("quantity", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>מינימום מלאי</Label>
            <Input type="number" value={form.min_quantity} onChange={(e) => handleChange("min_quantity", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>תמונה</Label>
            <div className="flex items-center gap-3">
              {form.image_url && <img src={form.image_url} alt="" className="w-16 h-16 rounded-lg object-cover" />}
              <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors">
                <Upload className="w-4 h-4" />
                <span className="text-sm">העלאת תמונה</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
              </label>
            </div>
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>הערות</Label>
            <Textarea value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} rows={2} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמירה"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}