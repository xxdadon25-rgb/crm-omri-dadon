const DEFAULT_TEMPLATE = "שלום {שם},\n\n{סוג_מסמך} שלך מוכנה.\n\nמספר: {מספר}\nסך הכול לתשלום: ₪{סכום}\n\nתודה שבחרת בא.ד שיווק והפצה.";

export const formatWhatsAppMessage = (template, { name, number, amount, docType }) => {
  return (template || DEFAULT_TEMPLATE)
    .replace(/{שם}/g, name || '')
    .replace(/{מספר}/g, number || '')
    .replace(/{סכום}/g, amount || '')
    .replace(/{סוג_מסמך}/g, docType || '');
};
