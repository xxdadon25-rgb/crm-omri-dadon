import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { ImageIcon, Upload, Search, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const BUCKET = "product-images";

function extFromType(type) {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

export default function ImageMatcher() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState({});
  const [dragOverId, setDragOverId] = useState(null);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [bulkDragOver, setBulkDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("id, name, sku, barcode")
      .or("image_url.is.null,image_url.eq.")
      .order("name");
    if (error) {
      toast.error("שגיאה בטעינת מוצרים: " + error.message);
    }
    setProducts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const uploadForProduct = async (productId, file) => {
    setUploading((prev) => ({ ...prev, [productId]: "uploading" }));
    try {
      const ext = extFromType(file.type);
      const path = `products/${productId}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const { error: updateErr } = await supabase
        .from("products")
        .update({ image_url: publicUrl })
        .eq("id", productId);
      if (updateErr) throw new Error(updateErr.message);

      setUploading((prev) => ({ ...prev, [productId]: "done" }));
      setTimeout(() => {
        setProducts((prev) => prev.filter((p) => p.id !== productId));
        setUploading((prev) => { const n = { ...prev }; delete n[productId]; return n; });
      }, 800);
      toast.success("תמונה הועלתה בהצלחה");
    } catch (err) {
      setUploading((prev) => ({ ...prev, [productId]: "error:" + err.message }));
      toast.error("שגיאה: " + err.message);
    }
  };

  const handleDragOverProduct = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(id);
  };

  const handleDragLeaveProduct = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
  };

  const handleDropOnProduct = (e, product) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      toast.error("יש לגרור קובץ תמונה");
      return;
    }
    uploadForProduct(product.id, file);
  };

  const handleBulkDrop = (e) => {
    e.preventDefault();
    setBulkDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) { toast.error("לא נמצאו קבצי תמונה"); return; }
    setDroppedFiles((prev) => [...prev, ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setDroppedFiles((prev) => [...prev, ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
    e.target.value = "";
  };

  const removeDroppedFile = (index) => {
    setDroppedFiles((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  const handleDragStartImage = (e, index) => {
    e.dataTransfer.setData("application/x-image-index", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropImageOnProduct = (e, product) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const indexStr = e.dataTransfer.getData("application/x-image-index");
    if (indexStr !== "") {
      const index = parseInt(indexStr, 10);
      const item = droppedFiles[index];
      if (item) {
        uploadForProduct(product.id, item.file);
        removeDroppedFile(index);
        return;
      }
    }
    handleDropOnProduct(e, product);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter((p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q)
      )
    : products;

  return (
    <div style={{ display: "flex", gap: 20, minHeight: 400, fontFamily: "'Heebo', sans-serif" }}>
      {/* Left: product list */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#999", pointerEvents: "none" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, מק״ט או ברקוד..."
              style={{ width: "100%", padding: "8px 34px 8px 12px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, fontSize: 13, fontFamily: "'Heebo', sans-serif", outline: "none" }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <X style={{ width: 14, height: 14, color: "#999" }} />
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>{products.length} מוצרים ללא תמונה</span>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#888", animation: "spin 1s linear infinite" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999", fontSize: 14 }}>
            {products.length === 0 ? (
              <><CheckCircle2 style={{ width: 32, height: 32, color: "#22c55e", margin: "0 auto 8px" }} /><div>כל המוצרים כוללים תמונה!</div></>
            ) : "לא נמצאו תוצאות"}
          </div>
        ) : (
          <div style={{ maxHeight: 500, overflowY: "auto", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12 }}>
            {filtered.map((p) => {
              const status = uploading[p.id];
              const isOver = dragOverId === p.id;
              return (
                <div
                  key={p.id}
                  onDragOver={(e) => handleDragOverProduct(e, p.id)}
                  onDragLeave={handleDragLeaveProduct}
                  onDrop={(e) => handleDropImageOnProduct(e, p)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                    background: isOver ? "#e8f5e9" : status === "done" ? "#f0fdf4" : "#fff",
                    transition: "background 0.2s",
                    border: isOver ? "2px dashed #2d6a4f" : "none",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ width: 36, height: 36, background: "#f1f5f9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <ImageIcon style={{ width: 16, height: 16, color: "#94a3b8" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    {p.sku && <div style={{ fontSize: 11, color: "#999" }}>{p.sku}</div>}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {status === "uploading" && <Loader2 style={{ width: 16, height: 16, color: "#2d6a4f", animation: "spin 1s linear infinite" }} />}
                    {status === "done" && <CheckCircle2 style={{ width: 16, height: 16, color: "#22c55e" }} />}
                    {status?.startsWith("error:") && (
                      <span title={status.slice(6)} style={{ cursor: "help" }}>
                        <AlertCircle style={{ width: 16, height: 16, color: "#dc2626" }} />
                      </span>
                    )}
                    {!status && isOver && <span style={{ fontSize: 11, color: "#2d6a4f", fontWeight: 600 }}>שחרר כאן</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: image drop zone */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setBulkDragOver(true); }}
          onDragLeave={() => setBulkDragOver(false)}
          onDrop={handleBulkDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${bulkDragOver ? "#2d6a4f" : "#ccc"}`,
            borderRadius: 14, padding: 24, textAlign: "center", cursor: "pointer",
            background: bulkDragOver ? "#e8f5e9" : "#fafafa",
            transition: "all 0.2s",
          }}
        >
          <Upload style={{ width: 28, height: 28, color: bulkDragOver ? "#2d6a4f" : "#aaa", margin: "0 auto 8px" }} />
          <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
            גררו תמונות לכאן<br />או לחצו לבחירה
          </div>
          <div style={{ fontSize: 11, color: "#bbb", marginTop: 6 }}>ואז גררו תמונה על מוצר ברשימה</div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFileInput} />
        </div>

        {droppedFiles.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
            {droppedFiles.map((item, i) => (
              <div
                key={i}
                draggable
                onDragStart={(e) => handleDragStartImage(e, i)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: 6,
                  background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10,
                  cursor: "grab", fontSize: 12,
                }}
              >
                <img src={item.preview} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#555" }}>{item.file.name}</span>
                <button onClick={() => removeDroppedFile(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                  <X style={{ width: 14, height: 14, color: "#999" }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
