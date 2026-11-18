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
import { toast } from "sonner";
import { fetchPackagingFor, savePackaging } from "@/api/productPackaging";

const UNITS = ["יחידה", "ק״ג", "ליטר", "מטר", "קרטון", "אריזה"];

// Same bucket and extension mapping the other image paths already use
// (ImageMatcher, ImageMigration), so every product image ends up in one place
// with one naming convention.
const IMAGE_BUCKET = "product-images";

function extFromType(type) {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

const emptyProduct = {
  name: "", sku: "", barcode: "", category: "", supplier: "",
  buy_price: "", sell_price: "", quantity: "", min_quantity: "",
  // Packaging. Optional, and NOT columns of `products`: they live in the
  // product-packaging table the supplier price comparison already uses, so one
  // answer serves both features. Empty means "not known", which is a real and
  // permitted state for any product.
  units_per_pack: "", packs_per_carton: "",
  // Which packaging level products.buy_price is quoted in. Empty = not known,
  // which is permitted; the margin then reads "pending" rather than guessing.
  buy_price_level: "",
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
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (product) {
      const mpr = product.meters_per_roll ?? "";
      const bp = product.buy_price ?? "";
      // Read, so an answer given earlier — here or while comparing supplier
      // prices — is shown rather than asked for again.
      fetchPackagingFor(product.id).then(({ packaging }) => {
        if (!packaging) return;
        setForm(f => ({
          ...f,
          units_per_pack: packaging.units_per_pack ?? "",
          packs_per_carton: packaging.packs_per_carton ?? "",
          buy_price_level: packaging.buy_price_level ?? "",
        }));
      });
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

  // The picked file goes to Storage and image_url holds the resulting public
  // URL — the same shape every other image path in the app produces.
  //
  // This used to be FileReader.readAsDataURL, which put the entire image inline
  // in image_url as a data: URI. Twenty-two products were saved that way and
  // accounted for ~21 MB of the products table, downloaded in full by every
  // screen that reads the catalogue.
  //
  // The path carries a fresh uuid, so an upload can never overwrite an existing
  // object: three products already have an unrelated image at products/<id>.png,
  // and upsert:false plus a unique name makes clobbering impossible rather than
  // merely unlikely. It also means a new product needs no id, so nothing has to
  // be created before the image can be uploaded.
  const handleImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingImage(true);
    try {
      const ext = extFromType(file.type);
      const path = `products/uploads/${product?.id ?? "new"}-${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      // On failure the current image_url is deliberately left as it was, so a
      // failed upload can never blank or corrupt an existing product image.
      if (uploadErr) {
        toast.error("העלאת התמונה נכשלה");
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      handleChange("image_url", publicUrl);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Defensive backstop. Nothing above can produce a data: URI any more, but a
    // product row must never carry one again, so the save is refused outright
    // rather than silently storing megabytes.
    if (String(form.image_url || "").startsWith("data:")) {
      toast.error("התמונה לא הועלתה כראוי. נסה להעלות אותה שוב.");
      return;
    }
    if (uploadingImage) return;

    setSaving(true);
    try {
      // Packaging is stored separately, so it must not travel into the
      // products row as stray columns.
      const { units_per_pack, packs_per_carton, buy_price_level, ...productFields } = form;
      const data = {
        ...productFields,
        buy_price: parseFloat(form.buy_price) || 0,
        sell_price: parseFloat(form.sell_price) || 0,
        quantity: parseInt(form.quantity) || 0,
        min_quantity: parseInt(form.min_quantity) || 0,
        meters_per_roll: form.meters_per_roll ? parseFloat(form.meters_per_roll) : null,
      };
      // The packaging write is isolated and happens AFTER the product is
      // saved: a product must never fail to save because a packaging field was
      // refused, and a new product has no id to attach packaging to until it
      // exists. Both fields are sent only when the operator touched them, so
      // an untouched field never clears a value recorded earlier.
      const packagingPatch = {};
      if (units_per_pack !== "") packagingPatch.units_per_pack = units_per_pack;
      if (packs_per_carton !== "") packagingPatch.packs_per_carton = packs_per_carton;
      if (buy_price_level !== "") packagingPatch.buy_price_level = buy_price_level;

      // Nothing entered means nothing to save: no request is made at all, so
      // a product with no packaging costs no round trip and cannot fail on one.
      const hasPackaging = Object.keys(packagingPatch).length > 0;

      if (product?.id) {
        const updated = await base44.entities.Product.update(product.id, data);
        if (hasPackaging) {
          const pk = await savePackaging(product.id, packagingPatch);
          if (!pk.ok) toast.warning(`המוצר נשמר, אך ${pk.error}`);
        }
        onOpenChange(false);
        onSaved(updated);
      } else {
        const created = await base44.entities.Product.create(data);
        if (created?.id && hasPackaging) {
          const pk = await savePackaging(created.id, packagingPatch);
          if (!pk.ok) toast.warning(`המוצר נשמר, אך ${pk.error}`);
        }
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

          {/* ── Packaging ───────────────────────────────────────────────────
              BOTH FIELDS ARE OPTIONAL and nothing here is ever required. A
              product may have a pack size and no carton, or neither; an old or
              discontinued product can be left exactly as it is forever.

              They are not columns of `products`: they are saved to the
              product-packaging table the supplier price comparison already
              uses, so an answer given here is also the answer there, and one
              given there shows up here. That is what stops the same question
              being asked twice.

              What they are FOR: turning a purchase price per unit into the
              cost of what a line actually sold. Without them a carton sale
              costed at a unit price reads as an enormous margin. */}
          <div className="space-y-1.5">
            <Label>יחידות במארז</Label>
            <Input type="number" step="any" min="0" placeholder="לא ידוע"
              value={form.units_per_pack}
              onChange={(e) => handleChange("units_per_pack", e.target.value)} />
            <p className="text-[10px] text-muted-foreground">אופציונלי — כמה יחידות יש במארז אחד</p>
          </div>
          {/* What the purchase price above is quoted per. Not an assumption:
              a supplier invoice may price per unit, per pack or per carton,
              and multiplying a per-carton price by a carton's worth of units
              would overstate the cost many times over. Optional like
              everything else here — left empty, the margin simply reads as
              pending. */}
          <div className="space-y-1.5">
            <Label>מחיר הקנייה מתייחס ל…</Label>
            <Select value={form.buy_price_level || "unknown"}
              onValueChange={(v) => handleChange("buy_price_level", v === "unknown" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">לא ידוע</SelectItem>
                <SelectItem value="unit">ליחידה</SelectItem>
                <SelectItem value="pack">למארז</SelectItem>
                <SelectItem value="carton">לקרטון</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">אופציונלי — נדרש לחישוב רווח אמין</p>
          </div>
          <div className="space-y-1.5">
            <Label>מארזים בקרטון</Label>
            <Input type="number" step="any" min="0" placeholder="לא ידוע"
              value={form.packs_per_carton}
              onChange={(e) => handleChange("packs_per_carton", e.target.value)} />
            <p className="text-[10px] text-muted-foreground">אופציונלי — נדרש רק למכירה בקרטונים</p>
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
                <span className="text-sm">{uploadingImage ? "מעלה..." : "העלאת תמונה"}</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploadingImage} onChange={handleImage} />
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