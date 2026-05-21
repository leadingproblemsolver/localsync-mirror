import { createClient } from '@supabase/supabase-js';
import { appParams } from '@/lib/app-params';

/** @type {any} */
const importMetaEnv = (typeof import.meta !== 'undefined' && /** @type {any} */ (import.meta).env) || {};
const supabaseUrl = appParams.supabaseUrl || importMetaEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = appParams.supabaseAnonKey || importMetaEnv.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

const toSnakeCase = (entityName) =>
  entityName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// Tables whose rows are org-scoped — the client auto-stamps org_id on
// create (G1). RLS still enforces this server-side; this is just so
// the value is present without each call-site needing to remember.
const ORG_STAMPED = new Set([
  'incident',
  'pattern',
  'artifact',
  'blind_spot_recommendation',
]);

// Lazy import to avoid a cycle with @/lib/org which imports this module.
let _orgGetter = null;
async function getOrgIdSafe() {
  if (!_orgGetter) {
    _orgGetter = (await import('@/lib/org')).getCurrentOrgId;
  }
  try {
    return await _orgGetter();
  } catch (e) {
    console.error('getOrgIdSafe failed', e);
    return null;
  }
}

const createEntityClient = (entityName) => {
  const table = toSnakeCase(entityName);
  const isOrgStamped = ORG_STAMPED.has(entityName.toLowerCase());

  return {
    list: async (orderBy, limit) => {
      let query = supabase.from(table).select('*');
      if (orderBy) {
        const descending = orderBy.startsWith('-');
        const column = descending ? orderBy.slice(1) : orderBy;
        query = query.order(column, { ascending: !descending });
      }
      if (limit) {
        query = query.limit(limit);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    filter: async (filters = {}, options = {}) => {
      let query = supabase.from(table).select('*');
      Object.entries(filters).forEach(([key, value]) => {
        if (value === null) {
          query = query.is(key);
        } else {
          query = query.eq(key, value);
        }
      });
      if (options.orderBy) {
        const descending = options.orderBy.startsWith('-');
        const column = descending ? options.orderBy.slice(1) : options.orderBy;
        query = query.order(column, { ascending: !descending });
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    create: async (payload) => {
      let row = payload;
      if (isOrgStamped && row && row.org_id == null) {
        const orgId = await getOrgIdSafe();
        if (orgId) row = { ...row, org_id: orgId };
      }
      const { data, error } = await supabase.from(table).insert([row]).select();
      if (error) throw error;
      return data?.[0] ?? null;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from(table).update(payload).eq('id', id).select();
      if (error) throw error;
      return data?.[0] ?? null;
    },
  };
};

export const base44 = {
  auth: {
    loginViaEmailPassword: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    loginWithProvider: async (provider, redirectTo) => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) throw error;
      return data;
    },
    register: async ({ email, password }) => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      return data;
    },
    // eslint-disable-next-line no-unused-vars
    verifyOtp: async (_args) => {
      throw new Error('OTP verification is not supported in the Supabase migration flow yet.');
    },
    // eslint-disable-next-line no-unused-vars
    resendOtp: async (_email) => {
      throw new Error('OTP resend is not supported in the Supabase migration flow yet.');
    },
    // eslint-disable-next-line no-unused-vars
    setToken: (_token) => undefined,
    resetPasswordRequest: async (email) => {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      return data;
    },
    resetPassword: async ({ newPassword, password }) => {
      const pwd = newPassword ?? password;
      const { data, error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      return data;
    },
    currentUserId: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    logout: async (shouldRedirect = true) => {
      await supabase.auth.signOut();
      if (shouldRedirect) {
        window.location.href = window.location.href;
      }
    },
    redirectToLogin: () => {
      window.location.href = '/login';
    },
    me: async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) throw error;
      return user;
    },
  },
  entities: {
    Incident: createEntityClient('Incident'),
    IncidentEvent: createEntityClient('IncidentEvent'),
    Pattern: createEntityClient('Pattern'),
    Artifact: createEntityClient('Artifact'),
    BlindSpotRecommendation: createEntityClient('BlindSpotRecommendation'),
  },
  supabase,
};
