// P3 COLD_START_REPAIR — T-14
//
// Pure client-side staleness derivation. The DB stores
// incidents.last_activity_at (migration 0004); this helper falls back to
// created_date so the UI degrades gracefully on a database that hasn't
// been migrated yet.

import { COLD_START_PARAMS } from '@/lib/app-params';

function activityTimestamp(incident) {
  const raw = incident?.last_activity_at || incident?.created_date;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * @param {object} incident
 * @param {number} [now]
 * @returns {boolean} true iff the incident is active AND has gone
 *   untouched past the staleness threshold.
 */
export function isStale(incident, now = Date.now()) {
  if (!incident || incident.status !== 'active') return false;
  const last = activityTimestamp(incident);
  if (!last) return false;
  return now - last >= COLD_START_PARAMS.STALENESS_THRESHOLD_MS;
}

/**
 * @param {object} incident
 * @param {number} [now]
 * @returns {number} milliseconds since last activity (clamped >= 0).
 */
export function staleAgeMs(incident, now = Date.now()) {
  const last = activityTimestamp(incident);
  if (!last) return 0;
  return Math.max(0, now - last);
}

/** Compact "Xd" / "Xh" label for stale-for badges. */
export function formatStaleAge(ms) {
  if (!ms || ms < 0) return '0h';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
