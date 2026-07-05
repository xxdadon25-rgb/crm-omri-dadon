import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";

const PAGE_STYLE = {
  minHeight: "100vh",
  background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0",
  fontFamily: "'Heebo', sans-serif",
  padding: "32px 16px",
  direction: "rtl",
};

const STATUS_CONFIG = {
  pending:  { label: "ממתין לאישור", bg: "rgba(234,179,8,0.12)",  color: "#854d0e" },
  approved: { label: "אושרה",        bg: "rgba(22,163,74,0.1)",   color: "#15803d" },
  rejected: { label: "נדחתה",        bg: "rgba(220,38,38,0.1)",   color: "#dc2626" },
};

function Spinner() {
  return (
    <div style={{ ...PAGE_STYLE, display: "flex", alignItems: "center", justifyContent: "center" }} dir="rtl">
      <div style={{
        width: 36, height: 36,
        border: "3px solid rgba(245,136,94,0.2)",
        borderTopColor: ACCENT,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function fmt(n) {
  return Number(n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function OrderCard({ order, productMap }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const items = order.portal_order_items || [];

  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 18,
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      overflow: "hidden", marginBottom: 12,
    }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "16px 20px",
          background: "transparent", border: "none", cursor: "pointer",
          fontFamily: "'Heebo', sans-serif", textAlign: "right",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: MUTED }}>{formatDate(order.created_at)}</span>
          {order.notes && (
            <span style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {order.notes}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{
            background: status.bg, color: status.color,
            borderRadius: 99, padding: "3px 10px", fontSize: 12, fontWeight: 700,
          }}>
            {status.label}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: DARK }}>
            ₪{fmt(order.total_amount)}
          </span>
          <span style={{ fontSize: 18, color: MUTED, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▾
          </span>
        </div>
      </button>

      {/* Line items */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", padding: "12px 20px 16px" }}>
          {items.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>אין פריטים</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: MUTED, fontWeight: 600 }}>
                  <th style={{ textAlign: "right", paddingBottom: 8 }}>מוצר</th>
                  <th style={{ textAlign: "center", paddingBottom: 8 }}>כמות</th>
                  <th style={{ textAlign: "left", paddingBottom: 8 }}>מחיר יחידה</th>
                  <th style={{ textAlign: "left", paddingBottom: 8 }}>סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id || i} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                    <td style={{ padding: "7px 0", fontWeight: 500, color: DARK }}>
                      {productMap[item.product_id] || "מוצר"}
                    </td>
                    <td style={{ textAlign: "center", color: DARK }}>{item.quantity}</td>
                    <td style={{ textAlign: "left", color: DARK }}>₪{fmt(item.unit_price)}</td>
                    <td style={{ textAlign: "left", fontWeight: 600, color: DARK }}>
                      ₪{fmt((item.quantity || 0) * (item.unit_price || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortalOrders() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [orders, setOrders] = useState([]);
  const [productMap, setProductMap] = useState({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Auth + access guard — same pattern as PortalDashboard/PortalCatalog
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) navigate("/portal/login", { replace: true });
        return;
      }

      const { data: access } = await supabase
        .from("customer_portal_access")
        .select("is_active, customer_id")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (!access || !access.is_active) {
        if (!cancelled) navigate("/portal/login", { replace: true });
        return;
      }

      const customerId = access.customer_id;

      // Fetch orders with items
      const { data: ordersData, error: ordErr } = await supabase
        .from("portal_orders")
        .select("*, portal_order_items(*)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });

      if (ordErr || !ordersData) {
        if (!cancelled) setStatus("ready");
        return;
      }

      // Collect unique product IDs and fetch names
      const productIds = [
        ...new Set(
          ordersData.flatMap(o => (o.portal_order_items || []).map(i => i.product_id).filter(Boolean))
        ),
      ];

      let pMap = {};
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("id, name")
          .in("id", productIds);
        if (products) {
          products.forEach(p => { pMap[p.id] = p.name; });
        }
      }

      if (!cancelled) {
        setOrders(ordersData);
        setProductMap(pMap);
        setStatus("ready");
      }
    };

    load();
    return () => { cancelled = true; };
  }, [navigate]);

  if (status === "loading") return <Spinner />;

  return (
    <div dir="rtl" style={PAGE_STYLE}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: DARK, margin: 0, letterSpacing: "-0.5px" }}>
            היסטוריית הזמנות
          </h1>
          <button
            onClick={() => navigate("/portal/dashboard")}
            style={{
              background: "transparent", border: "1px solid rgba(0,0,0,0.1)",
              borderRadius: 12, padding: "8px 16px", fontSize: 13,
              fontWeight: 600, color: DARK, fontFamily: "'Heebo', sans-serif",
              cursor: "pointer",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            ← חזרה לדשבורד
          </button>
        </div>

        {/* Empty state */}
        {orders.length === 0 ? (
          <div style={{
            background: "#FFFFFF", borderRadius: 22,
            boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
            padding: "48px 28px", textAlign: "center",
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: DARK, margin: "0 0 8px" }}>
              עדיין לא ביצעת הזמנות
            </p>
            <p style={{ fontSize: 14, color: MUTED, margin: "0 0 24px" }}>
              עיין בקטלוג המוצרים שלנו ובצע את ההזמנה הראשונה שלך
            </p>
            <button
              onClick={() => navigate("/portal/catalog")}
              style={{
                background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12,
                padding: "10px 22px", fontSize: 14, fontWeight: 600,
                fontFamily: "'Heebo', sans-serif", cursor: "pointer",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >
              לקטלוג המוצרים ←
            </button>
          </div>
        ) : (
          orders.map(order => (
            <OrderCard key={order.id} order={order} productMap={productMap} />
          ))
        )}
      </div>
    </div>
  );
}
