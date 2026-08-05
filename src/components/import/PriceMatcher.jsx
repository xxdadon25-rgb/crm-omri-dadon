import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Upload, Search, X, CheckCircle2, Loader2, DollarSign, GripVertical } from "lucide-react";

function parseSupplierCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 4) return [];

  const dataLines = lines.slice(4);
  const items = [];

  for (const line of dataLines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 4) continue;
    const sku = cols[1]?.trim();
    const name = cols[2]?.trim();
    const priceStr = cols[3]?.trim();
    const price = parseFloat(priceStr);
    if (!name || isNaN(price) || price <= 0) continue;
    items.push({ sku: sku || "", name, price });
  }

  return items;
}

export default function PriceMatcher() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogFileName, setCatalogFileName] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [updating, setUpdating] = useState({});
  const [dragOverId, setDragOverId] = useState(null);
  const [bulkDragOver, setBulkDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    const { data, error } = await supabase
      .from("products")
      .select("id, name, sku, barcode, buy_price")
      .or("buy_price.is.null,buy_price.eq.0")
      .order("name");
    if (error) toast.error("שגיאה בטעינת מוצרים: " + error.message);
    setProducts(data || []);
    setLoadingProducts(false);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const items = parseSupplierCSV(reader.result);
      if (items.length === 0) {
        toast.error("לא נמצאו פריטים בקובץ");
        return;
      }
      setCatalogItems(items);
      setCatalogFileName(file.name);
      toast.success(`נטענו ${items.length} פריטים מהקטלוג`);
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setBulkDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e) => {
    handleFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const handleDragStartCatalog = (e, index) => {
    e.dataTransfer.setData("application/x-catalog-index", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const updatePrice = async (productId, price) => {
    setUpdating((prev) => ({ ...prev, [productId]: true }));
    try {
      const { error } = await supabase
        .from("products")
        .update({ buy_price: price })
        .eq("id", productId);
      if (error) throw new Error(error.message);
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      toast.success(`מחיר קנייה עודכן: ₪${price}`);
    } catch (err) {
      toast.error("שגיאה בעדכון: " + err.message);
    } finally {
      setUpdating((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    }
  };

  const handleDropOnProduct = (e, product) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const indexStr = e.dataTransfer.getData("application/x-catalog-index");
    if (indexStr === "") return;
    const index = parseInt(indexStr, 10);
    const item = filteredCatalog[index];
    if (!item) return;
    updatePrice(product.id, item.price);
  };

  const cq = catalogSearch.trim().toLowerCase();
  const filteredCatalog = cq
    ? catalogItems.filter((i) =>
        i.name.toLowerCase().includes(cq) ||
        i.sku.toLowerCase().includes(cq)
      )
    : catalogItems;

  const pq = productSearch.trim().toLowerCase();
  const filteredProducts = pq
    ? products.filter((p) =>
        (p.name || "").toLowerCase().includes(pq) ||
        (p.sku || "").toLowerCase().includes(pq) ||
        (p.barcode || "").toLowerCase().includes(pq)
      )
    : products;

  return (
    <div style={{ display: "flex", gap: 20, minHeight: 400, fontFamily: "'Heebo', sans-serif" }}>
      {/* Left: Supplier catalog */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>קטלוג ספק</h3>

        {catalogItems.length === 0 ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setBulkDragOver(true); }}
            onDragLeave={() => setBulkDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${bulkDragOver ? "#2d6a4f" : "#ccc"}`,
              borderRadius: 14, padding: 32, textAlign: "center", cursor: "pointer",
              background: bulkDragOver ? "#e8f5e9" : "#fafafa",
              transition: "all 0.2s",
            }}
          >
            <Upload style={{ width: 28, height: 28, color: bulkDragOver ? "#2d6a4f" : "#aaa", margin: "0 auto 8px" }} />
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
              גררו קובץ CSV של קטלוג ספק לכאן<br />או לחצו לבחירה
            </div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 6 }}>פורמט: מס׳ פריט, מק״ט, תיאור, מחיר (מתחיל משורה 5)</div>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleFileInput} />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#999", pointerEvents: "none" }} />
                <input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="חיפוש בקטלוג..."
                  style={{ width: "100%", padding: "8px 34px 8px 12px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, fontSize: 13, fontFamily: "'Heebo', sans-serif", outline: "none" }}
                />
                {catalogSearch && (
                  <button onClick={() => setCatalogSearch("")} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <X style={{ width: 14, height: 14, color: "#999" }} />
                  </button>
                )}
              </div>
              <span style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>{catalogItems.length} פריטים</span>
              <button
                onClick={() => { setCatalogItems([]); setCatalogFileName(""); setCatalogSearch(""); }}
                style={{ fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                נקה
              </button>
            </div>

            <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12 }}>
              {filteredCatalog.map((item, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(e) => handleDragStartCatalog(e, i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                    borderBottom: "1px solid rgba(0,0,0,0.04)", background: "#fff",
                    cursor: "grab", fontSize: 13,
                  }}
                >
                  <GripVertical style={{ width: 14, height: 14, color: "#ccc", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    {item.sku && <div style={{ fontSize: 11, color: "#999" }}>{item.sku}</div>}
                  </div>
                  <div style={{ fontWeight: 700, color: "#2d6a4f", whiteSpace: "nowrap", fontSize: 13 }}>₪{item.price.toFixed(2)}</div>
                </div>
              ))}
              {filteredCatalog.length === 0 && (
                <div style={{ textAlign: "center", padding: 20, color: "#999", fontSize: 13 }}>לא נמצאו תוצאות</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: Products without buy_price */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>מוצרים ללא מחיר קנייה</h3>
          <span style={{ fontSize: 11, color: "#888" }}>({products.length})</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#999", pointerEvents: "none" }} />
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="חיפוש לפי שם, מק״ט או ברקוד..."
              style={{ width: "100%", padding: "8px 34px 8px 12px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, fontSize: 13, fontFamily: "'Heebo', sans-serif", outline: "none" }}
            />
            {productSearch && (
              <button onClick={() => setProductSearch("")} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <X style={{ width: 14, height: 14, color: "#999" }} />
              </button>
            )}
          </div>
        </div>

        {loadingProducts ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#888", animation: "spin 1s linear infinite" }} />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999", fontSize: 14 }}>
            {products.length === 0 ? (
              <><CheckCircle2 style={{ width: 32, height: 32, color: "#22c55e", margin: "0 auto 8px" }} /><div>כל המוצרים כוללים מחיר קנייה!</div></>
            ) : "לא נמצאו תוצאות"}
          </div>
        ) : (
          <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12 }}>
            {filteredProducts.map((p) => {
              const isOver = dragOverId === p.id;
              const isUpdating = updating[p.id];
              return (
                <div
                  key={p.id}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(p.id); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(null); }}
                  onDrop={(e) => handleDropOnProduct(e, p)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                    background: isOver ? "#e8f5e9" : "#fff",
                    border: isOver ? "2px dashed #2d6a4f" : "none",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                    transition: "background 0.2s",
                  }}
                >
                  <div style={{ width: 36, height: 36, background: "#f1f5f9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <DollarSign style={{ width: 16, height: 16, color: "#94a3b8" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    {p.sku && <div style={{ fontSize: 11, color: "#999" }}>{p.sku}</div>}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {isUpdating && <Loader2 style={{ width: 16, height: 16, color: "#2d6a4f", animation: "spin 1s linear infinite" }} />}
                    {!isUpdating && isOver && <span style={{ fontSize: 11, color: "#2d6a4f", fontWeight: 600 }}>שחרר כאן</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
