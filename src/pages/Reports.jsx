// Reports page
import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Users, Package, DollarSign, Download, BarChart3, FileText, Loader2 } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear, endOfDay } from "date-fns";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const COLORS = ["hsl(48,96%,53%)", "hsl(200,60%,50%)", "hsl(150,50%,45%)", "hsl(280,60%,55%)"];
const STATUS_FILTER_OPTIONS = ["ממתין לאישור", "אושר", "בהכנה", "הושלם", "בוטל"];

export default function Reports() {
  const [dateRange, setDateRange] = useState("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: () => base44.entities.Order.list("-created_date") });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list("-created_date") });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => base44.entities.Customer.list("-created_date") });
  const { data: businessSettingsList = [] } = useQuery({ queryKey: ["businessSettings"], queryFn: () => base44.entities.BusinessSettings.list() });
  const businessSettings = businessSettingsList?.[0];

  // Helper to get date range
  const getDateRange = () => {
    const now = new Date();
    let start, end = endOfDay(now);

    switch (dateRange) {
      case "today":
        start = startOfDay(now);
        break;
      case "week":
        start = startOfWeek(now, { weekStartsOn: 0 });
        break;
      case "month":
        start = startOfMonth(now);
        break;
      case "year":
        start = startOfYear(now);
        break;
      case "custom":
        start = customStart ? new Date(customStart) : startOfMonth(now);
        end = customEnd ? new Date(customEnd) : endOfDay(now);
        break;
      default:
        start = startOfMonth(now);
    }

    return { start, end };
  };

  const { start: dateStart, end: dateEnd } = getDateRange();

  // Filter orders by date and status
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (!order.date) return false;
      const orderDate = new Date(order.date);
      const inDateRange = orderDate >= dateStart && orderDate <= dateEnd;
      const hasStatus = statusFilter === "all" || statusFilter === order.status;
      return inDateRange && hasStatus;
    });
  }, [orders, dateStart, dateEnd, statusFilter]);

  // Sales Summary
  const salesToday = useMemo(() => {
    const today = startOfDay(new Date());
    return orders
      .filter((o) => {
        if (!o.date) return false;
        const d = new Date(o.date);
        return d >= today && d <= endOfDay(new Date()) && (statusFilter === "all" || statusFilter === o.status);
      })
      .reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  }, [orders, statusFilter]);

  const salesMonth = useMemo(() => {
    const start = startOfMonth(new Date());
    return orders
      .filter((o) => {
        if (!o.date) return false;
        const d = new Date(o.date);
        return d >= start && (statusFilter === "all" || statusFilter === o.status);
      })
      .reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  }, [orders, statusFilter]);

  const salesYear = useMemo(() => {
    const start = startOfYear(new Date());
    return orders
      .filter((o) => {
        if (!o.date) return false;
        const d = new Date(o.date);
        return d >= start && (statusFilter === "all" || statusFilter === o.status);
      })
      .reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  }, [orders, statusFilter]);

  const totalOrders = filteredOrders.length;
  const avgPerOrder = totalOrders > 0 ? filteredOrders.reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0) / totalOrders : 0;

  // Profitability Summary (NET prices before VAT)
  const profitability = useMemo(() => {
    let totalSales = 0;
    let totalCost = 0;

    filteredOrders.forEach((order) => {
      totalSales += order.subtotal || order.total || 0;

      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          if (!item || item.is_header) return;
          const buyPrice = item.buy_price != null ? Number(item.buy_price) : (products.find((p) => p.id === item.product_id)?.buy_price || 0);
          totalCost += (isNaN(buyPrice) ? 0 : buyPrice) * (item.quantity || 0);
        });
      }
    });

    const profit = totalSales - totalCost;
    const profitMargin = totalSales > 0 ? (profit / totalSales) * 100 : 0;

    return { totalSales, totalCost, profit, profitMargin };
  }, [filteredOrders, products]);

  // Top Products
  const topProducts = useMemo(() => {
    const productMap = {};

    filteredOrders.forEach((order) => {
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          if (!item || item.is_header || !item.name) return;
          const key = item.product_id || item.name;
          if (!productMap[key]) {
            productMap[key] = { id: key, name: String(item.name), quantity: 0, sales: 0, profit: 0 };
          }
          const qty = item.quantity || 0;
          const itemSales = item.total || 0;
          const buyPrice = item.buy_price != null ? Number(item.buy_price) : (products.find((p) => p.id === item.product_id)?.buy_price || 0);
          productMap[key].quantity += qty;
          productMap[key].sales += itemSales;
          productMap[key].profit += itemSales - (isNaN(buyPrice) ? 0 : buyPrice) * qty;
        });
      }
    });

    return Object.values(productMap).sort((a, b) => b.sales - a.sales).slice(0, 5);
  }, [filteredOrders, products]);

  // Top Customers
  const topCustomers = useMemo(() => {
    const customerMap = {};

    filteredOrders.forEach((order) => {
      if (!customerMap[order.customer_id]) {
        customerMap[order.customer_id] = {
          id: order.customer_id,
          name: order.customer_name,
          orders: 0,
          total: 0,
          profit: 0,
        };
      }
      customerMap[order.customer_id].orders += 1;
      customerMap[order.customer_id].total += order.subtotal || order.total || 0;

      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          if (!item || item.is_header) return;
          const qty = item.quantity || 0;
          const itemSales = item.total || 0;
          const buyPrice = item.buy_price != null ? Number(item.buy_price) : (products.find((p) => p.id === item.product_id)?.buy_price || 0);
          customerMap[order.customer_id].profit += itemSales - (isNaN(buyPrice) ? 0 : buyPrice) * qty;
        });
      }
    });

    return Object.values(customerMap).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filteredOrders, products]);

  // Monthly data
  const monthlyData = useMemo(() => {
    const months = {};
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = format(d, "yyyy-MM");
      months[key] = { sales: 0, profit: 0, month: format(d, "MMM") };
    }

    orders
      .filter((o) => statusFilter === "all" || statusFilter === o.status)
      .forEach((order) => {
        if (!order.date) return;
        const key = order.date.slice(0, 7);
        if (months[key]) {
          months[key].sales += order.subtotal || order.total || 0;

          if (Array.isArray(order.items)) {
            order.items.forEach((item) => {
              if (!item || item.is_header) return;
              const qty = item.quantity || 0;
              const itemSales = item.total || 0;
              const buyPrice = item.buy_price != null ? Number(item.buy_price) : (products.find((p) => p.id === item.product_id)?.buy_price || 0);
              months[key].profit += itemSales - (isNaN(buyPrice) ? 0 : buyPrice) * qty;
            });
          }
        }
      });

    return Object.values(months);
  }, [orders, products, statusFilter]);

  // Top Products Chart
  const topProductsChart = topProducts.slice(0, 5).map((p) => ({
    name: (p.name || "").slice(0, 15),
    sales: p.sales,
    profit: p.profit,
  }));

  // Export to CSV with clean tabular structure
  const exportExcel = () => {
    const BOM = "\uFEFF";
    let csv = "";

    // Helper to add section
    const addSection = (title, headers, rows) => {
      csv += `${title}\n`;
      csv += headers.map(h => `"${h}"`).join(",") + "\n";
      rows.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(",") + "\n";
      });
      csv += "\n";
    };

    // Section 1: Sales Summary
    addSection(
      "סיכום מכירות",
      ["מטריקה", "ערך"],
      [
        ["סך הכל מכירות", `₪${profitability.totalSales.toLocaleString()}`],
        ["מכירות היום", `₪${salesToday.toLocaleString()}`],
        ["מכירות החודש", `₪${salesMonth.toLocaleString()}`],
        ["מכירות השנה", `₪${salesYear.toLocaleString()}`],
      ]
    );

    // Section 2: Profitability Summary
    addSection(
      "סיכום רווחיות",
      ["מטריקה", "ערך"],
      [
        ["עלות כוללת", `₪${profitability.totalCost.toLocaleString()}`],
        ["רווח גולמי", `₪${profitability.profit.toLocaleString()}`],
        ["שיעור רווחיות", `${profitability.profitMargin.toFixed(2)}%`],
      ]
    );

    // Section 3: Top Products
    addSection(
      "מוצרים מובילים",
      ["מוצר", "כמות", "מכירות", "רווח"],
      topProducts.map(p => [p.name, String(p.quantity), `₪${p.sales.toLocaleString()}`, `₪${p.profit.toLocaleString()}`])
    );

    // Section 4: Top Customers
    addSection(
      "לקוחות מובילים",
      ["לקוח", "הזמנות", "סה״כ רכישות", "רווח"],
      topCustomers.map(c => [c.name, String(c.orders), `₪${c.total.toLocaleString()}`, `₪${c.profit.toLocaleString()}`])
    );

    // Add metadata at the end
    csv += "מטא-דאטה,\n";
    csv += `"תאריך יצוא","${format(new Date(), "dd/MM/yyyy HH:mm")}"\n`;
    csv += `"טווח דוח","${dateRange === "custom" ? `${customStart} עד ${customEnd}` : dateRange}"\n`;
    csv += `"סטטוסים","${statusFilter === "all" ? "הכל" : statusFilter}"\n`;

    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `דוח_מכירות_${format(new Date(), "dd-MM-yyyy")}.csv`;
    link.click();
  };

  const [generatingPDF, setGeneratingPDF] = useState(false);
  const reportRef = useRef(null);

  // Export to PDF using html2canvas (proven method)
  const exportPDF = async () => {
    if (!reportRef.current) return;
    setGeneratingPDF(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        allowTaint: true,
      });

      const PDF_W = 210;
      const PDF_H = 297;
      const pxPerMm = canvas.width / PDF_W;
      const pageHeightPx = PDF_H * pxPerMm;
      const totalPages = Math.ceil(canvas.height / pageHeightPx);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();
        const srcY = page * pageHeightPx;
        const srcH = Math.min(pageHeightPx, canvas.height - srcY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = srcH;
        pageCanvas.getContext("2d").drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
        pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, PDF_W, srcH / pxPerMm);
      }

      pdf.save(`דוח_מכירות_${format(new Date(), "dd-MM-yyyy")}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setGeneratingPDF(false);
    }
  };

  const stats = [
    { label: "מכירות היום", value: `₪${salesToday.toLocaleString()}`, icon: DollarSign },
    { label: "מכירות החודש", value: `₪${salesMonth.toLocaleString()}`, icon: TrendingUp },
    { label: "מכירות השנה", value: `₪${salesYear.toLocaleString()}`, icon: Package },
    { label: "ממוצע להזמנה", value: `₪${avgPerOrder.toLocaleString()}`, icon: Users },
  ];

  return (
    <>
      {/* Hidden PDF render element — position:fixed so layout-neutral, lives outside scroll container */}
      <div
        ref={reportRef}
        style={{
          position: "fixed",
          top: "-9999px",
          left: "-9999px",
          width: "794px",
          background: "#ffffff",
          padding: "0",
          direction: "rtl",
          fontFamily: "'Heebo', Arial, sans-serif",
          color: "#1a1a1a",
          zIndex: -1,
        }}
      >
        {/* Header Section */}
        <div style={{ background: "linear-gradient(135deg, #f9d923 0%, #ffd700 100%)", padding: "30px 30px 20px", borderBottom: "3px solid #d4af37" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "15px" }}>
            <div>
              <h1 style={{ fontSize: "32px", fontWeight: "bold", color: "#1a1a1a", margin: "0 0 5px 0" }}>דוח מכירות ורווחיות</h1>
              <p style={{ fontSize: "12px", color: "#555", margin: "0" }}>דוח ניהול עסקי משכלל</p>
            </div>
          </div>
        </div>

        {/* Company & Report Info */}
        <div style={{ padding: "25px 30px", borderBottom: "1px solid #e0e0e0", background: "#f9f9f9" }}>
          <table style={{ width: "100%", fontSize: "11px", lineHeight: "1.6" }}>
            <tbody>
              <tr>
                <td style={{ textAlign: "right", fontWeight: "600", width: "40%" }}>שם החברה:</td>
                <td style={{ textAlign: "right" }}>{businessSettings?.business_name || "חברה"}</td>
              </tr>
              <tr>
                <td style={{ textAlign: "right", fontWeight: "600" }}>תאריך יצוא:</td>
                <td style={{ textAlign: "right" }}>{format(new Date(), "dd/MM/yyyy HH:mm")}</td>
              </tr>
              <tr>
                <td style={{ textAlign: "right", fontWeight: "600" }}>טווח דוח:</td>
                <td style={{ textAlign: "right" }}>{dateRange === "custom" ? `${customStart} עד ${customEnd}` : dateRange}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* KPI Cards Section */}
        <div style={{ padding: "25px 30px", background: "#fff" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#1a1a1a" }}>🎯 מדדי ביצוע (KPI)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
            {/* Sales Today */}
            <div style={{ background: "#fff8e1", border: "2px solid #ffd700", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#666", margin: "0 0 5px 0", fontWeight: "600" }}>מכירות היום</p>
              <p style={{ fontSize: "16px", fontWeight: "bold", color: "#f9d923", margin: "0" }}>₪{salesToday.toLocaleString()}</p>
            </div>
            {/* Sales Month */}
            <div style={{ background: "#e3f2fd", border: "2px solid #2196f3", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#666", margin: "0 0 5px 0", fontWeight: "600" }}>מכירות החודש</p>
              <p style={{ fontSize: "16px", fontWeight: "bold", color: "#2196f3", margin: "0" }}>₪{salesMonth.toLocaleString()}</p>
            </div>
            {/* Sales Year */}
            <div style={{ background: "#f3e5f5", border: "2px solid #9c27b0", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#666", margin: "0 0 5px 0", fontWeight: "600" }}>מכירות השנה</p>
              <p style={{ fontSize: "16px", fontWeight: "bold", color: "#9c27b0", margin: "0" }}>₪{salesYear.toLocaleString()}</p>
            </div>
            {/* Order Count */}
            <div style={{ background: "#e8f5e9", border: "2px solid #4caf50", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#666", margin: "0 0 5px 0", fontWeight: "600" }}>מספר הזמנות</p>
              <p style={{ fontSize: "16px", fontWeight: "bold", color: "#4caf50", margin: "0" }}>{filteredOrders.length}</p>
            </div>
          </div>
        </div>

        {/* Profitability Section */}
        <div style={{ padding: "25px 30px", borderTop: "2px solid #f0f0f0", background: "#fafafa" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#1a1a1a" }}>💰 סיכום רווחיות</h2>
          {profitability.totalSales === 0 ? (
            <p style={{ fontSize: "12px", color: "#999", textAlign: "center", padding: "20px", background: "#fff", borderRadius: "6px" }}>אין נתונים לתקופה שנבחרה</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", background: "#fff" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid #e0e0e0" }}>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", width: "25%", background: "#f5f5f5" }}>מכירה כוללת</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "bold", color: "#2196f3" }}>₪{profitability.totalSales.toLocaleString()}</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", width: "25%", background: "#f5f5f5" }}>עלות כוללת</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "bold", color: "#ff9800" }}>₪{profitability.totalCost.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", background: "#f5f5f5" }}>רווח גולמי</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "bold", color: "#4caf50" }}>₪{profitability.profit.toLocaleString()}</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", background: "#f5f5f5" }}>שולי רווח</td>
                  <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "bold", color: "#4caf50", fontSize: "13px" }}>{profitability.profitMargin.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Top Products */}
        <div style={{ padding: "25px 30px", borderTop: "2px solid #f0f0f0", background: "#fff" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#1a1a1a" }}>📦 מוצרים מובילים</h2>
          {topProducts.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#999", textAlign: "center", padding: "20px", background: "#f9f9f9", borderRadius: "6px" }}>אין נתונים לתקופה שנבחרה</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#f5f5f5", borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>מוצר</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>כמות</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>מכירות</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>רווח</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e0e0e0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 15px", textAlign: "right" }}>{p.name}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right" }}>{p.quantity}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", color: "#2196f3" }}>₪{p.sales.toLocaleString()}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", color: "#4caf50" }}>₪{p.profit.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top Customers */}
        <div style={{ padding: "25px 30px", borderTop: "2px solid #f0f0f0", background: "#fafafa" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "15px", color: "#1a1a1a" }}>👥 לקוחות מובילים</h2>
          {topCustomers.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#999", textAlign: "center", padding: "20px", background: "#fff", borderRadius: "6px" }}>אין נתונים לתקופה שנבחרה</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", background: "#fff" }}>
              <thead>
                <tr style={{ background: "#f5f5f5", borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>לקוח</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>הזמנות</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>סה״כ רכישות</th>
                  <th style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600" }}>רווח</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e0e0e0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 15px", textAlign: "right" }}>{c.name}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right" }}>{c.orders}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", color: "#2196f3" }}>₪{c.total.toLocaleString()}</td>
                    <td style={{ padding: "12px 15px", textAlign: "right", fontWeight: "600", color: "#4caf50" }}>₪{c.profit.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "20px 30px", background: "#f5f5f5", borderTop: "2px solid #e0e0e0", fontSize: "10px", color: "#666", textAlign: "center" }}>
          <p style={{ margin: "0" }}>דוח זה נוצר אוטומטית ב-{businessSettings?.business_name || "מערכת"}</p>
          <p style={{ margin: "5px 0 0 0", fontStyle: "italic" }}>© {new Date().getFullYear()} - כל הזכויות שמורות</p>
        </div>
      </div>

        {/* Sticky top bar: page header + filters + export */}
        <div className="sticky top-0 z-10 bg-background pb-3">
          <PageHeader title="דוחות" description="סקירה עסקית ונתונים סטטיסטיים" />
          <div className="bg-card border border-border rounded-xl p-4 mt-1">
          {/* Filter row: stacks to 2-col on tablet, 4-col on desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-sm font-medium mb-2 block">טווח תאריכים</label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">היום</SelectItem>
                  <SelectItem value="week">השבוע</SelectItem>
                  <SelectItem value="month">החודש</SelectItem>
                  <SelectItem value="year">השנה</SelectItem>
                  <SelectItem value="custom">טווח מותאם</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">סטטוס הזמנה</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  {STATUS_FILTER_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {dateRange === "custom" && (
              <>
                <div>
                  <label className="text-sm font-medium mb-2 block">מתאריך</label>
                  <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">עד תאריך</label>
                  <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
              </>
            )}

            {/* Export buttons always visible, take full row on mobile */}
            <div className={`flex items-end gap-2 ${dateRange === "custom" ? "sm:col-span-2 lg:col-span-4" : ""}`}>
              <Button onClick={exportExcel} variant="outline" size="sm" className="flex-1">
                <Download className="w-4 h-4 ml-1" /> ייצוא CSV
              </Button>
              <Button onClick={exportPDF} disabled={generatingPDF} variant="outline" size="sm" className="flex-1">
                {generatingPDF ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <FileText className="w-4 h-4 ml-1" />}
                ייצוא PDF
              </Button>
            </div>
          </div>
          </div>{/* end filter card */}
        </div>{/* end sticky top bar */}

      {/* Sales Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Profitability Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-2">מכירה כוללת</p>
          <p className="text-2xl font-bold">₪{profitability.totalSales.toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-2">עלות כוללת</p>
          <p className="text-2xl font-bold">₪{profitability.totalCost.toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-2">רווח גולמי</p>
          <p className="text-2xl font-bold text-green-600">₪{profitability.profit.toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-2">רווחיות %</p>
          <p className="text-2xl font-bold text-green-600">{profitability.profitMargin.toFixed(1)}%</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">מכירות ורווח חודשיים</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => `₪${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" name="מכירות" />
              <Line type="monotone" dataKey="profit" stroke="hsl(200,60%,50%)" name="רווח" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">מוצרים מובילים</h3>
          {topProductsChart.length === 0 ? (
            <div className="flex items-center justify-center h-[240px] text-muted-foreground">אין נתונים</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topProductsChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => `₪${v.toLocaleString()}`} />
                <Bar dataKey="sales" fill="hsl(var(--primary))" name="מכירות" />
                <Bar dataKey="profit" fill="hsl(200,60%,50%)" name="רווח" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Products Table */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> מוצרים מובילים
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-right py-2 px-3">מוצר</th>
                <th className="text-right py-2 px-3">כמות שנמכרה</th>
                <th className="text-right py-2 px-3">סך מכירות</th>
                <th className="text-right py-2 px-3">רווח</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((product) => (
                <tr key={product.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 px-3">{product.name}</td>
                  <td className="py-2 px-3">{product.quantity}</td>
                  <td className="py-2 px-3">₪{product.sales.toLocaleString()}</td>
                  <td className="py-2 px-3 text-green-600">₪{product.profit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Customers Table */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" /> לקוחות מובילים
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-right py-2 px-3">לקוח</th>
                <th className="text-right py-2 px-3">מספר הזמנות</th>
                <th className="text-right py-2 px-3">סך רכישות</th>
                <th className="text-right py-2 px-3">רווח גולמי</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((customer) => (
                <tr key={customer.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 px-3">{customer.name}</td>
                  <td className="py-2 px-3">{customer.orders}</td>
                  <td className="py-2 px-3">₪{customer.total.toLocaleString()}</td>
                  <td className="py-2 px-3 text-green-600">₪{customer.profit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    </>
  );
}