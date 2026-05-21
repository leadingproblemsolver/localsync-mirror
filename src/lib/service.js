// G2 — Service name normalization.
// Same logic as public.canonicalize_service() in SQL, kept in lockstep.
// `Payments-API` -> `payments`, `payment_api` -> `payment`,
// `payments-service` -> `payments`, `Redis Cluster` -> `redis-cluster`.
export function canonicalizeService(name) {
  if (name == null) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/-(api|svc|service)$/, '');
  s = s.replace(/(^-+|-+$)/g, '');
  return s;
}
