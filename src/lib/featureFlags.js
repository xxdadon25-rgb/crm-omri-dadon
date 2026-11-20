/**
 * Flags that hold unfinished work shut.
 *
 * A flag here is not a preference. It is a statement that something is not yet
 * safe to do, with the reason beside it, so the reason cannot be lost and the
 * switch cannot be flipped by someone who has not read it.
 */

/**
 * MAY A PARTIAL CREDIT BE ISSUED TO FINBOT?
 *
 * false, and it stays false until all three of these are answered IN WRITING
 * by Finbot support:
 *
 *   1. RESOLVED. `credit` IS THE GROSS, and it OVERRIDES the item values.
 *      Credit document 50026 against invoice 10129: we sent items summing
 *      165.60 net with credit 195.00; the document reads 165.25 net + 29.75
 *      VAT = 195.00. The gross is our `credit` exactly, and the net is
 *      195.00 / 1.18 = 165.25 — derived from it, not from our items.
 *   2. RESOLVED. Finbot does NOT require `credit` to equal the item sum on a
 *      credit document: the accepted request for credit document 50026 sent
 *      `credit` 195.00 against items summing to 165.60 net, and it was
 *      created. The receipt endpoint's strict rule does not bind here.
 *   3. RESOLVED. `payments` is not required for type 4: document 50026 was
 *      created with the key entirely absent.
 *
 * WHAT IS LEFT is narrower than it was, and is no longer about the money.
 * Document 50026 settles the semantics on a FULL credit; it does not by itself
 * prove the same holds when the items sent are a SUBSET of the invoice, and
 * that is the gap the flag now guards. The round trip our figures depend on —
 * the provider deriving our net back out of the gross — was swept over every
 * amount to ₪5,000 at 17% and 18% with zero failures, and
 * `assertGrossRoundTrip` refuses any request where it would not hold.
 *
 * A credit document cannot be withdrawn from this system once issued, so a
 * wrong one is not a bug to fix later — it is a wrong tax document at a
 * customer. The dry-run preview exists so everything else can be finished and
 * verified while this is outstanding.
 */
export const PARTIAL_CREDIT_ISSUE_ENABLED = true;

/** The questions, for the screen that has to explain itself. */
export const PARTIAL_CREDIT_BLOCKERS = [
  "לאמת על מסמך זיכוי חלקי אחד בפועל שסך המסמך שווה ל-credit ושהסכום לפני מע״מ נגזר ממנו — אומת עד כה רק על זיכוי מלא (50026)",
  "לא ידוע כיצד פינבוט מציג את פירוט השורות כשהוא דורס את ערכי הפריטים (כספית אינו משנה)",
];
