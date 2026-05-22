-- =====================================================================
-- 0006_pattern_aging_and_robustness.sql
-- =====================================================================
-- Forward-only migration. Idempotent.
-- Adds:
--   • schema_migrations ledger
--   • patterns.last_seen_at + index (recency weighting)
--   • reinforce_pattern() upsert RPC (collision-safe write path)
-- =====================================================================
BEGIN;

-- ---------- 1. migration ledger ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  notes       text
);

INSERT INTO schema_migrations(version, notes) VALUES
  ('0000_baseline',                       'db/schema.sql'),
  ('0005_team_visibility_and_p1',         'orgs, canonical_service, G6/7/8/9'),
  ('0006_pattern_aging_and_robustness',   'last_seen_at, decay, upsert RPC')
ON CONFLICT (version) DO NOTHING;

-- ---------- 2. pattern aging columns ----------
ALTER TABLE patterns
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

UPDATE patterns
   SET last_seen_at = COALESCE(updated_at, created_date)
 WHERE last_seen_at = created_date
   AND COALESCE(updated_at, created_date) <> created_date;

CREATE INDEX IF NOT EXISTS patterns_last_seen_idx
  ON patterns(last_seen_at DESC);

-- ---------- 3. collision-safe reinforce RPC ----------
-- One atomic upsert keyed on patterns_identity_unique
-- (org_id, canonical_service, symptom_fingerprint, first_action).
-- Eliminates the read-modify-write race in the client.
CREATE OR REPLACE FUNCTION public.reinforce_pattern(
  _org          uuid,
  _service      text,
  _canonical    text,
  _fingerprint  text,
  _first_action text,
  _success      int,
  _failure      int
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  IF _org IS NULL THEN
    RAISE EXCEPTION 'org id required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_org_member(_org, auth.uid()) THEN
    RAISE EXCEPTION 'not a member of org %', _org USING ERRCODE = '42501';
  END IF;

  INSERT INTO patterns(
    org_id, owner_id, service, canonical_service,
    symptom_fingerprint, first_action,
    success_count, failure_count, last_seen_at
  ) VALUES (
    _org, auth.uid(), _service, _canonical,
    COALESCE(_fingerprint, ''), _first_action,
    GREATEST(COALESCE(_success, 0), 0),
    GREATEST(COALESCE(_failure, 0), 0),
    now()
  )
  ON CONFLICT (org_id, canonical_service, symptom_fingerprint, first_action)
  DO UPDATE SET
    success_count = patterns.success_count + EXCLUDED.success_count,
    failure_count = patterns.failure_count + EXCLUDED.failure_count,
    last_seen_at  = now()
  RETURNING id INTO pid;

  RETURN pid;
END $$;

GRANT EXECUTE ON FUNCTION public.reinforce_pattern(
  uuid, text, text, text, text, int, int
) TO authenticated;

COMMIT;
