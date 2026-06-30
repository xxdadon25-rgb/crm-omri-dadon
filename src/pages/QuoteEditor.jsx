import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Save, ClipboardList, TrendingUp } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import ItemsEditor from "@/components/documents/ItemsEditor";
import DocumentTotals from "@/components/documents/DocumentTotals";
import DocumentActions from "@/components/documents/DocumentActions";
import ProfitabilityModal from "@/components/documents/ProfitabilityModal";
import ProfitabilityAccessDialog from "@/components/documents/ProfitabilityAccessDialog";
import { toast } from "sonner";

const STATUSES = ["טיוטה", "נשלח", "אושר", "נדחה", "פגה תוקף", "הומרה להזמנה", "הומרה לחשבונית"];

export default function QuoteEditor() {
  const urlParams = new URLSearchParams(window.location.search);
  const quoteId = urlParams.get("id");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const result = await base44.entities.Customer.list("-created_date");
      const pending = sessionStorage.getItem("pendingCustomer");
      if (!pending) return result;
      const pendingCustomer = JSON.parse(pending);
      if (result.some(c => c.id === pendingCustomer.id)) {
        const ageMs = Date.now() - new Date(pendingCustomer.created_date).getTime();
        if (ageMs >= 180000) {
          sessionStorage.removeItem("pendingCustomer");
        }
        return result;
      }
      return [pendingCustomer, ...result];
    },
  });
  const { data: settings = [] } = useQuery({ queryKey: ["settings"], queryFn: () => base44.entities.BusinessSettings.list() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => base44.entities.Category.list() });
  const businessSettings = settings[0];

  const [form, setForm] = useState({
    customer_id: "", customer_name: "", customer_type: "פרטי",
    date: new Date().toISOString().split("T")[0],
    valid_until: "",
    items: [],
    notes: "",
    customer_notes: "",
    internal_notes: "",
    agent_notes: "",
    delivery_notes: "",
    status: "טיוטה",
    vat_rate: 18,
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [profitabilityModalOpen, setProfitabilityModalOpen] = useState(false);

  useEffect(() => {
    if (quoteId && !loaded) {
      base44.entities.Quote.filter({ id: quoteId }, null, 1).then(results => {
        const q = results[0];
        if (q) { setForm({ ...q, vat_rate: q.vat_rate || 17 }); setLoaded(true); }
      }).catch(() => {
        // Fallback to list scan if filter by id is unsupported
        base44.entities.Quote.list().then(quotes => {
          const q = quotes.find(x => x.id === quoteId);
          if (q) { setForm({ ...q, vat_rate: q.vat_rate || 17 }); setLoaded(true); }
        });
      });
    }
  }, [quoteId, loaded]);

  useEffect(() => {
    if (!quoteId) {
      setForm(prev => ({ ...prev, vat_rate: businessSettings?.vat_rate || 18 }));
    }
  }, [businessSettings, quoteId]);

  // NET-FIRST: all item totals are before VAT.
  // subtotal = net sum of line totals
  // vatAmount = subtotal × vatRate/100
  // total = subtotal + vatAmount (gross)
  const vatRate = form.vat_rate || 18;
  const subtotal = useMemo(() => form.items.reduce((s, i) => s + (i.total || 0), 0), [form.items]);
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const selectedCustomer = customers.find(c => c.id === form.customer_id);
  const isBusiness = form.customer_type === "עסקי" || selectedCustomer?.customer_type === "עסקי";

  // Profitability — prices are already net (before VAT)
  const totalCostNet = useMemo(() => {
    return form.items.reduce((s, i) => {
      return s + ((i.buy_price || 0) * (i.quantity || 0));
    }, 0);
  }, [form.items]);
  
  const totalSalesNet = subtotal; // already net (before VAT)
  const totalProfit = totalSalesNet - totalCostNet;
  const profitMargin = totalCostNet > 0 ? (totalProfit / totalCostNet) * 100 : 0;
  const itemCount = form.items.reduce((s, i) => s + (i.quantity || 0), 0);
  const avgProfitPerItem = itemCount > 0 ? totalProfit / itemCount : 0;
  const hasCostData = form.items.some(i => i.buy_price !== undefined && i.buy_price !== null && i.buy_price !== "");

  const handleProfitabilityClick = () => {
    setAccessCodeOpen(true);
  };

  const handleAccessCodeSuccess = () => {
    setAccessCodeOpen(false);
    setProfitabilityModalOpen(true);
  };

  const handleCustomerChange = (id) => {
    const c = customers.find(x => x.id === id);
    if (c?.is_blocked) toast.warning("⚠️ לקוח זה מסומן כחסום");
    setForm(prev => ({ ...prev, customer_id: id, customer_name: c?.name || "", customer_type: c?.customer_type || "פרטי" }));
  };

  const handleSave = async () => {
    console.log("[SAVE] handleSave called, customer_id:", form.customer_id);
    if (!form.customer_id) { toast.error("יש לבחור לקוח"); return; }
    setSaving(true);
    console.log("[SAVE] setSaving(true), quoteId:", quoteId);
    try {
      const data = { ...form, subtotal, vat_amount: vatAmount, total };
      ['date', 'valid_until'].forEach(f => { if (!data[f]) data[f] = null; });
      console.log("[SAVE] data to save:", data);
      if (quoteId) {
        console.log("[SAVE] updating existing quote:", quoteId);
        const updated = await base44.entities.Quote.update(quoteId, data);
        console.log("[SAVE] update result:", updated);
        queryClient.setQueryData(["quotes"], (old = []) => old.map(q => q.id === quoteId ? updated : q));
        toast.success("הצעת מחיר עודכנה");
      } else {
        const counter = (businessSettings?.quote_counter || 1000) + 1;
        data.quote_number = counter;
        console.log("[SAVE] creating new quote, counter:", counter);
        const created = await base44.entities.Quote.create(data);
        console.log("[SAVE] create result:", created);
        if (businessSettings?.id) {
          await base44.entities.BusinessSettings.update(businessSettings.id, { quote_counter: counter });
          queryClient.invalidateQueries({ queryKey: ["settings"] });
        }
        queryClient.setQueryData(["quotes"], (old = []) => [created, ...(Array.isArray(old) ? old : [])]);
        toast.success("הצעת מחיר נוצרה");
      }
      console.log("[SAVE] navigating to /quotes");
      navigate("/quotes");
    } catch (err) {
      console.error("[SAVE] caught error:", err);
      toast.error("שגיאה בשמירת הצעת המחיר: " + (err?.message || JSON.stringify(err)));
    } finally {
      setSaving(false);
      console.log("[SAVE] finally block done");
    }
  };

  const handleConvertToOrder = async () => {
    if (!quoteId) return;
    setSaving(true);
    // Save latest state first
    await base44.entities.Quote.update(quoteId, { ...form, subtotal, vat_amount: vatAmount, total });
    const customer = customers.find(c => c.id === form.customer_id);
    const counter = (businessSettings?.order_counter || 1000) + 1;
    const orderData = {
      order_number: counter,
      quote_id: quoteId,
      customer_id: form.customer_id,
      customer_name: form.customer_name,
      customer_tax_id: customer?.tax_id || "",
      date: new Date().toISOString().split("T")[0],
      delivery_address: customer?.address || "",
      items: form.items,
      subtotal, vat_rate: form.vat_rate, vat_amount: vatAmount, total,
      notes: form.delivery_notes || form.notes,
      status: "ממתין לאישור",
    };
    const order = await base44.entities.Order.create(orderData);
    queryClient.setQueryData(["orders"], (old = []) => {
      const exists = old.some(o => o.id === order.id);
      return exists ? old : [order, ...old];
    });
    sessionStorage.setItem("pendingOrder", JSON.stringify(order));

    if (businessSettings?.id) {
      await base44.entities.BusinessSettings.update(businessSettings.id, { order_counter: counter });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
    // Store order link in quote
    await base44.entities.Quote.update(quoteId, { status: "הומרה להזמנה", order_id: order.id, order_number: counter });
    queryClient.setQueryData(["quotes"], (old = []) =>
      old.map(q => q.id === quoteId ? { ...q, status: "הומרה להזמנה", order_id: order.id, order_number: counter } : q)
    );
    setForm(prev => ({ ...prev, status: "הומרה להזמנה", order_id: order.id, order_number: counter }));

    setSaving(false);
    toast.success("הזמנה נוצרה בהצלחה");
    navigate("/orders");
  };

  const handleWhatsApp = () => {
    const phone = selectedCustomer?.mobile || selectedCustomer?.phone || "";
    if (!phone.trim()) { toast.error("ללקוח אין מספר טלפון. עדכן את פרטי הלקוח ונסה שוב."); return; }
    const businessName = businessSettings?.business_name || "ERP Pro";
    const priceLabel = `סה״כ לפני מע״מ: ₪${subtotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nמע״מ (${vatRate}%): ₪${vatAmount.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nסה״כ כולל מע״מ: ₪${total.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const msg = `שלום ${form.customer_name},\n\nהצעת מחיר #${form.quote_number} מ${businessName}\n\n${priceLabel}\n\nתוקף עד: ${form.valid_until || "---"}\n\n${form.customer_notes ? "הערות: " + form.customer_notes : ""}`;
    const cleaned = phone.replace(/\D/g, "");
    const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div>
      <PageHeader title={quoteId ? `עריכת הצעת מחיר ${form.quote_number ? `#${form.quote_number}` : ""}` : "הצעת מחיר חדשה"}>
        <Button variant="ghost" size="sm" onClick={() => navigate("/quotes")}>
          <ArrowRight className="w-4 h-4 ml-1" /> חזרה
        </Button>
      </PageHeader>

      <div className="space-y-5">
        {/* Header fields */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>לקוח *</Label>
              <Select value={form.customer_id} onValueChange={handleCustomerChange}>
                <SelectTrigger><SelectValue placeholder="בחר לקוח" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.customer_type === "עסקי" ? "🏢" : "👤"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.customer_id && (
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mt-1 ${isBusiness ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                  {isBusiness ? "לקוח עסקי" : "לקוח פרטי"}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>תאריך</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>תוקף עד</Label>
              <Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>מע״מ %</Label>
              <Input type="number" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>סטטוס</Label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-card rounded-xl border border-border p-5">
          <ItemsEditor
            items={form.items}
            setItems={(items) => setForm({ ...form, items })}
            products={products}
            customerType={form.customer_type}
            vatRate={vatRate}
            categories={categories}
          />
          <div className="mt-4">
            <DocumentTotals
              netSubtotal={subtotal}
              vatRate={vatRate}
              total={total}
              discountAmount={form.discount_amount || 0}
            />
          </div>
        </div>



        {/* Notes section */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wide">הערות ופרטים נוספים</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>הערות ללקוח <span className="text-xs text-muted-foreground">(יופיעו בהצעה)</span></Label>
              <Textarea value={form.customer_notes || ""} onChange={(e) => setForm({ ...form, customer_notes: e.target.value })} rows={3} placeholder="תנאי תשלום, ערבויות, תנאים נוספים..." />
            </div>
            <div className="space-y-1.5">
              <Label>הוראות משלוח</Label>
              <Textarea value={form.delivery_notes || ""} onChange={(e) => setForm({ ...form, delivery_notes: e.target.value })} rows={3} placeholder="כתובת משלוח, זמן אספקה, הנחיות..." />
            </div>
            <div className="space-y-1.5">
              <Label>הערות פנימיות <span className="text-xs text-muted-foreground">(לא יופיעו בהצעה)</span></Label>
              <Textarea value={form.internal_notes || ""} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} rows={2} placeholder="הערות פנימיות למשרד..." />
            </div>
            <div className="space-y-1.5">
              <Label>הערות סוכן מכירות</Label>
              <Textarea value={form.agent_notes || ""} onChange={(e) => setForm({ ...form, agent_notes: e.target.value })} rows={2} placeholder="הערות אישיות של הסוכן..." />
            </div>
          </div>
        </div>

        {/* Linked Order Status */}
        {quoteId && form.status === "הומרה להזמנה" && form.order_number && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            הומרה להזמנה #{form.order_number}
          </div>
        )}

        {/* Actions */}
        <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between flex-wrap gap-3">
          {quoteId && form.quote_number && (
            <DocumentActions
              type="quote"
              doc={{ ...form, subtotal, vat_amount: vatAmount, total }}
              businessSettings={businessSettings}
              customerPhone={selectedCustomer?.phone}
              customerEmail={selectedCustomer?.email}
            />
          )}
          <div className="flex gap-2 mr-auto flex-wrap">
            {quoteId && form.status === "הומרה להזמנה" && form.order_id && (
              <Button
                variant="outline"
                onClick={() => navigate(`/orders`)}
                className="border-green-200 text-green-700 hover:bg-green-50"
              >
                <ClipboardList className="w-4 h-4 ml-1" /> פתח הזמנה #{form.order_number}
              </Button>
            )}
            {quoteId && form.status !== "הומרה להזמנה" && (
              <Button
                variant="outline"
                onClick={handleConvertToOrder}
                disabled={saving}
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <ClipboardList className="w-4 h-4 ml-1" /> הפוך להזמנה
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 ml-1" /> {saving ? "שומר..." : "שמירה"}
            </Button>
            {hasCostData && (
              <Button
                variant="outline"
                onClick={handleProfitabilityClick}
                className="border-green-200 text-green-700 hover:bg-green-50"
              >
                <TrendingUp className="w-4 h-4 ml-1" /> 📊 רווחיות
              </Button>
            )}
          </div>
        </div>

        {/* Access Code Dialog */}
        <ProfitabilityAccessDialog
          open={accessCodeOpen}
          onOpenChange={setAccessCodeOpen}
          correctCode={businessSettings?.profitability_access_code || "1234"}
          onSuccess={handleAccessCodeSuccess}
        />

        {/* Profitability Modal */}
        <ProfitabilityModal
          open={profitabilityModalOpen}
          onOpenChange={setProfitabilityModalOpen}
          totalCostNet={totalCostNet}
          totalSalesNet={totalSalesNet}
          totalProfit={totalProfit}
          profitMargin={profitMargin}
          itemCount={itemCount}
          avgProfitPerItem={avgProfitPerItem}
        />
      </div>
    </div>
  );
}