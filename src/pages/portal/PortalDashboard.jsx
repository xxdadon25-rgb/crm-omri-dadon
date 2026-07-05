import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";

const PAGE_STYLE = {
  minHeight: "100vh",
  background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Heebo', sans-serif",
  padding: "24px 16px",
};

function Spinner() {
  return (
    <div style={PAGE_STYLE} dir="rtl">
      <div style={{
        width: 36,
        height: 36,
        border: `3px solid rgba(245,136,94,0.2)`,
        borderTopColor: ACCENT,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function PortalDashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading"); // loading | ready | redirecting
  const [customerName, setCustomerName] = useState("");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
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

      const { data: customer } = await supabase
        .from("customers")
        .select("name")
        .eq("id", access.customer_id)
        .maybeSingle();

      if (!cancelled) {
        setCustomerName(customer?.name || "");
        setStatus("ready");
      }
    };

    check();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/portal/login", { replace: true });
  };

  if (status === "loading") return <Spinner />;

  return (
    <div dir="rtl" style={PAGE_STYLE}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: DARK, margin: "0 0 24px", letterSpacing: "-0.5px" }}>
        א.ד שיווק והפצה
      </h1>

      <div style={{
        background: "#FFFFFF",
        borderRadius: 22,
        boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
        padding: "32px 28px",
        width: "100%",
        maxWidth: 440,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: DARK, margin: "0 0 6px" }}>
            ברוך הבא{customerName ? `, ${customerName}` : ""}
          </h2>
          <button
            onClick={() => navigate("/portal/catalog")}
            style={{
              background: ACCENT, color: "#FFFFFF", border: "none", borderRadius: 12,
              padding: "9px 18px", fontSize: 14, fontWeight: 600,
              fontFamily: "'Heebo', sans-serif", cursor: "pointer", marginTop: 4,
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            לקטלוג המוצרים ←
          </button>
        </div>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 16 }}>
          <button
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: `1px solid rgba(0,0,0,0.1)`,
              borderRadius: 12,
              padding: "9px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: DARK,
              fontFamily: "'Heebo', sans-serif",
              cursor: "pointer",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            התנתקות
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
