import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { Search, X, Globe, ChevronDown, ChevronUp, MessageCircle, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";
const CARD = { background: "#FFFFFF", borderRadius: 22, boxShadow: "0 4px 20px rgba(0,0,0,0.05)" };

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 40, height: 22, borderRadius: 99, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? ACCENT : "rgba(0,0,0,0.12)",
        position: "relative", transition: "background 0.2s", flexShrink: 0, padding: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 3 : 19, width: 16, height: 16,
        borderRadius: "50%", background: "#FFFFFF",
        transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}

function Field({ label, type = "text", value, onChange, placeholder, min, step }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif" }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} min={min} step={step}
        style={{
          height: 40, background: "#F5F3F6", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12,
          padding: "0 12px", fontSize: 14, color: DARK, fontFamily: "'Heebo', sans-serif",
          outline: "none", boxSizing: "border-box", width: "100%",
        }}
      />
    </div>
  );
}

// ─── Access modal (tab 1) ─────────────────────────────────────────────────────

function AccessModal({ customer, access, products, blockedProductIds, onClose, onSaved }) {
  const isNew = !access;
  const regularDiscount = customer.discount_percent ?? 0;
  const [form, setForm] = useState({
    phone_or_email: access?.phone_or_email || "",
    // Use custom discount only if explicitly set > 0; otherwise fall back to customer's regular discount
    custom_discount_percent: (access?.custom_discount_percent > 0) ? access.custom_discount_percent : regularDiscount,
    min_order_amount: access?.min_order_amount ?? 0,
  });
  const [blocked, setBlocked] = useState(new Set(blockedProductIds));
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [showProducts, setShowProducts] = useState(false);

  const filteredProducts = useMemo(() =>
    products.filter(p => p.name?.toLowerCase().includes(productSearch.toLowerCase())),
    [products, productSearch]
  );

  const toggleBlocked = (productId) => {
    const next = new Set(blocked);
    next.has(productId) ? next.delete(productId) : next.add(productId);
    setBlocked(next);
  };

  const handleSave = async () => {
    if (!form.phone_or_email.trim()) { toast.error("יש להזין כתובת אימייל"); return; }
    setSaving(true);
    try {
      let accessId = access?.id;

      if (isNew) {
        const { data, error } = await supabase
          .from("customer_portal_access")
          .insert({
            customer_id: customer.id,
            phone_or_email: form.phone_or_email.trim(),
            custom_discount_percent: Number(form.custom_discount_percent) || 0,
            min_order_amount: Number(form.min_order_amount) || 0,
            is_active: true,
            first_login_completed: false,
          })
          .select()
          .single();
        if (error) throw error;
        accessId = data.id;
      } else {
        const { error } = await supabase
          .from("customer_portal_access")
          .update({
            phone_or_email: form.phone_or_email.trim(),
            custom_discount_percent: Number(form.custom_discount_percent) || 0,
            min_order_amount: Number(form.min_order_amount) || 0,
          })
          .eq("id", access.id);
        if (error) throw error;
      }

      const prev = new Set(blockedProductIds);
      const toAdd = [...blocked].filter(id => !prev.has(id));
      const toRemove = [...prev].filter(id => !blocked.has(id));

      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("customer_blocked_products")
          .delete()
          .eq("customer_id", customer.id)
          .in("product_id", toRemove);
        if (error) throw error;
      }
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("customer_blocked_products")
          .insert(toAdd.map(product_id => ({ customer_id: customer.id, product_id })));
        if (error) throw error;
      }

      toast.success(isNew ? "גישה לפורטל הופעלה בהצלחה" : "הגדרות עודכנו בהצלחה");
      onSaved();
    } catch (err) {
      toast.error("שגיאה: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ ...CARD, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", padding: "28px 28px 24px", fontFamily: "'Heebo', sans-serif" }} dir="rtl">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: DARK, margin: 0 }}>
              {isNew ? "הפעלת גישה לפורטל" : "עריכת גישה לפורטל"}
            </h2>
            <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{customer.name}</p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", display: "flex" }}>
            <X style={{ width: 16, height: 16, color: MUTED }} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="כתובת אימייל" type="email" value={form.phone_or_email}
            onChange={v => setForm(f => ({ ...f, phone_or_email: v }))} placeholder="email@example.com" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Field label="הנחה (%)" type="number" value={form.custom_discount_percent}
                onChange={v => setForm(f => ({ ...f, custom_discount_percent: v }))} min="0" step="0.1" placeholder="0" />
              <p style={{ margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.4 }}>
                הנחה קבועה של הלקוח: <strong>{regularDiscount}%</strong>
                {regularDiscount > 0 && !(access?.custom_discount_percent > 0) && " (הוזנה כברירת מחדל)"}
              </p>
            </div>
            <Field label="הזמנה מינימלית (₪)" type="number" value={form.min_order_amount}
              onChange={v => setForm(f => ({ ...f, min_order_amount: v }))} min="0" step="1" placeholder="0" />
          </div>
        </div>

        <div style={{ marginTop: 20, borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: 16 }}>
          <button
            onClick={() => setShowProducts(p => !p)}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "'Heebo', sans-serif" }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: DARK }}>מוצרים חסומים</span>
            {blocked.size > 0 && (
              <span style={{ background: "rgba(245,136,94,0.15)", color: ACCENT, borderRadius: 99, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
                {blocked.size}
              </span>
            )}
            {showProducts ? <ChevronUp style={{ width: 15, height: 15, color: MUTED }} /> : <ChevronDown style={{ width: 15, height: 15, color: MUTED }} />}
          </button>

          {showProducts && (
            <div style={{ marginTop: 12 }}>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: MUTED, pointerEvents: "none" }} />
                <input
                  type="text" placeholder="חיפוש מוצר..." value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  style={{ width: "100%", height: 36, background: "#F5F3F6", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "0 34px 0 10px", fontSize: 13, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {filteredProducts.map(p => (
                  <label key={p.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 10, cursor: "pointer", background: blocked.has(p.id) ? "rgba(245,136,94,0.06)" : "transparent" }}
                    onMouseEnter={e => { if (!blocked.has(p.id)) e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = blocked.has(p.id) ? "rgba(245,136,94,0.06)" : "transparent"; }}
                  >
                    <input type="checkbox" checked={blocked.has(p.id)} onChange={() => toggleBlocked(p.id)}
                      style={{ accentColor: ACCENT, width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: DARK, flex: 1 }}>{p.name}</span>
                    {p.sell_price != null && (
                      <span style={{ fontSize: 12, color: MUTED }}>₪{Number(p.sell_price).toLocaleString("he-IL")}</span>
                    )}
                  </label>
                ))}
                {filteredProducts.length === 0 && (
                  <p style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "16px 0" }}>לא נמצאו מוצרים</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-start" }}>
          <button
            onClick={handleSave} disabled={saving}
            style={{ height: 40, background: saving ? "#ccc" : ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, padding: "0 22px", fontSize: 14, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
          >
            {saving && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
            {isNew ? "הפעל גישה" : "שמור שינויים"}
          </button>
          <button onClick={onClose} style={{ height: 40, background: "transparent", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: "0 18px", fontSize: 14, fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pending order card (tab 2) ───────────────────────────────────────────────

const fmt = n => (n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

// Mirrors the deductInventory logic from Orders.jsx — fetch product quantity, subtract, update
async function deductInventory(items, qc) {
  for (const item of items) {
    const productId = item.product_id || item.id;
    if (!productId) continue;
    const { data: product } = await supabase.from("products").select("id,quantity").eq("id", productId).single();
    if (!product) continue;
    const newQty = Math.max(0, (product.quantity || 0) - (item.quantity || 0));
    await supabase.from("products").update({ quantity: newQty }).eq("id", productId);
  }
  qc.removeQueries({ queryKey: ["products"] });
  qc.invalidateQueries({ queryKey: ["products"] });
}

function OrderCard({ order, customerName, productMap, settingsData, onApproved, onRejected }) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const qc = useQueryClient();

  const handleApprove = async () => {
    setApproving(true);
    try {
      // Build internal order items in the format used by the orders system
      const internalItems = (order.items || []).map(item => ({
        product_id: item.product_id,
        name: productMap[item.product_id] || "מוצר",
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
        discount_percent: 0,
      }));

      const subtotal = internalItems.reduce((s, i) => s + i.total, 0);
      const vatRate = settingsData?.vat_rate || 17;
      const vatAmount = subtotal * (vatRate / 100);
      const total = subtotal + vatAmount;

      // Fetch current order counter
      const settings = settingsData;
      const counter = (settings?.order_counter || 1000) + 1;

      const orderData = {
        order_number: counter,
        customer_id: order.customer_id,
        customer_name: customerName,
        customer_tax_id: "",
        date: new Date().toISOString().split("T")[0],
        items: internalItems,
        subtotal,
        gross_total: subtotal,
        discount_amount: 0,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        notes: order.notes || "",
        status: "אושר",
        fulfilled: false,
        inventory_deducted: false,
        agent: "פורטל לקוחות",
      };

      // Create the internal order (reusing the same entity method used across the app)
      const created = await base44.entities.Order.create(orderData);

      // Increment counter in business settings
      if (settings?.id) {
        await base44.entities.BusinessSettings.update(settings.id, { order_counter: counter });
        qc.invalidateQueries({ queryKey: ["settings"] });
      }

      // Mark portal order as approved with linked internal order id
      const { error } = await supabase
        .from("portal_orders")
        .update({ status: "approved", approved_at: new Date().toISOString(), linked_order_id: created.id })
        .eq("id", order.id);
      if (error) throw error;

      toast.success(`הזמנה #${counter} אושרה ונוצרה בהצלחה`);

      // WhatsApp notification — fetch customer phone and open wa.me link silently
      try {
        const { data: cust } = await supabase
          .from("customers")
          .select("mobile, phone, name")
          .eq("id", order.customer_id)
          .maybeSingle();
        const phone = formatIsraeliPhone((cust?.mobile || cust?.phone) ?? "");
        if (phone) {
          const name = cust?.name || customerName;
          const msg =
            `היי ${name}, ההזמנה שלך (מספר ${counter}, סה״כ ₪${fmt(order.total_amount)}) אושרה ונמצאת בטיפול! ` +
            `תודה שהזמנת מאיתנו.`;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
        }
      } catch {
        // Missing phone or network error — skip silently, approval already succeeded
      }

      onApproved(order.id);
    } catch (err) {
      toast.error("שגיאה באישור ההזמנה: " + err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm(`לדחות את ההזמנה של ${customerName}?`)) return;
    setRejecting(true);
    try {
      const { error } = await supabase
        .from("portal_orders")
        .update({ status: "rejected" })
        .eq("id", order.id);
      if (error) throw error;
      toast.success("ההזמנה נדחתה");
      onRejected(order.id);
    } catch (err) {
      toast.error("שגיאה בדחיית ההזמנה: " + err.message);
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
      {/* Card header */}
      <div style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: DARK }}>{customerName}</p>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: MUTED }}>{fmtDate(order.created_at)}</p>
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: ACCENT }}>₪{fmt(order.total_amount)}</p>
          <p style={{ margin: 0, fontSize: 11, color: MUTED }}>{order.items?.length || 0} פריטים</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={handleApprove} disabled={approving || rejecting}
            style={{ height: 36, background: approving ? "#ccc" : ACCENT, color: "#FFFFFF", border: "none", borderRadius: 10, padding: "0 16px", fontSize: 13, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: approving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          >
            {approving && <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
            אשר הזמנה
          </button>
          <button
            onClick={handleReject} disabled={approving || rejecting}
            style={{ height: 36, background: "transparent", color: "#dc2626", border: "1.5px solid rgba(220,38,38,0.35)", borderRadius: 10, padding: "0 14px", fontSize: 13, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: rejecting ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: rejecting ? 0.6 : 1 }}
          >
            דחה הזמנה
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ height: 36, width: 36, background: "rgba(0,0,0,0.04)", border: "none", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            {expanded
              ? <ChevronUp style={{ width: 16, height: 16, color: MUTED }} />
              : <ChevronDown style={{ width: 16, height: 16, color: MUTED }} />}
          </button>
        </div>
      </div>

      {/* Notes row */}
      {order.notes && (
        <div style={{ borderTop: "1px solid rgba(0,0,0,0.05)", padding: "10px 20px", fontSize: 13, color: MUTED }}>
          הערות: {order.notes}
        </div>
      )}

      {/* Expanded line items */}
      {expanded && (
        <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
            <thead>
              <tr style={{ background: "#FAFAFA" }}>
                {["מוצר", "כמות", "מחיר יחידה", "סה״כ"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 20px", textAlign: "right", fontSize: 11, fontWeight: 600, color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map((item, i) => (
                <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                  <td style={{ padding: "10px 20px", fontSize: 13, color: DARK }}>{productMap[item.product_id] || item.product_id}</td>
                  <td style={{ padding: "10px 20px", fontSize: 13, color: DARK }}>{item.quantity}</td>
                  <td style={{ padding: "10px 20px", fontSize: 13, color: DARK }}>₪{fmt(item.unit_price)}</td>
                  <td style={{ padding: "10px 20px", fontSize: 13, fontWeight: 700, color: DARK }}>₪{fmt(item.quantity * item.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Pending Orders ────────────────────────────────────────────────────

function PendingOrdersTab() {
  const qc = useQueryClient();
  // Local list for optimistic removal after approve/reject
  const [removedIds, setRemovedIds] = useState(new Set());

  const { data: rawOrders = [], isLoading } = useQuery({
    queryKey: ["portal-orders-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_orders")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-portal-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name, discount_percent").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: orderItems = [] } = useQuery({
    queryKey: ["portal-order-items-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("portal_order_items").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-portal-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, sell_price").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: settingsList = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
    staleTime: 60_000,
  });
  const settingsData = settingsList[0];

  const customerMap = useMemo(() => {
    const m = {};
    customers.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [customers]);

  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p.name; });
    return m;
  }, [products]);

  // Attach items to each order
  const orders = useMemo(() => {
    const itemsByOrder = {};
    orderItems.forEach(item => {
      if (!itemsByOrder[item.portal_order_id]) itemsByOrder[item.portal_order_id] = [];
      itemsByOrder[item.portal_order_id].push(item);
    });
    return rawOrders
      .filter(o => !removedIds.has(o.id))
      .map(o => ({ ...o, items: itemsByOrder[o.id] || [] }));
  }, [rawOrders, orderItems, removedIds]);

  const handleRemove = (id) => {
    setRemovedIds(prev => new Set([...prev, id]));
    qc.invalidateQueries({ queryKey: ["portal-orders-pending"] });
    qc.invalidateQueries({ queryKey: ["portal-orders-pending-count"] });
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}>
        <div style={{ width: 32, height: 32, border: "3px solid rgba(245,136,94,0.2)", borderTopColor: ACCENT, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div style={{ ...CARD, padding: "64px 0", textAlign: "center" }}>
        <Globe style={{ width: 40, height: 40, color: MUTED, margin: "0 auto 12px" }} />
        <p style={{ fontSize: 15, color: MUTED, margin: 0, fontFamily: "'Heebo', sans-serif" }}>אין הזמנות ממתינות</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {orders.map(order => (
        <OrderCard
          key={order.id}
          order={order}
          customerName={customerMap[order.customer_id] || "לקוח לא ידוע"}
          productMap={productMap}
          settingsData={settingsData}
          onApproved={handleRemove}
          onRejected={handleRemove}
        />
      ))}
    </div>
  );
}

// ─── WhatsApp helper ──────────────────────────────────────────────────────────

function formatIsraeliPhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  // Strip leading 0 and prepend country code
  return digits.startsWith("0") ? "972" + digits.slice(1) : digits;
}

function sendWhatsApp(customer, access) {
  const rawPhone = customer.mobile || customer.phone || "";
  const phone = formatIsraeliPhone(rawPhone);
  if (!phone) {
    toast.error("לא קיים מספר טלפון ללקוח זה");
    return;
  }
  const portalUrl = `${window.location.origin}/portal/login`;
  const email = access.phone_or_email || "";
  const msg =
    `היי ${customer.name}, הצטרפת לפורטל הלקוחות שלנו! ` +
    `היכנס לכתובת ${portalUrl} עם האימייל ${email} כדי להתחיל להזמין. ` +
    `אם זו הכניסה הראשונה שלך, תוכל לבחור סיסמה בעמוד ההרשמה.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ─── Reset password modal ─────────────────────────────────────────────────────

function ResetPasswordModal({ customer, authUserId, onClose }) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (password.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-portal-password", {
        body: { auth_user_id: authUserId, new_password: password },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || "שגיאה לא ידועה");
      toast.success("הסיסמה עודכנה בהצלחה");
      onClose();
    } catch (err) {
      toast.error("שגיאה בעדכון הסיסמה: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ ...CARD, width: "100%", maxWidth: 380, padding: "28px 28px 24px", fontFamily: "'Heebo', sans-serif" }} dir="rtl">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: DARK, margin: 0 }}>איפוס סיסמה</h2>
            <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 0" }}>{customer.name}</p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", display: "flex" }}>
            <X style={{ width: 16, height: 16, color: MUTED }} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: DARK }}>סיסמה חדשה</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="לפחות 6 תווים"
                autoFocus
                style={{
                  width: "100%", height: 44, background: "#F5F3F6",
                  border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12,
                  padding: "0 42px 0 12px", fontSize: 14, color: DARK,
                  fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
              >
                {showPw
                  ? <EyeOff style={{ width: 16, height: 16, color: MUTED }} />
                  : <Eye style={{ width: 16, height: 16, color: MUTED }} />}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: MUTED }}>לפחות 6 תווים</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-start" }}>
          <button
            onClick={handleSave} disabled={saving}
            style={{ height: 40, background: saving ? "#ccc" : ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12, padding: "0 22px", fontSize: 14, fontWeight: 700, fontFamily: "'Heebo', sans-serif", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
          >
            {saving && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
            שמור סיסמה חדשה
          </button>
          <button onClick={onClose} style={{ height: 40, background: "transparent", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: "0 18px", fontSize: 14, fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif", cursor: "pointer" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortalCustomerAccess() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("access"); // "access" | "orders"
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null); // { customer, authUserId }

  // Tab 1 data
  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["customers-portal-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name, discount_percent, mobile, phone").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: accessRows = [] } = useQuery({
    queryKey: ["customer-portal-access-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_portal_access").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-portal-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, sell_price").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: blockedRows = [] } = useQuery({
    queryKey: ["customer-blocked-products-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_blocked_products").select("customer_id, product_id");
      if (error) throw error;
      return data;
    },
  });

  // Pending orders count for tab badge — separate key from the full-data query used by PendingOrdersTab
  const { data: pendingOrders = [] } = useQuery({
    queryKey: ["portal-orders-pending-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_orders")
        .select("id")
        .eq("status", "pending");
      if (error) return [];
      return data;
    },
  });
  const pendingCount = pendingOrders.length;

  const accessByCustomer = useMemo(() => {
    const m = {};
    accessRows.forEach(row => { m[row.customer_id] = row; });
    return m;
  }, [accessRows]);

  const blockedByCustomer = useMemo(() => {
    const m = {};
    blockedRows.forEach(row => {
      if (!m[row.customer_id]) m[row.customer_id] = [];
      m[row.customer_id].push(row.product_id);
    });
    return m;
  }, [blockedRows]);

  const filtered = useMemo(() =>
    customers.filter(c => c.name?.toLowerCase().includes(search.toLowerCase())),
    [customers, search]
  );

  const handleToggleActive = async (customerId, currentValue) => {
    const access = accessByCustomer[customerId];
    if (!access) return;
    const { error } = await supabase
      .from("customer_portal_access")
      .update({ is_active: !currentValue })
      .eq("id", access.id);
    if (error) { toast.error("שגיאה בעדכון סטטוס"); return; }
    qc.setQueryData(["customer-portal-access-all"], (old = []) =>
      old.map(r => r.id === access.id ? { ...r, is_active: !currentValue } : r)
    );
    toast.success(!currentValue ? "גישה הופעלה" : "גישה הושבתה");
  };

  const handleSaved = () => {
    qc.invalidateQueries({ queryKey: ["customer-portal-access-all"] });
    qc.invalidateQueries({ queryKey: ["customer-blocked-products-all"] });
    setEditing(null);
  };

  const activeCount = accessRows.filter(r => r.is_active).length;

  const TABS = [
    { key: "access", label: "ניהול גישת לקוחות" },
    { key: "orders", label: "הזמנות ממתינות", badge: pendingCount },
  ];

  return (
    <div className="heillo-page" dir="rtl">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--heillo-text-primary)", margin: 0, fontFamily: "'Heebo', sans-serif" }}>פורטל לקוחות</h1>
            <p style={{ fontSize: 13, color: "var(--heillo-text-muted)", margin: "2px 0 0", fontFamily: "'Heebo', sans-serif" }}>
              {activeCount} לקוחות עם גישה פעילה · {customers.length} לקוחות סה״כ
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#FFFFFF", borderRadius: 16, padding: 4, width: "fit-content", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                height: 36, padding: "0 18px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif",
                fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s",
                background: tab === t.key ? ACCENT : "transparent",
                color: tab === t.key ? "#FFFFFF" : MUTED,
              }}
            >
              {t.label}
              {t.badge > 0 && (
                <span style={{
                  background: tab === t.key ? "rgba(255,255,255,0.28)" : "#dc2626",
                  color: "#FFFFFF", borderRadius: 99, minWidth: 18, height: 18,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, padding: "0 5px",
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search — only shown in access tab */}
        {tab === "access" && (
          <div style={{ position: "relative", maxWidth: 360, marginTop: 14 }}>
            <Search style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: MUTED, pointerEvents: "none" }} />
            <input
              type="text" placeholder="חיפוש לקוח..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", height: 44, background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: "0 44px 0 14px", fontSize: 14, color: DARK, fontFamily: "'Heebo', sans-serif", outline: "none", boxSizing: "border-box" }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <X style={{ width: 14, height: 14, color: MUTED }} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab 1: Customer access table */}
      {tab === "access" && (
        <div style={{ ...CARD, overflow: "hidden" }}>
          {loadingCustomers ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
              <div style={{ width: 32, height: 32, border: "3px solid rgba(245,136,94,0.2)", borderTopColor: ACCENT, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Heebo', sans-serif" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    {["שם לקוח", "סטטוס גישה", "אימייל פורטל", "הנחה", "הזמנה מינימלית", ""].map((h, i) => (
                      <th key={i} style={{ padding: "14px 20px", textAlign: "right", fontSize: 12, fontWeight: 600, color: MUTED, whiteSpace: "nowrap", background: "#FAFAFA" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: "48px 0", color: MUTED, fontSize: 14 }}>לא נמצאו לקוחות</td></tr>
                  )}
                  {filtered.map((customer, idx) => {
                    const access = accessByCustomer[customer.id];
                    const hasAccess = !!access;
                    return (
                      <tr key={customer.id}
                        style={{ borderBottom: idx < filtered.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", transition: "background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.015)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <td style={{ padding: "14px 20px", fontSize: 14, fontWeight: 600, color: DARK, whiteSpace: "nowrap" }}>{customer.name}</td>
                        <td style={{ padding: "14px 20px" }}>
                          {hasAccess ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <Toggle checked={access.is_active} onChange={() => handleToggleActive(customer.id, access.is_active)} />
                              <span style={{ fontSize: 13, color: access.is_active ? "#16a34a" : MUTED }}>
                                {access.is_active ? "פעיל" : "מושבת"}
                              </span>
                            </div>
                          ) : (
                            <span style={{ fontSize: 13, color: MUTED }}>אין גישה</span>
                          )}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: hasAccess ? DARK : MUTED }}>{access?.phone_or_email || "—"}</td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: DARK, whiteSpace: "nowrap" }}>{hasAccess ? `${(access.custom_discount_percent > 0 ? access.custom_discount_percent : customer.discount_percent) || 0}%` : "—"}</td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: DARK, whiteSpace: "nowrap" }}>{hasAccess ? `₪${Number(access.min_order_amount || 0).toLocaleString("he-IL")}` : "—"}</td>
                        <td style={{ padding: "14px 20px", textAlign: "left" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                            {hasAccess && access.is_active && (
                              <button
                                onClick={() => sendWhatsApp(customer, access)}
                                title="שלח קישור לפורטל בוואטסאפ"
                                style={{
                                  height: 34, width: 34, background: "rgba(37,211,102,0.1)",
                                  border: "none", borderRadius: 10, cursor: "pointer",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0, transition: "background 0.15s",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(37,211,102,0.2)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(37,211,102,0.1)"; }}
                              >
                                <MessageCircle style={{ width: 16, height: 16, color: "#25D366" }} />
                              </button>
                            )}
                            {hasAccess && (
                              <button
                                onClick={() => access.auth_user_id
                                  ? setResetting({ customer, authUserId: access.auth_user_id })
                                  : toast.error("הלקוח עדיין לא נרשם לפורטל")
                                }
                                title={access.auth_user_id ? "אפס סיסמת פורטל" : "הלקוח עדיין לא נרשם"}
                                style={{
                                  height: 34, width: 34,
                                  background: access.auth_user_id ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.04)",
                                  border: "none", borderRadius: 10,
                                  cursor: access.auth_user_id ? "pointer" : "not-allowed",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0, transition: "background 0.15s",
                                  opacity: access.auth_user_id ? 1 : 0.45,
                                }}
                                onMouseEnter={e => { if (access.auth_user_id) e.currentTarget.style.background = "rgba(99,102,241,0.2)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = access.auth_user_id ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.04)"; }}
                              >
                                <KeyRound style={{ width: 15, height: 15, color: access.auth_user_id ? "#6366f1" : MUTED }} />
                              </button>
                            )}
                            <button
                              onClick={() => setEditing({ customer, access: access || null })}
                              style={{
                                height: 34, background: hasAccess ? "rgba(0,0,0,0.04)" : ACCENT,
                                color: hasAccess ? DARK : "#FFFFFF",
                                border: "none", borderRadius: 10, padding: "0 16px",
                                fontSize: 13, fontWeight: 600, fontFamily: "'Heebo', sans-serif",
                                cursor: "pointer", whiteSpace: "nowrap", transition: "opacity 0.15s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                            >
                              {hasAccess ? "ערוך" : "הפעל גישה לפורטל"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Pending orders */}
      {tab === "orders" && <PendingOrdersTab />}

      {/* Edit modal */}
      {editing && (
        <AccessModal
          customer={editing.customer}
          access={editing.access}
          products={products}
          blockedProductIds={blockedByCustomer[editing.customer.id] || []}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Reset password modal */}
      {resetting && (
        <ResetPasswordModal
          customer={resetting.customer}
          authUserId={resetting.authUserId}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}
