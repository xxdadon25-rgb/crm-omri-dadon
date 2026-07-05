import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { Search, X, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";
const CARD = { background: "#FFFFFF", borderRadius: 22, boxShadow: "0 4px 20px rgba(0,0,0,0.05)" };

// ─── Toggle Switch ────────────────────────────────────────────────────────────
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

// ─── Input ────────────────────────────────────────────────────────────────────
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

// ─── Modal ────────────────────────────────────────────────────────────────────
function AccessModal({ customer, access, products, blockedProductIds, onClose, onSaved }) {
  const isNew = !access;
  const [form, setForm] = useState({
    phone_or_email: access?.phone_or_email || "",
    custom_discount_percent: access?.custom_discount_percent ?? 0,
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

      // Sync blocked products
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
        {/* Header */}
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

        {/* Form fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="כתובת אימייל" type="email" value={form.phone_or_email}
            onChange={v => setForm(f => ({ ...f, phone_or_email: v }))} placeholder="email@example.com" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="הנחה (%)" type="number" value={form.custom_discount_percent}
              onChange={v => setForm(f => ({ ...f, custom_discount_percent: v }))} min="0" step="0.1" placeholder="0" />
            <Field label="הזמנה מינימלית (₪)" type="number" value={form.min_order_amount}
              onChange={v => setForm(f => ({ ...f, min_order_amount: v }))} min="0" step="1" placeholder="0" />
          </div>
        </div>

        {/* Blocked products section */}
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
            {showProducts
              ? <ChevronUp style={{ width: 15, height: 15, color: MUTED }} />
              : <ChevronDown style={{ width: 15, height: 15, color: MUTED }} />
            }
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
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 10, cursor: "pointer", background: blocked.has(p.id) ? "rgba(245,136,94,0.06)" : "transparent" }}
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

        {/* Actions */}
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PortalCustomerAccess() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // { customer, access | null }

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["customers-portal-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name");
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

  // Maps for O(1) lookup
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

        {/* Search */}
        <div style={{ position: "relative", maxWidth: 360 }}>
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
      </div>

      {/* Table card */}
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
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "48px 0", color: MUTED, fontSize: 14 }}>לא נמצאו לקוחות</td>
                  </tr>
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
                      {/* Name */}
                      <td style={{ padding: "14px 20px", fontSize: 14, fontWeight: 600, color: DARK, whiteSpace: "nowrap" }}>
                        {customer.name}
                      </td>

                      {/* Status */}
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

                      {/* Email */}
                      <td style={{ padding: "14px 20px", fontSize: 13, color: hasAccess ? DARK : MUTED }}>
                        {access?.phone_or_email || "—"}
                      </td>

                      {/* Discount */}
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK, whiteSpace: "nowrap" }}>
                        {hasAccess ? `${access.custom_discount_percent || 0}%` : "—"}
                      </td>

                      {/* Min order */}
                      <td style={{ padding: "14px 20px", fontSize: 13, color: DARK, whiteSpace: "nowrap" }}>
                        {hasAccess ? `₪${Number(access.min_order_amount || 0).toLocaleString("he-IL")}` : "—"}
                      </td>

                      {/* Action */}
                      <td style={{ padding: "14px 20px", textAlign: "left" }}>
                        <button
                          onClick={() => setEditing({ customer, access: access || null })}
                          style={{
                            height: 34, background: hasAccess ? "rgba(0,0,0,0.04)" : ACCENT,
                            color: hasAccess ? DARK : "#FFFFFF",
                            border: "none", borderRadius: 10, padding: "0 16px",
                            fontSize: 13, fontWeight: 600, fontFamily: "'Heebo', sans-serif",
                            cursor: "pointer", whiteSpace: "nowrap",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                        >
                          {hasAccess ? "ערוך" : "הפעל גישה לפורטל"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
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
    </div>
  );
}
