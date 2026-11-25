/**
 * Empty agent onboarding screen on the existing QuickStock layout.
 * Does not request or mutate production data. Agent role is only granted
 * after the real database role/row-level policies are installed and verified.
 */
export default function AgentPendingSetup() {
  return (
    <main dir="rtl" className="mx-auto max-w-5xl p-4 md:p-7 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">דשבורד סוכן</h1>
        <p className="text-slate-600 mt-2">החשבון מחובר. ההרשאות והלקוחות עדיין לא הוקצו.</p>
      </header>
      <section className="rounded-xl border bg-white p-5 space-y-2">
        <h2 className="font-bold">המערכת מוכנה לחיבור בשלבים</h2>
        <p>בשלב זה לא יוצגו מוצרים, לקוחות, הזמנות או נתונים כספיים.</p>
        <p className="text-sm text-slate-600">המסך משתמש בעיצוב של QuickStock. אין כאן גישה לנתוני העסק או אפשרות לבצע שינויים.</p>
      </section>
    </main>
  );
}
