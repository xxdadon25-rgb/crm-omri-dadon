export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || isNaN(amount)) return '₪0.00';
  return `₪${Number(amount).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('he-IL');
};
