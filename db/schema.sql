-- =====================================================================
-- UNIFIED DATABASE SCHEMA — SINGLE SOURCE OF TRUTH
-- =====================================================================
-- Paste this entire file into the Supabase SQL editor and run once.
-- Idempotent and forward-only: re-running produces the same end state.
--
-- Includes:
--   • P0 RETRIEVAL_CORE  — base tables, constraints, indexes, triggers
--   • P1 DATA_INTEGRITY  — denormalized counters kept truthful by triggers
--   • P2 USER_ISOLATION  — owner_id columns, RLS policies (auth.uid())
--   • P3 COLD_START_REPAIR — last_activity_at column, staleness triggers
--
-- Conventions
--   • PostgreSQL 15+ / Supabase target.
--   • UUID PKs via pgcrypto.gen_random_uuid().
--   • snake_case, plural table names.
--   • created_date is kept (not created_at) — the app reads it directly.
--   • Enumerations modeled as TEXT + CHECK to mirror the client contract.
--   • Patterns are user-scoped (NOT globally readable) in V1.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- shared trigger: maintain updated_at on UPDATE
-- =====================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- =====================================================================
-- incidents
-- =====================================================================
CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  service             TEXT         NOT NULL,
  symptom             TEXT         NOT NULL,
  symptom_fingerprint TEXT         NOT NULL DEFAULT '',
  status              TEXT         NOT NULL DEFAULT 'active',
  outcome             TEXT,
  root_cause_note     TEXT,
  is_test             BOOLEAN      NOT NULL DEFAULT false,
  step_count          INTEGER      NOT NULL DEFAULT 0,
  resolved_at         TIMESTAMPTZ,
  created_date        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT incidents_service_nonempty CHECK (length(btrim(service)) > 0),
  CONSTRAINT incidents_symptom_nonempty CHECK (length(btrim(symptom)) > 0),
  CONSTRAINT incidents_status_valid    CHECK (status  IN ('active','resolved')),
  CONSTRAINT incidents_outcome_valid   CHECK (outcome IS NULL OR outcome IN ('success','failure')),
  CONSTRAINT incidents_step_count_nonneg CHECK (step_count >= 0),
  CONSTRAINT incidents_resolution_consistent CHECK (
    (status = 'active'   AND resolved_at IS NULL AND outcome IS NULL)
    OR
    (status = 'resolved' AND resolved_at IS NOT NULL AND outcome IS NOT NULL)
  )
);

-- P2: owner column
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS owner_id UUID DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- P3: last activity column (defaults to now())
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- (P3 backfill of last_activity_at is performed below, after
-- incident_events is created, so a fresh install does not reference a
-- non-existent table.)

CREATE INDEX IF NOT EXISTS incidents_status_created_idx
  ON incidents (status, created_date DESC);
CREATE INDEX IF NOT EXISTS incidents_service_fingerprint_idx
  ON incidents (service, symptom_fingerprint);
CREATE INDEX IF NOT EXISTS incidents_owner_idx
  ON incidents (owner_id);
CREATE INDEX IF NOT EXISTS incidents_status_activity_idx
  ON incidents (status, last_activity_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON incidents;
CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- P3: bump last_activity_at when status flips to resolved
CREATE OR REPLACE FUNCTION bump_incident_activity_on_resolve()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incidents_resolve_activity ON incidents;
CREATE TRIGGER trg_incidents_resolve_activity
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION bump_incident_activity_on_resolve();

-- =====================================================================
-- incident_events
-- =====================================================================
CREATE TABLE IF NOT EXISTS incident_events (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id      UUID         NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  step_order       INTEGER      NOT NULL,
  message          TEXT         NOT NULL,
  suggested_action TEXT,
  event_type       TEXT         NOT NULL DEFAULT 'message',
  created_date     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT incident_events_step_positive    CHECK (step_order >= 1),
  CONSTRAINT incident_events_message_nonempty CHECK (length(btrim(message)) > 0),
  CONSTRAINT incident_events_step_unique      UNIQUE (incident_id, step_order)
);

-- P2: who logged the event
ALTER TABLE incident_events
  ADD COLUMN IF NOT EXISTS logged_by UUID DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Gap #3: persist the full ranked suggestion list shown to the user
-- (not only rank-1). JSONB array of strings; default [] keeps existing
-- rows valid and lets the UI degrade gracefully.
ALTER TABLE incident_events
  ADD COLUMN IF NOT EXISTS suggestions_shown JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE incident_events DROP CONSTRAINT IF EXISTS incident_events_suggestions_is_array;
ALTER TABLE incident_events
  ADD CONSTRAINT incident_events_suggestions_is_array
  CHECK (jsonb_typeof(suggestions_shown) = 'array');


CREATE INDEX IF NOT EXISTS incident_events_incident_idx
  ON incident_events (incident_id, step_order);
CREATE INDEX IF NOT EXISTS incident_events_logger_idx
  ON incident_events (logged_by);

-- P1: keep incidents.step_count truthful
CREATE OR REPLACE FUNCTION sync_incident_step_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE incidents
       SET step_count = GREATEST(step_count, NEW.step_order)
     WHERE id = NEW.incident_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE incidents i
       SET step_count = COALESCE((SELECT MAX(step_order) FROM incident_events WHERE incident_id = i.id), 0)
     WHERE i.id = OLD.incident_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_incident_events_step_count ON incident_events;
CREATE TRIGGER trg_incident_events_step_count
  AFTER INSERT OR DELETE ON incident_events
  FOR EACH ROW EXECUTE FUNCTION sync_incident_step_count();

-- P3: keep incidents.last_activity_at truthful
CREATE OR REPLACE FUNCTION sync_incident_last_activity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE incidents
       SET last_activity_at = now()
     WHERE id = NEW.incident_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE incidents i
       SET last_activity_at = COALESCE(
         (SELECT MAX(created_date) FROM incident_events WHERE incident_id = i.id),
         i.created_date
       )
     WHERE i.id = OLD.incident_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_incident_events_last_activity ON incident_events;
CREATE TRIGGER trg_incident_events_last_activity
  AFTER INSERT OR DELETE ON incident_events
  FOR EACH ROW EXECUTE FUNCTION sync_incident_last_activity();

-- P3: backfill incidents.last_activity_at now that incident_events exists
UPDATE incidents
   SET last_activity_at = COALESCE(
     (SELECT MAX(created_date) FROM incident_events e WHERE e.incident_id = incidents.id),
     created_date
   )
 WHERE last_activity_at = created_date OR last_activity_at < created_date;


-- =====================================================================
-- patterns
-- =====================================================================
CREATE TABLE IF NOT EXISTS patterns (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  service             TEXT         NOT NULL,
  first_action        TEXT         NOT NULL,
  symptom_fingerprint TEXT         NOT NULL DEFAULT '',
  success_count       INTEGER      NOT NULL DEFAULT 0,
  failure_count       INTEGER      NOT NULL DEFAULT 0,
  created_date        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT patterns_service_nonempty      CHECK (length(btrim(service)) > 0),
  CONSTRAINT patterns_first_action_nonempty CHECK (length(btrim(first_action)) > 0),
  CONSTRAINT patterns_success_nonneg        CHECK (success_count >= 0),
  CONSTRAINT patterns_failure_nonneg        CHECK (failure_count >= 0)
);

-- P2: owner column
ALTER TABLE patterns
  ADD COLUMN IF NOT EXISTS owner_id UUID DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- P2: patterns identity is per-owner so two users training on the same
-- fingerprint do not collide.
ALTER TABLE patterns DROP CONSTRAINT IF EXISTS patterns_identity_unique;
ALTER TABLE patterns
  ADD CONSTRAINT patterns_identity_unique
  UNIQUE (owner_id, service, symptom_fingerprint, first_action);

CREATE INDEX IF NOT EXISTS patterns_service_fp_idx
  ON patterns (service, symptom_fingerprint);
CREATE INDEX IF NOT EXISTS patterns_owner_idx
  ON patterns (owner_id, service, symptom_fingerprint);

DROP TRIGGER IF EXISTS trg_patterns_updated_at ON patterns;
CREATE TRIGGER trg_patterns_updated_at
  BEFORE UPDATE ON patterns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- artifacts (immutable post-mortem snapshot, one per incident)
-- =====================================================================
CREATE TABLE IF NOT EXISTS artifacts (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         UUID         NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  service             TEXT         NOT NULL,
  symptom             TEXT         NOT NULL,
  first_intention     TEXT,
  suggestion_shown    TEXT,
  actual_first_action TEXT,
  diverged            BOOLEAN      NOT NULL DEFAULT false,
  event_sequence      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  outcome             TEXT         NOT NULL,
  root_cause_note     TEXT,
  ttr_minutes         NUMERIC(10,2),
  markdown_export     TEXT         NOT NULL,
  created_date        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_outcome_valid           CHECK (outcome IN ('success','failure')),
  CONSTRAINT artifacts_markdown_nonempty       CHECK (length(markdown_export) > 0),
  CONSTRAINT artifacts_ttr_nonneg              CHECK (ttr_minutes IS NULL OR ttr_minutes >= 0),
  CONSTRAINT artifacts_event_sequence_is_array CHECK (jsonb_typeof(event_sequence) = 'array')
);

CREATE INDEX IF NOT EXISTS artifacts_service_idx ON artifacts (service);

-- =====================================================================
-- P2: Row Level Security — owner-scoped policies
-- =====================================================================
ALTER TABLE incidents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patterns         ENABLE ROW LEVEL SECURITY;

-- incidents
DROP POLICY IF EXISTS incidents_owner_select ON incidents;
DROP POLICY IF EXISTS incidents_owner_insert ON incidents;
DROP POLICY IF EXISTS incidents_owner_update ON incidents;
DROP POLICY IF EXISTS incidents_owner_delete ON incidents;
CREATE POLICY incidents_owner_select ON incidents
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY incidents_owner_insert ON incidents
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY incidents_owner_update ON incidents
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY incidents_owner_delete ON incidents
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- incident_events (scoped via parent incident's owner)
DROP POLICY IF EXISTS incident_events_parent ON incident_events;
CREATE POLICY incident_events_parent ON incident_events
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id AND i.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id AND i.owner_id = auth.uid()));

-- artifacts (scoped via parent incident's owner)
DROP POLICY IF EXISTS artifacts_parent ON artifacts;
CREATE POLICY artifacts_parent ON artifacts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id AND i.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id AND i.owner_id = auth.uid()));

-- patterns (owner-scoped; NOT globally readable in V1)
DROP POLICY IF EXISTS patterns_read          ON patterns;
DROP POLICY IF EXISTS patterns_owner_select  ON patterns;
DROP POLICY IF EXISTS patterns_owner_insert  ON patterns;
DROP POLICY IF EXISTS patterns_owner_update  ON patterns;
DROP POLICY IF EXISTS patterns_owner_delete  ON patterns;
CREATE POLICY patterns_owner_select ON patterns
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY patterns_owner_insert ON patterns
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY patterns_owner_update ON patterns
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY patterns_owner_delete ON patterns
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

COMMIT;
