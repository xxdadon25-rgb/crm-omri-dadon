import { useMemo, useState } from "react";

/**
 * Public, explicitly synthetic preview of the sales agent workflow.
 * NO imports from Supabase, Auth or live data modules; NO network writes.
 * Production QuickStock continues unchanged.
 */
const customers = [
  { id: "c1", name: "מאפיית הדגמה", city: "חיפה" },
  { id: "c2", name: "מינימרקט לדוגמה", city: "נשר" },
];
const products = [
  { id: "p1", name: "כוסות נייר 9oz", price: 80, cost: 42, unit: "קרטון" },
  { id: "p2", name: "צלחות שקופות", price: 65, cost: 32, unit: "קרטון" },
  { id: "p3", name: "מכסי כוסות", price: 75, cost: 38, unit: "קרטון" },
];
const blocked = { id: "p4", name: "מוצר חסום לסוכן" };
const fmt = value => Number(value || 0).toLocaleString("he-IL", { style: "currency", currency: "ILS" });
const baseStyle = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const inputStyle = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const btnStyle = "rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40";

export default function AgentDemo() {
  const [role, setRole] = useState("agent");
  const [customerId, setCustomerId] = useState("c1");
  const [productId, setProductId] = useState("p1");
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notice, setNotice] = useState("");
  const [discount, setDiscount] = useState(0);
  const [exception, setException] = useState(false);
  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const cost = lines.reduce((s, l) => s + l.cost * l.qty, 0);
    const sale = Math.max(0, gross - Number(discount || 0));
    return { sale, cost, margin: sale ? ((sale - cost) / sale) * 100 : 0 };
  }, [lines, discount]);
  const addProduct = () => {
    const p = products.find(p => p.id === productId);
    if (!p || qty < 1) return;
    setLines(ls => [...ls, { ...p, qty: Number(qty) }]);
    setNotice("");
  };
  const createOrder = () => {
    if (!lines.length || totals.sale <= 0) return;
    if (totals.margin < 40 && !exception) {
      setNotice("רווחיות מתחת ל־40%: נדרש אישור מנהל לפני יצירת הזמנה.");
      return;
    }
    const id = "D-" + String(1001 + orders.length);
    setOrders(os => [{ id, customer: customers.find(c => c.id === customerId)?.name, amount: totals.sale, status: "ממתין לחשבונית", paid: false, invoiced: false }, ...os]);
    setLines([]); setDiscount(0); setException(false);
    setNotice("הזמנת הדגמה " + id + " נוצרה. היא לא נשמרה ב־QuickStock.");
  };
  const update = (id, patch) => setOrders(os => os.map(o => o.id === id ? { ...o, ...patch } : o));
  const paidTotal = orders.filter(o => o.paid).reduce((sum, o) => sum + o.amount, 0);
  return <main dir="rtl" className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="rounded-xl bg-amber-100 border-2 border-amber-400 p-4">
        <strong className="text-lg">סביבת הדגמה בלבד — ללא חיבור ל־QuickStock</strong>
        <p className="text-sm mt-1">כל הנתונים כאן פיקטיביים. הזמנות, חשבוניות ותשלומים לא נשלחים למערכת האמיתית. זו הדגמת תהליך, לא בדיקת אבטחת שרת או מסד נתונים.</p>
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">QuickStock — הדגמת מערכת סוכנים</h1><p className="text-slate-600">הדמיה אינטראקטיבית ללא סיסמה וללא שינוי במערכת</p></div>
        <div className="flex gap-2">
          <button type="button" className={role === "agent" ? btnStyle : inputStyle} onClick={() => setRole("agent")}>תצוגת סוכן</button>
          <button type="button" className={role === "manager" ? btnStyle : inputStyle} onClick={() => setRole("manager")}>תצוגת מנהל</button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["לקוחות משויכים", "2"], ["הזמנות הדגמה", orders.length], ["גבייה מדומה", fmt(paidTotal)], ["עמלה משוערת 8%", fmt(paidTotal / 1.18 * 0.08)]].map(([label, value]) =>
          <div key={label} className={baseStyle}><p className="text-sm text-slate-500">{label}</p><strong className="text-xl">{value}</strong></div>)}
      </div>
      {role === "agent" ? <>
        <section className={baseStyle}>
          <h2 className="font-bold text-lg mb-3">הזמנה חדשה — סוכן</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <label>לקוח משויך<select className={inputStyle} value={customerId} onChange={e => setCustomerId(e.target.value)}>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>מוצר<select className={inputStyle} value={productId} onChange={e => setProductId(e.target.value)}>{products.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>)}</select></label>
            <label>כמות<input className={inputStyle} type="number" min="1" max="1000" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}/></label>
            <div className="flex items-end"><button className={btnStyle} type="button" onClick={addProduct}>הוסף להזמנה</button></div>
          </div>
          <p className="text-sm mt-3 text-slate-500">המוצר ״{blocked.name}״ אינו מופיע לבחירה, בדומה לחסימה לסוכנים בלבד.</p>
          <div className="mt-4 space-y-2">{lines.map((l, i) => <div key={i} className="flex justify-between gap-3 rounded-lg bg-slate-50 p-2"><span>{l.name} × {l.qty} ({l.unit})</span><span>{fmt(l.price * l.qty)} <button className="text-red-700 underline mr-3" onClick={() => setLines(a => a.filter((_, j) => j !== i))}>הסר</button></span></div>)}</div>
          <div className="grid gap-3 mt-3 md:grid-cols-3">
            <label>הנחה מדומה (₪)<input className={inputStyle} type="number" min="0" value={discount} onChange={e => setDiscount(Math.max(0, Number(e.target.value) || 0))}/></label>
            <div><p>סכום הזמנה</p><strong>{fmt(totals.sale)}</strong></div>
            <div><p>רווחיות משוערת</p><strong className={totals.margin < 40 ? "text-red-700" : "text-green-700"}>{totals.margin.toFixed(1)}%</strong></div>
          </div>
          {totals.sale > 0 && totals.margin < 40 && <label className="block mt-3 text-amber-800"><input type="checkbox" checked={exception} onChange={e => setException(e.target.checked)}/> סימולציה: מנהל אישר חריגת רווחיות (לא אישור אמיתי)</label>}
          <button type="button" className={btnStyle + " mt-4"} disabled={!lines.length || totals.sale <= 0} onClick={createOrder}>צור הזמנת הדגמה</button>
          {notice && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-blue-950">{notice}</p>}
        </section>
      </> : <section className={baseStyle}>
        <h2 className="text-lg font-bold">פעולות מנהל בהדגמה</h2>
        <p className="text-sm text-slate-600 mb-3">רק כאן ניתן להנפיק חשבונית ולסמן תשלום. הפעולות פיקטיביות.</p>
        {orders.length === 0 && <p>אין הזמנות עדיין. עבור לתצוגת סוכן וצור הזמנה.</p>}
        {orders.map(o => <div key={o.id} className="border-t py-3 flex flex-wrap justify-between items-center gap-3">
          <span>{o.id} · {o.customer} · {fmt(o.amount)} · {o.status}</span>
          <div className="flex gap-2">
            {!o.invoiced && <button className={btnStyle} onClick={() => update(o.id, {invoiced: true, status: "חשבונית הונפקה"})}>הפק חשבונית מדומה</button>}
            {o.invoiced && !o.paid && <button className={btnStyle} onClick={() => update(o.id, {paid: true, status: "שולם והושלם"})}>רשום תשלום מדומה</button>}
          </div>
        </div>)}
      </section>}
      <section className={baseStyle}><h2 className="text-lg font-bold mb-2">ההזמנות שיצרנו בהדגמה</h2>
        {orders.length === 0 ? <p className="text-slate-500">אין הזמנות עדיין.</p> : orders.map(o => <p key={o.id} className="border-b py-2">{o.id} · {o.customer} · {fmt(o.amount)} · {o.status}</p>)}
      </section>
      <p className="text-xs text-slate-500">הערה: שיעור המע״מ והעמלה כאן לצורך המחשה בלבד; החישוב בפועל במערכת הסוכנים נקבע בשרת ובהתאם לחשבונית ולגבייה.</p>
    </div>
  </main>;
}
