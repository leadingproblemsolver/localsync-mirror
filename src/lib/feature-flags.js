// Centralized feature flags. Default to false; flip when the
// corresponding migration / infra change has shipped.

export const FEATURE_FLAGS = Object.freeze({
  // DEPRECATED by G1 — org-based RLS replaces per-user isolation.
  // Kept = true so legacy call sites that still stamp owner_id / logged_by
  // remain harmless (RLS now ignores those columns and enforces org_id).
  // Safe to delete after all references are removed.
  P2_USER_ISOLATION: true,

  // P3 COLD_START_REPAIR: surfaces stale-incident repair affordances on
  // incidents that have gone untouched past the staleness window.
  P3_COLD_START_REPAIR: true,
});
