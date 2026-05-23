-- =====================================================================
-- 0007_event_rationale.sql
-- =====================================================================
-- Forward-only migration. Idempotent.
-- Adds optional `rationale` (the "why") to incident_events so the
-- decision trace can capture reasoning chains alongside actions.
-- =====================================================================
BEGIN;

ALTER TABLE incident_events
  ADD COLUMN IF NOT EXISTS rationale text;

COMMENT ON COLUMN incident_events.rationale IS
  'Optional free-text "why" for this step: signals ruled out, reasoning, '
  'why this action was chosen. Captured at log time. Nullable by design — '
  'most steps will not have one and that is fine.';

INSERT INTO schema_migrations(version, notes) VALUES
  ('0007_event_rationale', 'optional rationale on incident_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
