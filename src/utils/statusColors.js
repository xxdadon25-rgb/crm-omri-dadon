export const getOrderStatusColor = (status) => {
  const map = {
    'טיוטה': 'bg-gray-100 text-gray-700',
    'ממתין לאישור': 'bg-blue-100 text-blue-700',
    'אושר': 'bg-green-100 text-green-700',
    'בהכנה': 'bg-orange-100 text-orange-700',
    'הושלם': 'bg-green-200 text-green-800',
    'בוטל': 'bg-red-100 text-red-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
};

export const getPaymentStatusColor = (status) => {
  const map = {
    'ממתין לתשלום': 'bg-red-100 text-red-700',
    'שולם חלקית': 'bg-orange-100 text-orange-700',
    'שולם': 'bg-green-100 text-green-700',
    'באיחור': 'bg-red-200 text-red-800',
    'זוכה': 'bg-purple-100 text-purple-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
};
