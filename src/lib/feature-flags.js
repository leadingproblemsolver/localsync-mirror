// Centralized feature flags. Default to false; flip when the
// corresponding migration / infra change has shipped.

export const FEATURE_FLAGS = Object.freeze({
  // P2 USER_ISOLATION: when true, the client writes `owner_id` on
  // Incident.create / Pattern.create and `logged_by` on IncidentEvent.create,
  // and assumes RLS policies are live in the DB.
  //
  // Requires supabase/migrations/0003_user_isolation.sql (or the P2 block in
  // db/schema.sql) to be applied first. Flipping this on without the
  // migration applied will surface as RLS-rejected inserts.
  P2_USER_ISOLATION: true,

  // P3 COLD_START_REPAIR (T-13…T-16): when true, the client surfaces
  // stale-incident repair affordances (re-fingerprint, re-run suggestions,
  // force-resolve) on incidents that have gone untouched past the
  // staleness window, and flags stale rows on Home.
  //
  // Requires db/migrations/0004_cold_start_repair.sql (or re-running
  // db/schema.sql) to be applied first. The client tolerates a missing
  // last_activity_at column by falling back to created_date, but the
  // partial staleness index won't exist until the migration runs.
  P3_COLD_START_REPAIR: true,
});
