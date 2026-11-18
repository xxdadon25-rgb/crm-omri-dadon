/**
 * ONE short question, asked during order entry, only when the answer cannot
 * be worked out.
 *
 * ============================================================================
 * TWO QUESTIONS THAT MUST NOT BE CONFUSED
 * ============================================================================
 *   "WHICH LEVEL did this line sell?" — a fact about THIS ORDER LINE. The same
 *   product goes out by the unit to one customer and by the carton to another,
 *   so this answer is kept on the line and NEVER promoted into a product fact.
 *
 *   "HOW MANY units are in a pack?" — a fact about THE PRODUCT. It barely
 *   changes, so it is saved permanently and never asked again.
 *
 * The dialog therefore says, in as many words, which of the two it is asking,
 * and what will be remembered.
 *
 * ============================================================================
 * WHY IT ASKS AT ALL
 * ============================================================================
 * The alternative is a guess. A purchase price per unit against a selling
 * price per carton produces a ~2,000% margin, and the old panel printed it
 * with a straight face. Where the price makes the level obvious nothing is
 * asked (see inferSaleLevel); this appears only when it genuinely does not.
 *
 * Skipping is always allowed. The order is recorded either way and the line's
 * profit simply reads "ממתין להבהרה" — never a number nobody can justify.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SALE_LEVELS, LEVEL_LABEL, missingForLevel, unitsPerLevel } from "@/lib/packagingMath";
import { savePackaging } from "@/api/productPackaging";

const MISSING_LABEL = {
  units_per_pack: "יחידות במארז",
  packs_per_carton: "מארזים בקרטון",
};

export default function PackagingClarifyDialog({
  open, onOpenChange, request, onResolved,
}) {
  // request: { productId, productName, packaging, kind, level, missing }
  const [level, setLevel] = useState(null);
  // The PRODUCT's purchase-price level. Seeded only from what has already
  // been CONFIRMED and stored for this product; never from supplier data,
  // which describes a supplier's own price rather than this one.
  const [buyLevel, setBuyLevel] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLevel(request?.level ?? null);
    // Seeded from the PRODUCT's recorded level when there is one. Without
    // this the question is correctly hidden for a product whose basis is
    // already known, but the state stays null and the confirm button can
    // never enable — the dialog becomes a dead end.
    setBuyLevel(request?.buyLevel ?? request?.packaging?.buy_price_level ?? null);
    setFields({});
    setSaving(false);
  }, [open, request?.productId, request?.level]);

  if (!request) return null;

  const packaging = request.packaging || {};
  // What still has to be known for the level the operator has chosen. Computed
  // live, so choosing "carton" reveals the carton field immediately.
  // Both levels need their factors: a per-carton purchase price cannot be
  // divided down without knowing how big a carton is.
  const needed = [...new Set([
    ...(level ? missingForLevel(packaging, level) : []),
    ...(buyLevel ? missingForLevel(packaging, buyLevel) : []),
  ])];
  const stillMissing = needed.filter(k => {
    const v = fields[k];
    return v === undefined || v === "" || !(Number(v) > 0);
  });
  const canConfirm = !!level && !!buyLevel && stillMissing.length === 0;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      // The PRODUCT facts, saved permanently — and only the ones actually
      // entered here, so an untouched field never clears an earlier answer.
      const patch = {};
      for (const key of needed) {
        if (fields[key] !== undefined && fields[key] !== "") patch[key] = fields[key];
      }
      // The purchase level is a product fact, saved once and never asked again.
      if (buyLevel && buyLevel !== packaging.buy_price_level) {
        patch.buy_price_level = buyLevel;
      }
      let savedPackaging = { ...packaging, ...patch };
      if (Object.keys(patch).length > 0) {
        const res = await savePackaging(request.productId, patch);
        if (!res.ok) {
          // The permanent save failed, so nothing is claimed to be remembered.
          // The level still applies to this line, which is reported honestly.
          toast.warning(`${res.error}. רמת האריזה נשמרה לשורה זו בלבד.`);
          savedPackaging = packaging;
        }
      }
      // The LINE fact goes back to the caller; it is never written to the
      // product.
      onResolved?.({
        productId: request.productId,
        saleLevel: level,
        buyLevel,
        packaging: savedPackaging,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>איך נמכר {request.productName || "המוצר"}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            המחיר שהוזן אינו קובע באופן חד-משמעי מה נמכר, ולכן לא ניתן לחשב רווח אמין.
            שאלה אחת ונמשיך.
          </p>

          {/* ── The PRODUCT question: what is the purchase price per? ─────
              Asked first, because without it no margin is possible at any
              sale level. Pre-selected when approved supplier data answered it,
              and still confirmed rather than assumed. */}
          {!packaging.buy_price_level && (
            <div className="space-y-1.5 border border-border rounded-lg p-3 bg-muted/20">
              <Label className="text-sm">מחיר הקנייה שרשום למוצר — למה הוא מתייחס?</Label>
              <div className="grid grid-cols-3 gap-2">
                {SALE_LEVELS.map((l) => (
                  <button key={l} type="button" onClick={() => setBuyLevel(l)}
                    className={`rounded-lg border p-2 text-center ${
                      buyLevel === l ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                    <span className="block text-sm font-medium">ל{LEVEL_LABEL[l]}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                נתון קבוע של המוצר — יישמר ולא נשאל עליו שוב.
              </p>
            </div>
          )}

          {/* The LINE question. */}
          <div className="space-y-1.5">
            <Label className="text-sm">מה נמכר בשורה הזו?</Label>
            <div className="grid grid-cols-3 gap-2">
              {SALE_LEVELS.map((l) => {
                const units = unitsPerLevel(packaging, l);
                return (
                  <button key={l} type="button" onClick={() => setLevel(l)}
                    className={`rounded-lg border p-2 text-center ${
                      level === l ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                    <span className="block text-sm font-medium">{LEVEL_LABEL[l]}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {units === null ? "נדרש מידע" : units === 1 ? "יחידה אחת" : `${units} יחידות`}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* WHAT THE OLD RECORD SAYS — shown, deliberately NOT selected.
                These labels have no provenance: one of them is order #1197's
                ₪186 = "unit", which is wrong. Pre-selecting it would let a
                click past the dialog promote that error into verified
                evidence, so the owner is informed and still chooses. */}
            {request.suggestion && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                ברשומות הקודמות, מחיר דומה (₪{Number(request.suggestion.price).toFixed(2)})
                סומן כ{LEVEL_LABEL[request.suggestion.level]}
                {request.suggestion.n > 1 ? ` (${request.suggestion.n} פעמים)` : ""} —
                לא אושר על ידך, ולכן לא נבחר אוטומטית. בדוק ואשר.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              נשמר לשורה הזו בלבד — מכירות עתידיות של אותו מוצר יכולות להיות ברמה אחרת.
            </p>
          </div>

          {/* The PRODUCT question, shown only if the chosen level needs it. */}
          {needed.length > 0 && (
            <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
              <Label className="text-sm">נתוני האריזה של המוצר</Label>
              {needed.map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{MISSING_LABEL[key]}</Label>
                  <Input type="number" step="any" min="0" autoFocus={key === needed[0]}
                    value={fields[key] ?? ""}
                    onChange={(e) => setFields(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                זה נתון קבוע של המוצר — <strong>יישמר ולא נשאל עליו שוב</strong>, וישמש גם
                בהשוואת מחירי הספקים.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-3 border-t border-border">
          <Button onClick={handleConfirm} disabled={!canConfirm || saving} className="flex-1">
            {saving ? "שומר..." : "אישור"}
          </Button>
          {/* Skipping must stay cheap: an order is never blocked by a question
              about profitability. */}
          <Button variant="outline" onClick={() => { onResolved?.(null); onOpenChange(false); }}
            disabled={saving}>
            דלג
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
