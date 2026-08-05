const BANK_DETAILS = "\n\nלתשלום בהעברה בנקאית:\nבנק לאומי (10)\nסניף: 882\nחשבון: 11814/48\nעל שם: א.ד שיווק והפצה";

const DEFAULT_TEMPLATE = "שלום {שם},\n\n{סוג_מסמך} שלך מוכנה.\n\nמספר: {מספר}\nסך הכול לתשלום: ₪{סכום}\n\nתודה שבחרת בא.ד שיווק והפצה." + BANK_DETAILS;

export const formatWhatsAppMessage = (template, { name, number, amount, docType }) => {
  return (template || DEFAULT_TEMPLATE)
    .replace(/{שם}/g, name || '')
    .replace(/{מספר}/g, number || '')
    .replace(/{סכום}/g, amount || '')
    .replace(/{סוג_מסמך}/g, docType || '');
};
