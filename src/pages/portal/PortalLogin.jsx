import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { usePortalPWAMeta } from "@/hooks/usePortalPWAMeta";

const ACCENT = "#F5885E";
const DARK = "#120F1C";
const MUTED = "#B2B0B1";

const ERROR_MAP = {
  "Invalid login credentials": "אימייל או סיסמה שגויים.",
  "Email not confirmed": "יש לאשר את כתובת האימייל לפני ההתחברות. בדוק את תיבת הדואר שלך.",
  "User already registered": "כתובת האימייל כבר רשומה במערכת.",
  "Password should be at least 6 characters": "הסיסמה חייבת להכיל לפחות 6 תווים.",
  "Unable to validate email address: invalid format": "כתובת האימייל אינה תקינה.",
  "signup is disabled": "ההרשמה אינה פעילה כרגע.",
  "Email rate limit exceeded": "יותר מדי ניסיונות. נסה שוב מאוחר יותר.",
};

function translateError(msg) {
  if (!msg) return "אירעה שגיאה. נסה שוב.";
  for (const [key, val] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return val;
  }
  return msg;
}

export default function PortalLogin() {
  usePortalPWAMeta();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "signup") {
        // Pre-check: only allow signup if email has an approved customer_portal_access row.
        // Fail closed — any error (query error, network, missing RLS policy) also blocks signup.
        let approved = false;
        try {
          const { data: accessRow, error: checkError } = await supabase
            .from("customer_portal_access")
            .select("id")
            .ilike("phone_or_email", email.trim())
            .eq("is_active", true)
            .maybeSingle();
          approved = !checkError && !!accessRow;
        } catch {
          approved = false;
        }
        if (!approved) {
          setError("כתובת האימייל הזו לא מאושרת להרשמה לפורטל. פנה אלינו לקבלת גישה.");
          return;
        }
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) { setError(translateError(err.message)); return; }
        setSignupSuccess(true);
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) { setError(translateError(err.message)); return; }
        navigate("/portal/dashboard");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    height: 44,
    background: "#F5F3F6",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 12,
    padding: "0 14px",
    fontSize: 14,
    color: DARK,
    fontFamily: "'Heebo', sans-serif",
    outline: "none",
    boxSizing: "border-box",
    direction: "rtl",
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse 40% 35% at 75% 5%, rgba(252,234,227,0.75) 0%, rgba(236,237,240,0) 100%), #ECEDF0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Heebo', sans-serif",
        padding: "24px 16px",
      }}
    >
      {/* Business name heading */}
      <h1 style={{ fontSize: 24, fontWeight: 800, color: DARK, margin: "0 0 24px", letterSpacing: "-0.5px" }}>
        א.ד שיווק והפצה
      </h1>

      {/* Card */}
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 22,
          boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
          padding: "32px 28px",
          width: "100%",
          maxWidth: 400,
        }}
      >
        {/* Tab toggle */}
        <div style={{ display: "flex", background: "#F5F3F6", borderRadius: 12, padding: 4, marginBottom: 28, gap: 4 }}>
          {[{ id: "login", label: "התחברות" }, { id: "signup", label: "הרשמה" }].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(""); setSignupSuccess(false); }}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 9,
                border: "none",
                cursor: "pointer",
                fontFamily: "'Heebo', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                transition: "background 0.15s, color 0.15s",
                background: tab === id ? "#FFFFFF" : "transparent",
                color: tab === id ? DARK : MUTED,
                boxShadow: tab === id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {signupSuccess ? (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
            <p style={{ fontSize: 15, color: DARK, fontWeight: 600, margin: "0 0 8px" }}>ההרשמה הושלמה!</p>
            <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.6 }}>
              נשלח אליך מייל אישור. יש לאשר את כתובת האימייל לפני ההתחברות.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 6 }}>
                כתובת אימייל
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                style={inputStyle}
                autoComplete="email"
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 6 }}>
                סיסמה
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === "signup" ? "לפחות 6 תווים" : "הכנס סיסמה"}
                style={inputStyle}
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <div style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 44,
                background: loading ? "#ccc" : ACCENT,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "'Heebo', sans-serif",
                cursor: loading ? "not-allowed" : "pointer",
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "opacity 0.15s",
                opacity: loading ? 0.75 : 1,
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  טוען...
                </>
              ) : (
                tab === "login" ? "התחבר" : "הרשמה"
              )}
            </button>
          </form>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
