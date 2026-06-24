import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);       // Supabase session from recovery link
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase puts the recovery token in the URL hash and fires PASSWORD_RECOVERY
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw err;
      setDone(true);
      setTimeout(() => (window.location.href = "/login"), 2000);
    } catch (err) {
      setError(err.message || "שגיאה באיפוס הסיסמה");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthLayout icon={CheckCircle2} title="סיסמה אופסה בהצלחה" subtitle="מועבר להתחברות...">
        <p className="text-sm text-center text-muted-foreground">הסיסמה שלך עודכנה. מועבר לדף ההתחברות.</p>
      </AuthLayout>
    );
  }

  if (!ready) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="קישור לא תקין"
        subtitle="קישור איפוס הסיסמה חסר או לא תקין"
        footer={<Link to="/forgot-password" className="text-primary font-medium hover:underline">בקש קישור חדש</Link>}
      >
        <p className="text-sm text-foreground text-center">
          הקישור שבו השתמשת נראה לא שלם. בקש אימייל חדש לאיפוס סיסמה.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout icon={Lock} title="סיסמה חדשה" subtitle="הזן את הסיסמה החדשה שלך">
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">סיסמה חדשה</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="password" type="password" autoComplete="new-password" autoFocus placeholder="••••••••"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="pl-10 h-12" required />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">אימות סיסמה</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="confirm" type="password" autoComplete="new-password" placeholder="••••••••"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="pl-10 h-12" required />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" />מאפס...</> : "אפס סיסמה"}
        </Button>
      </form>
    </AuthLayout>
  );
}
