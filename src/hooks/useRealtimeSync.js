import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

const TABLES = [
  { table: 'customers', queryKey: 'customers' },
  { table: 'products', queryKey: 'products' },
  { table: 'orders', queryKey: 'orders' },
  { table: 'quotes', queryKey: 'quotes' },
  { table: 'invoices', queryKey: 'invoices' },
  { table: 'suppliers', queryKey: 'suppliers' },
  { table: 'credit_notes', queryKey: 'credit_notes' },
  { table: 'customer_tasks', queryKey: 'customer_tasks' },
  { table: 'supplier_orders', queryKey: 'supplier_orders' },
  { table: 'payments', queryKey: 'payments' },
  // queryKey can be a string (single key) or array of strings (multiple keys to invalidate)
  { table: 'portal_orders', queryKey: ['portal-orders-pending-count', 'portal-orders-pending'] },
];

export const useRealtimeSync = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channels = TABLES.map(({ table, queryKey }) => {
      const keys = Array.isArray(queryKey) ? queryKey : [queryKey];
      const channel = supabase
        .channel(`realtime:${table}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table },
          () => {
            keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
          }
        )
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, [queryClient]);
};
