import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Image as ImageIcon, Search, X } from "lucide-react";

const UNITS = ["יחידה", "ק״ג", "ליטר", "מטר", "קרטון", "אריזה"];

const emptyProduct = {
  name: "", sku: "", barcode: "", category: "", supplier: "",
  buy_price: "", sell_price: "", quantity: "", min_quantity: "",
  unit: "יחידה", image_url: "", notes: "", meters_per_roll: ""
};

export default function ProductDialog({ open, onOpenChange, product, onSaved, categories, suppliers }) {
  const [form, setForm] = useState(emptyProduct);
  const [rollPrice, setRollPrice] = useState("");
  const [rollCount, setRollCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryImages, setGalleryImages] = useState([]);
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryLoading, setGalleryLoading] = useState(false);

  useEffect(() => {
    if (product) {
      const mpr = product.meters_per_roll ?? "";
      const bp = product.buy_price ?? "";
      setForm({
        ...emptyProduct,
        ...product,
        buy_price: bp,
        sell_price: product.sell_price ?? "",
        quantity: product.quantity ?? "",
        min_quantity: product.min_quantity ?? "",
        meters_per_roll: mpr,
      });
      if (mpr && bp) {
        setRollPrice(String(parseFloat(bp) * parseFloat(mpr)));
      } else {
        setRollPrice("");
      }
      const qty = product.quantity ?? "";
      if (mpr && qty) {
        setRollCount(String(Math.floor(parseFloat(qty) / parseFloat(mpr))));
      } else {
        setRollCount("");
      }
    } else {
      setForm(emptyProduct);
      setRollPrice("");
      setRollCount("");
    }
  }, [product, open]);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const openGallery = async () => {
    setGalleryOpen(true);
    setGallerySearch("");
    setGalleryLoading(true);
    const { data } = await supabase
      .from("products")
      .select("name, image_url")
      .not("image_url", "is", null)
      .neq("image_url", "");
    const seen = new Set();
    const unique = [];
    for (const row of data || []) {
      const url = (row.image_url || "").split(",")[0].trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      unique.push({ name: row.name || "ללא שם", image_url: url });
    }
    setGalleryImages(unique);
    setGalleryLoading(false);
  };

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
        meters_per_roll: form.meters_per_roll ? parseFloat(form.meters_per_roll) : null,
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
    <>
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
            <Label>מטרים בגליל</Label>
            <Input type="number" step="0.1" value={form.meters_per_roll} onChange={(e) => {
              const mpr = e.target.value;
              handleChange("meters_per_roll", mpr);
              if (mpr && rollPrice) {
                const perMeter = parseFloat(rollPrice) / parseFloat(mpr);
                handleChange("buy_price", isFinite(perMeter) ? String(Math.round(perMeter * 100) / 100) : "");
              } else if (!mpr) {
                setRollPrice("");
              }
              if (mpr && rollCount) {
                handleChange("quantity", String(parseFloat(rollCount) * parseFloat(mpr)));
              } else if (!mpr) {
                setRollCount("");
              }
            }} placeholder="השאר ריק אם לא רלוונטי" />
          </div>
          {form.meters_per_roll ? (
            <>
              <div className="space-y-1.5">
                <Label>מחיר קנייה לגליל</Label>
                <Input type="number" step="0.01" value={rollPrice} onChange={(e) => {
                  const rp = e.target.value;
                  setRollPrice(rp);
                  const mpr = parseFloat(form.meters_per_roll);
                  if (rp && mpr) {
                    const perMeter = parseFloat(rp) / mpr;
                    handleChange("buy_price", isFinite(perMeter) ? String(Math.round(perMeter * 100) / 100) : "");
                  } else {
                    handleChange("buy_price", "");
                  }
                }} />
              </div>
              <div className="space-y-1.5">
                <Label>מחיר קנייה למטר</Label>
                <Input type="number" step="0.01" value={form.buy_price} readOnly className="bg-muted" />
              </div>
              <div className="space-y-1.5">
                <Label>מחיר מכירה למטר *</Label>
                <Input type="number" step="0.01" value={form.sell_price} onChange={(e) => handleChange("sell_price", e.target.value)} required />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>מחיר קנייה לפני מע״מ</Label>
                <Input type="number" step="0.01" value={form.buy_price} onChange={(e) => handleChange("buy_price", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>מחיר מכירה לפני מע״מ *</Label>
                <Input type="number" step="0.01" value={form.sell_price} onChange={(e) => handleChange("sell_price", e.target.value)} required />
              </div>
            </>
          )}
          {form.meters_per_roll ? (
            <>
              <div className="space-y-1.5">
                <Label>כמות גלילים במלאי</Label>
                <Input type="number" value={rollCount} onChange={(e) => {
                  const rc = e.target.value;
                  setRollCount(rc);
                  const mpr = parseFloat(form.meters_per_roll);
                  if (rc && mpr) {
                    handleChange("quantity", String(parseFloat(rc) * mpr));
                  } else {
                    handleChange("quantity", "");
                  }
                }} />
              </div>
              <div className="space-y-1.5">
                <Label>כמות במלאי (מטרים)</Label>
                <Input type="number" value={form.quantity} readOnly className="bg-muted" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>כמות במלאי</Label>
              <Input type="number" value={form.quantity} onChange={(e) => handleChange("quantity", e.target.value)} />
            </div>
          )}
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
              <button type="button" onClick={openGallery} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm">
                <ImageIcon className="w-4 h-4" />
                בחר מתמונות קיימות
              </button>
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

    <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>בחר מתמונות קיימות</DialogTitle>
        </DialogHeader>
        <div className="relative mt-2">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder="חפש לפי שם מוצר..."
            className="pr-9"
          />
          {gallerySearch && (
            <button type="button" onClick={() => setGallerySearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {galleryLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (() => {
          const q = gallerySearch.trim().toLowerCase();
          const filtered = q ? galleryImages.filter((img) => img.name.toLowerCase().includes(q)) : galleryImages;
          return filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              {galleryImages.length === 0 ? "אין תמונות במערכת" : "לא נמצאו תוצאות"}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-2">
              {filtered.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { handleChange("image_url", img.image_url); setGalleryOpen(false); }}
                  className="group flex flex-col items-center border border-border rounded-lg p-2 hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <img src={img.image_url} alt={img.name} className="w-full aspect-square object-cover rounded-md" />
                  <span className="text-xs text-muted-foreground mt-1.5 truncate w-full text-center group-hover:text-primary">{img.name}</span>
                </button>
              ))}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  </>
  );
}