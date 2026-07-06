import { useState, useMemo, useCallback, useEffect } from "react";
import { formatWhatsAppMessage } from "@/utils/formatWhatsAppMessage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useNavigate } from "react-router-dom";
import CustomerSelector from "@/components/sales/CustomerSelector";
import ProductGrid from "@/components/sales/ProductGrid";
import QuoteCart from "@/components/sales/QuoteCart";
import CatalogFilters from "@/components/sales/CatalogFilters";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShoppingCart, Maximize2, Minimize2, Star } from "lucide-react";
import { toast } from "sonner";

const LS_FAVORITES = "sales_favorites";
const LS_RECENT = "sales_recent_viewed";
const MAX_RECENT = 10;

function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]")); } catch { return new Set(); }
}
function saveFavorites(set) {
  localStorage.setItem(LS_FAVORITES, JSON.stringify([...set]));
}
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(LS_RECENT) || "[]"); } catch { return []; }
}
function saveRecent(list) {
  localStorage.setItem(LS_RECENT, JSON.stringify(list));
}

export default function SalesCatalog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [step, setStep] = useState("customer");
  const [cartItems, setCartItems] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [fullscreen, setFullscreen] = useState(false);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load recently viewed products after products are fetched
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list("-created_date", 10000),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => base44.entities.Category.list(),
  });
  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => base44.entities.BusinessSettings.list(),
  });
  const businessSettings = settings[0];

  // Load recently viewed product objects after products are fetched
  useEffect(() => {
    if (products.length === 0) return;
    const ids = loadRecent();
    const recentProducts = ids
      .map(id => products.find(p => p.id === id))
      .filter(Boolean)
      .slice(0, MAX_RECENT);
    setRecentlyViewed(recentProducts);
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.is_active) return false;
      if (showFavoritesOnly && !favorites.has(p.id)) return false;
      if (selectedCategory !== "all" && p.category !== selectedCategory && p.category_id !== selectedCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q) ||
          p.tags?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, search, selectedCategory, showFavoritesOnly, favorites]);

  // Favorites toggle
  const toggleFavorite = useCallback((productId) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      saveFavorites(next);
      return next;
    });
  }, []);

  // Track recently viewed
  const handleProductView = useCallback((product) => {
    setRecentlyViewed(prev => {
      const filtered = prev.filter(p => p.id !== product.id);
      const next = [product, ...filtered].slice(0, MAX_RECENT);
      saveRecent(next.map(p => p.id));
      return next;
    });
  }, []);

  // Cart ops
  const addToCart = useCallback((product, qty = 1) => {
    handleProductView(product);
    setCartItems((prev) => {
      const exists = prev.find((i) => i.product_id === product.id);
      if (exists) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + qty, total: (i.quantity + qty) * i.unit_price * (1 - (i.discount || 0) / 100) }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          sku: product.sku || "",
          image_url: product.image_url || "",
          quantity: qty,
          unit_price: product.sell_price || 0,
          buy_price: product.buy_price ?? null,
          unit: product.unit || "יחידה",
          discount: selectedCustomer?.discount_percent || 0,
          total: (product.sell_price || 0) * qty * (1 - (selectedCustomer?.discount_percent || 0) / 100),
        },
      ];
    });
  }, [selectedCustomer, handleProductView]);

  const updateCartItem = useCallback((productId, field, value) => {
    setCartItems((prev) =>
      prev.map((i) => {
        if (i.product_id !== productId) return i;
        const updated = { ...i, [field]: value };
        const qty = parseFloat(updated.quantity) || 0;
        const price = parseFloat(updated.unit_price) || 0;
        const disc = parseFloat(updated.discount) || 0;
        updated.total = qty * price * (1 - disc / 100);
        return updated;
      })
    );
  }, []);

  const removeFromCart = useCallback((productId) => {
    setCartItems((prev) => prev.filter((i) => i.product_id !== productId));
  }, []);

  const cartCount = cartItems.reduce((s, i) => s + (i.quantity || 0), 0);

  const handleCustomerConfirm = (customer) => {
    setSelectedCustomer(customer);
    setStep("catalog");
  };

  const buildQuotePayload = (status, cartData, vat) => {
    // All item totals are NET (before VAT). VAT is added on top.
    const netSubtotal = cartItems.reduce((s, i) => s + (i.total || 0), 0);
    const discountAmount = netSubtotal * ((cartData?.discount || 0) / 100);
    const netAfterDiscount = netSubtotal - discountAmount;
    const vatAmount = netAfterDiscount * (vat / 100);
    const total = netAfterDiscount + vatAmount; // gross total

    return {
      data: {
        quote_number: 0, // set by caller after fresh counter fetch
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        customer_tax_id: selectedCustomer.tax_id || "",
        customer_type: selectedCustomer.customer_type || "פרטי",
        date: new Date().toISOString().split("T")[0],
        valid_until: cartData?.validUntil || null,
        items: cartItems,
        subtotal: netAfterDiscount,
        discount_amount: discountAmount, // net discount
        vat_rate: vat,
        vat_amount: vatAmount,
        total,
        notes: cartData?.notes || "",
        customer_notes: cartData?.customerNotes || "",
        delivery_notes: cartData?.deliveryNotes || "",
        status,
      },
      total,
    };
  };

  const handleSaveQuote = async (status = "טיוטה", cartData = {}) => {
    if (!selectedCustomer) { toast.error("יש לבחור לקוח"); return; }
    if (cartItems.length === 0) { toast.error("הסל ריק"); return; }
    if (saving) return;
    setSaving(true);
    try {
      const freshSettings = await base44.entities.BusinessSettings.list();
      const fresh = freshSettings[0] || businessSettings;
      const vat = fresh?.vat_rate || businessSettings?.vat_rate || 17;
      const { data: quoteNum } = await supabase.rpc('get_next_quote_number');
      const { data } = buildQuotePayload(status, cartData, vat);
      data.quote_number = quoteNum;
      let quote = await base44.entities.Quote.create(data);
      if (!quote?.id) {
        const found = await base44.entities.Quote.filter({ quote_number: quoteNum });
        quote = found[0];
      }
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast.success(`הצעת מחיר #${quoteNum} נוצרה`);
      navigate(`/quotes/edit?id=${quote?.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateOrder = async (cartData = {}) => {
    if (!selectedCustomer) { toast.error("יש לבחור לקוח"); return; }
    if (cartItems.length === 0) { toast.error("הסל ריק"); return; }
    if (saving) return;
    setSaving(true);
    try {
      const freshSettings = await base44.entities.BusinessSettings.list();
      const fresh = freshSettings[0] || businessSettings;
      const vat = fresh?.vat_rate || businessSettings?.vat_rate || 17;
      const [{ data: quoteNum }, { data: orderNum }] = await Promise.all([
        supabase.rpc('get_next_quote_number'),
        supabase.rpc('get_next_order_number'),
      ]);
      const { data: quoteData, total } = buildQuotePayload("הומרה להזמנה", cartData, vat);
      quoteData.quote_number = quoteNum;
      const quote = await base44.entities.Quote.create(quoteData);
      await base44.entities.Order.create({
        order_number: orderNum,
        quote_id: quote.id,
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        customer_tax_id: selectedCustomer.tax_id || "",
        customer_type: selectedCustomer.customer_type || "פרטי",
        date: new Date().toISOString().split("T")[0],
        delivery_address: selectedCustomer.address || "",
        items: cartItems,
        subtotal: quoteData.subtotal,
        vat_rate: vat,
        vat_amount: quoteData.vat_amount,
        total,
        notes: cartData?.deliveryNotes || cartData?.notes || "",
        status: "ממתין לאישור",
      });

      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("הזמנה נוצרה בהצלחה");
      navigate("/orders");
    } finally {
      setSaving(false);
    }
  };

  const handleWhatsApp = async (cartData, total) => {
    if (!selectedCustomer) { toast.error("יש לבחור לקוח"); return; }
    if (cartItems.length === 0) { toast.error("הסל ריק"); return; }

    // WhatsApp phone validation
    const phone = selectedCustomer?.mobile || selectedCustomer?.phone || "";
    if (!phone.trim()) {
      toast.error("ללקוח אין מספר טלפון. עדכן את פרטי הלקוח ונסה שוב.", { duration: 5000 });
      return;
    }

    if (saving) return;
    setSaving(true);
    try {
      const freshSettings = await base44.entities.BusinessSettings.list();
      const fresh = freshSettings[0] || businessSettings;
      const vat = fresh?.vat_rate || businessSettings?.vat_rate || 17;
      const { data: quoteNum } = await supabase.rpc('get_next_quote_number');
      const { data, total: grossTotal } = buildQuotePayload("טיוטה", cartData, vat);
      data.quote_number = quoteNum;
      let quote = await base44.entities.Quote.create(data);
      console.log("[WhatsApp] quote after create:", JSON.stringify(quote));
      if (!quote?.id) {
        const found = await base44.entities.Quote.filter({ quote_number: quoteNum });
        quote = found[0];
        console.log("[WhatsApp] refetched quote:", JSON.stringify(quote));
      }
      queryClient.invalidateQueries({ queryKey: ["quotes"] });

      const isBusiness = selectedCustomer?.customer_type === "עסקי";
      const businessName = fresh?.business_name || businessSettings?.business_name || "ERP Pro";
      const vatFactor = 1 + vat / 100;
      const priceLabel = isBusiness
        ? `סה״כ לפני מע״מ: ₪${(grossTotal / vatFactor).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nמע״מ: ₪${(grossTotal - grossTotal / vatFactor).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nסה״כ כולל מע״מ: ₪${grossTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `סה״כ לתשלום: ₪${grossTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const validLine = cartData?.validUntil ? `\nתוקף עד: ${cartData.validUntil}` : "";
      const notesLine = cartData?.customerNotes ? `\n\n${cartData.customerNotes}` : "";
      const pdfLink = `${window.location.origin}/quote-pdf/${quote.id}`;
      const msg = formatWhatsAppMessage(fresh?.whatsapp_template || businessSettings?.whatsapp_template, { name: selectedCustomer?.name, number: counter, amount: grossTotal.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), docType: "הצעת מחיר" });
      const cleaned = phone.replace(/\D/g, "");
      const intlPhone = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
      window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
      toast.success(`הצעת מחיר #${counter} נשמרה ונשלחה`);
      navigate(`/quotes/edit?id=${quote.id}`);
    } finally {
      setSaving(false);
    }
  };

  if (step === "customer") {
    return <CustomerSelector onConfirm={handleCustomerConfirm} onBack={() => navigate("/quotes")} />;
  }

  // OLD: return (<div className={`flex flex-col bg-background ${fullscreen ? ...}`} style={...}>
  return (
    <div
      className={`flex flex-col ${fullscreen ? "fixed inset-0 z-40" : "flex-1 min-h-0 h-full"}`}
      style={{ ...(fullscreen ? {} : { height: "calc(100vh - 56px)" }), background: "var(--heillo-bg-gradient)", fontFamily: "'Heebo', sans-serif" }}
      dir="rtl"
    >
      {/* ── Top bar ── */}
      {/* OLD: <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border shrink-0 gap-3"> */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "transparent", paddingBottom: "16px", borderRadius: "0 0 16px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", flexShrink: 0, gap: 12, fontFamily: "'Heebo', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Button variant="ghost" size="sm" onClick={() => setStep("customer")} style={{ flexShrink: 0 }}>
            <ArrowRight className="w-4 h-4 ml-1" /> <span className="hidden sm:inline">החלף לקוח</span>
          </Button>
          <div className="hidden sm:block" style={{ height: 20, width: 1, background: "rgba(0,0,0,0.08)" }} />
          {/* OLD: <div className="text-sm min-w-0"><span className="text-muted-foreground ...">לקוח: </span><span className="font-semibold truncate">...</span> */}
          <div style={{ fontSize: 13, minWidth: 0 }}>
            <span className="hidden sm:inline" style={{ color: "var(--heillo-text-muted)" }}>לקוח: </span>
            <span style={{ fontWeight: 700, color: "var(--heillo-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCustomer?.name}</span>
            {selectedCustomer?.discount_percent > 0 && (
              /* OLD: <span className="mr-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"> */
              <span style={{ marginRight: 8, fontSize: 11, fontWeight: 600, background: "var(--heillo-accent-light)", color: "var(--heillo-accent)", padding: "2px 8px", borderRadius: 99 }}>
                הנחה {selectedCustomer.discount_percent}%
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Favorites toggle */}
          {/* OLD: <button className={`p-2 rounded-lg border transition-all ${showFavoritesOnly ? "bg-red-50 border-red-200 text-red-600" : "border-border text-muted-foreground ...}`}> */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            title="מועדפים"
            style={{
              padding: 8, borderRadius: 10, border: "1px solid", transition: "all 0.2s ease", cursor: "pointer", display: "flex", alignItems: "center",
              background: showFavoritesOnly ? "rgba(239,68,68,0.06)" : "transparent",
              borderColor: showFavoritesOnly ? "rgba(239,68,68,0.3)" : "rgba(0,0,0,0.08)",
              color: showFavoritesOnly ? "#dc2626" : "var(--heillo-text-muted)",
            }}
          >
            <Star style={{ width: 16, height: 16, fill: showFavoritesOnly ? "currentColor" : "none" }} />
          </button>

          {/* Fullscreen */}
          {/* OLD: <button className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all hidden md:block"> */}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            title="מסך מלא"
            className="hidden md:flex"
            style={{ padding: 8, borderRadius: 10, border: "1px solid rgba(0,0,0,0.08)", background: "transparent", cursor: "pointer", color: "var(--heillo-text-muted)", alignItems: "center", transition: "all 0.2s ease" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.04)"; e.currentTarget.style.color = "var(--heillo-text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--heillo-text-muted)"; }}
          >
            {fullscreen ? <Minimize2 style={{ width: 16, height: 16 }} /> : <Maximize2 style={{ width: 16, height: 16 }} />}
          </button>

          <span className="hidden sm:block" style={{ fontSize: 12, color: "var(--heillo-text-muted)" }}>{filteredProducts.length} מוצרים</span>

          {/* Cart button */}
          {/* OLD: <Button variant={cartItems.length > 0 ? "default" : "outline"} size="sm" ... className="relative"> */}
          <button
            onClick={() => {
              if (cartItems.length === 0) { toast.info("הסל ריק – הוסף מוצרים"); return; }
              setCartOpen(true);
            }}
            style={{
              position: "relative", display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
              border: "none", cursor: "pointer", fontFamily: "'Heebo', sans-serif",
              background: cartItems.length > 0 ? "var(--heillo-accent)" : "rgba(0,0,0,0.06)",
              color: cartItems.length > 0 ? "#FFFFFF" : "var(--heillo-text-primary)",
              transition: "all 0.2s ease",
            }}
          >
            <ShoppingCart style={{ width: 16, height: 16 }} />
            <span className="hidden sm:inline">סל</span>
            {cartCount > 0 && (
              <span style={{ position: "absolute", top: -6, left: -6, background: "#ef4444", color: "#fff", fontSize: 10, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filters (unchanged) */}
      <CatalogFilters
        search={search}
        onSearch={setSearch}
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
      />

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Product grid */}
        {/* OLD: <div className="flex-1 overflow-y-auto p-4"> */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <ProductGrid
            products={filteredProducts}
            cartItems={cartItems}
            onAdd={addToCart}
            loading={loadingProducts}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            recentlyViewed={recentlyViewed}
            searchActive={!!search || selectedCategory !== "all" || showFavoritesOnly}
          />
        </div>

        {/* Desktop cart panel */}
        {/* OLD: <div className="hidden xl:flex w-96 border-r border-border bg-card overflow-hidden flex-col shrink-0"> */}
        <div className="hidden xl:flex" style={{ width: 384, borderRight: "1px solid rgba(0,0,0,0.05)", background: "#FFFFFF", overflow: "hidden", flexDirection: "column", flexShrink: 0 }}>
          <QuoteCart
            items={cartItems}
            customer={selectedCustomer}
            businessSettings={businessSettings}
            onUpdate={updateCartItem}
            onRemove={removeFromCart}
            onSaveQuote={handleSaveQuote}
            onCreateOrder={handleCreateOrder}
            onWhatsApp={handleWhatsApp}
            saving={saving}
            embedded
          />
        </div>
      </div>

      {/* Mobile cart drawer */}
      {cartOpen && (
        /* OLD: <div className="xl:hidden fixed inset-0 z-50 flex flex-col bg-background"> */
        <div className="xl:hidden" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--heillo-bg-gradient)", fontFamily: "'Heebo', sans-serif" }}>
          {/* OLD: <div className="flex items-center justify-between p-4 border-b border-border"> */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "#FFFFFF", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: "var(--heillo-text-primary)", margin: 0 }}>סל הזמנה</h2>
            <Button variant="ghost" size="sm" onClick={() => setCartOpen(false)}>סגור</Button>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <QuoteCart
              items={cartItems}
              customer={selectedCustomer}
              businessSettings={businessSettings}
              onUpdate={updateCartItem}
              onRemove={removeFromCart}
              onSaveQuote={(s, d) => { setCartOpen(false); handleSaveQuote(s, d); }}
              onCreateOrder={(d) => { setCartOpen(false); handleCreateOrder(d); }}
              onWhatsApp={handleWhatsApp}
              saving={saving}
              embedded
            />
          </div>
        </div>
      )}
    </div>
  );
}