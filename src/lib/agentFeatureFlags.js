/**
 * Feature remains off until staged database migrations, RLS/RPC regression,
 * and live app integration are approved. Frontend flag is NOT an access-control
 * boundary: agent routes and all mutations still require server authorization.
 */
export const AGENT_FEATURES_ENABLED =
  import.meta.env.VITE_ENABLE_SALES_AGENTS === "true";
