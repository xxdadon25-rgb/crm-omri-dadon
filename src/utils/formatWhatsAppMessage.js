export const formatWhatsAppMessage = (template, { name, number, amount, docType }) => {
  return template
    .replace(/{שם}/g, name || '')
    .replace(/{מספר}/g, number || '')
    .replace(/{סכום}/g, amount || '')
    .replace(/{סוג_מסמך}/g, docType || '');
};
