/**
 * Drop-in replacement for the base44 SDK.
 * Exports `base44` with the same `.entities.*` and `.auth.*` shape so no
 * other file in the codebase needs to change its import or call site.
 */
import { supabase } from './supabaseClient';

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseSort(sort) {
  if (!sort) return { column: 'created_date', ascending: false };
  if (sort.startsWith('-')) return { column: sort.slice(1), ascending: false };
  return { column: sort, ascending: true };
}

function throwIfError(error) {
  if (error) throw Object.assign(new Error(error.message), { status: error.code });
}

// ─── entity factory ───────────────────────────────────────────────────────────

function makeEntityMethods(tableName) {
  return {
    /**
     * list(sort?, limit?, offset?)
     *   sort   – "-created_date" | "name" | null
     *   limit  – max rows (default: unlimited)
     *   offset – for pagination
     */
    async list(sort, limit, offset) {
      const { column, ascending } = parseSort(sort);
      let q = supabase.from(tableName).select('*').order(column, { ascending });
      if (limit) q = q.limit(limit);
      if (offset != null && limit) q = q.range(offset, offset + limit - 1);
      const { data, error } = await q;
      throwIfError(error);
      return data ?? [];
    },

    /**
     * filter(conditions, sort?)
     *   conditions – { field: value, ... }  (null value uses IS NULL)
     */
    async filter(conditions = {}, sort) {
      const { column, ascending } = parseSort(sort);
      let q = supabase.from(tableName).select('*').order(column, { ascending });
      for (const [key, value] of Object.entries(conditions)) {
        q = value === null ? q.is(key, null) : q.eq(key, value);
      }
      const { data, error } = await q;
      throwIfError(error);
      return data ?? [];
    },

    /** get(id) – single record by primary key */
    async get(id) {
      const { data, error } = await supabase
        .from(tableName).select('*').eq('id', id).single();
      throwIfError(error);
      return data;
    },

    /** create(payload) – insert and return the new record */
    async create(payload) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from(tableName).insert({ ...payload, user_id: user?.id }).select().single();
      throwIfError(error);
      return data;
    },

    /** update(id, payload) – patch and return the updated record */
    async update(id, payload) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from(tableName).update({ ...payload, user_id: user?.id }).eq('id', id).select().single();
      throwIfError(error);
      return data;
    },

    /** delete(id) */
    async delete(id) {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from(tableName).delete().eq('id', id).eq('user_id', user?.id);
      throwIfError(error);
    },
  };
}

// ─── entities ─────────────────────────────────────────────────────────────────

const entities = {
  Customer:           makeEntityMethods('customers'),
  Product:            makeEntityMethods('products'),
  Order:              makeEntityMethods('orders'),
  Invoice:            makeEntityMethods('invoices'),
  Quote:              makeEntityMethods('quotes'),
  Supplier:           makeEntityMethods('suppliers'),
  Payment:            makeEntityMethods('payments'),
  CrmTask:            makeEntityMethods('crm_tasks'),
  RepairTicket:       makeEntityMethods('repair_tickets'),
  Category:           makeEntityMethods('categories'),
  InventoryMovement:  makeEntityMethods('inventory_movements'),
  Notification:       makeEntityMethods('notifications'),
  ImportLog:          makeEntityMethods('import_logs'),
  InvoiceLog:         makeEntityMethods('invoice_logs'),
  Backup:             makeEntityMethods('backups'),
  BusinessSettings:   makeEntityMethods('business_settings'),
};

// ─── auth ─────────────────────────────────────────────────────────────────────

const auth = {
  /** Returns a user object shaped like the old base44 user */
  async me() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw error ?? new Error('Not authenticated');
    return {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
      role: user.user_metadata?.role || 'user',
    };
  },

  async loginViaEmailPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  loginWithProvider(provider, redirectPath = '/') {
    supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${redirectPath}` },
    });
  },

  async register({ email, password }) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw error;
  },

  async verifyOtp({ email, otpCode }) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: 'email',
    });
    if (error) throw error;
    return data?.session ? { access_token: data.session.access_token } : null;
  },

  async resendOtp(email) {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) throw error;
  },

  async resetPasswordRequest(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },

  /** Called after user lands on /reset-password via the email link */
  async resetPassword({ newPassword }) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  /** No-op shim – Supabase handles tokens internally */
  setToken() {},

  async logout(redirectUrl) {
    await supabase.auth.signOut();
    window.location.href = redirectUrl || '/login';
  },

  redirectToLogin() {
    window.location.href = '/login';
  },
};

// ─── export ───────────────────────────────────────────────────────────────────

export const base44 = { entities, auth };
