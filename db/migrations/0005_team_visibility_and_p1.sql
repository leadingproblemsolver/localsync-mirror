-- =====================================================================
-- 0005_team_visibility_and_p1.sql
-- =====================================================================
-- Forward-only migration. Paste into the Supabase SQL editor once.
-- Covers gap registry G1, G2, G6 (data prerequisites), G7, G8, G9.
-- Idempotent: re-running converges to the same end state.
-- =====================================================================
BEGIN;

-- =====================================================================
-- G1: organizations + memberships, swap RLS from owner_id to org_id
-- =====================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text UNIQUE,
  created_date timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_idx ON org_members(user_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members   ENABLE ROW LEVEL SECURITY;

-- Security definer: avoids RLS recursion on org_members.
CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members WHERE org_id = _org AND user_id = _user
  )
$$;

DROP POLICY IF EXISTS org_members_self_select  ON org_members;
DROP POLICY IF EXISTS org_members_peer_select  ON org_members;
DROP POLICY IF EXISTS org_members_self_insert  ON org_members;
CREATE POLICY org_members_self_select ON org_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY org_members_peer_select ON org_members
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
-- Self-insert (used by client when joining own freshly-created org)
CREATE POLICY org_members_self_insert ON org_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS organizations_member_select ON organizations;
DROP POLICY IF EXISTS organizations_auth_insert   ON organizations;
CREATE POLICY organizations_member_select ON organizations
  FOR SELECT TO authenticated USING (public.is_org_member(id, auth.uid()));
CREATE POLICY organizations_auth_insert ON organizations
  FOR INSERT TO authenticated WITH CHECK (true);

-- Add org_id columns
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS org_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE patterns  ADD COLUMN IF NOT EXISTS org_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS org_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill: one personal org per distinct existing owner_id.
DO $$
DECLARE
  rec record;
  new_org uuid;
  email_local text;
BEGIN
  -- owners that have incidents
  FOR rec IN
    SELECT DISTINCT i.owner_id
    FROM incidents i
    WHERE i.owner_id IS NOT NULL AND i.org_id IS NULL
  LOOP
    SELECT split_part(u.email, '@', 1) INTO email_local
      FROM auth.users u WHERE u.id = rec.owner_id;
    INSERT INTO organizations(name)
      VALUES (coalesce(NULLIF(email_local, ''), 'workspace') || '''s workspace')
      RETURNING id INTO new_org;
    INSERT INTO org_members(org_id, user_id, role)
      VALUES (new_org, rec.owner_id, 'owner')
      ON CONFLICT DO NOTHING;
    UPDATE incidents SET org_id = new_org
      WHERE owner_id = rec.owner_id AND org_id IS NULL;
    UPDATE patterns  SET org_id = new_org
      WHERE owner_id = rec.owner_id AND org_id IS NULL;
    UPDATE artifacts a SET org_id = new_org
      FROM incidents i
      WHERE a.incident_id = i.id
        AND i.owner_id = rec.owner_id
        AND a.org_id IS NULL;
  END LOOP;
  -- owners with only patterns (no incidents)
  FOR rec IN
    SELECT DISTINCT p.owner_id
    FROM patterns p
    WHERE p.owner_id IS NOT NULL AND p.org_id IS NULL
  LOOP
    SELECT split_part(u.email, '@', 1) INTO email_local
      FROM auth.users u WHERE u.id = rec.owner_id;
    INSERT INTO organizations(name)
      VALUES (coalesce(NULLIF(email_local, ''), 'workspace') || '''s workspace')
      RETURNING id INTO new_org;
    INSERT INTO org_members(org_id, user_id, role)
      VALUES (new_org, rec.owner_id, 'owner')
      ON CONFLICT DO NOTHING;
    UPDATE patterns SET org_id = new_org
      WHERE owner_id = rec.owner_id AND org_id IS NULL;
  END LOOP;
END $$;

-- Trigger: auto-create personal org for every new auth.users row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org uuid;
  local_part text;
BEGIN
  local_part := split_part(coalesce(NEW.email, 'user'), '@', 1);
  INSERT INTO organizations(name)
    VALUES (coalesce(NULLIF(local_part, ''), 'user') || '''s workspace')
    RETURNING id INTO new_org;
  INSERT INTO org_members(org_id, user_id, role)
    VALUES (new_org, NEW.id, 'owner');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE INDEX IF NOT EXISTS incidents_org_idx ON incidents(org_id);
CREATE INDEX IF NOT EXISTS patterns_org_idx  ON patterns(org_id);
CREATE INDEX IF NOT EXISTS artifacts_org_idx ON artifacts(org_id);

-- Replace owner-scoped RLS with org-scoped.
DROP POLICY IF EXISTS incidents_owner_select ON incidents;
DROP POLICY IF EXISTS incidents_owner_insert ON incidents;
DROP POLICY IF EXISTS incidents_owner_update ON incidents;
DROP POLICY IF EXISTS incidents_owner_delete ON incidents;
DROP POLICY IF EXISTS incidents_org_select   ON incidents;
DROP POLICY IF EXISTS incidents_org_insert   ON incidents;
DROP POLICY IF EXISTS incidents_org_update   ON incidents;
DROP POLICY IF EXISTS incidents_org_delete   ON incidents;
CREATE POLICY incidents_org_select ON incidents
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY incidents_org_insert ON incidents
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id, auth.uid()));
CREATE POLICY incidents_org_update ON incidents
  FOR UPDATE TO authenticated
  USING      (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));
CREATE POLICY incidents_org_delete ON incidents
  FOR DELETE TO authenticated USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS incident_events_parent ON incident_events;
CREATE POLICY incident_events_parent ON incident_events
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM incidents i
                      WHERE i.id = incident_id
                        AND public.is_org_member(i.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i
                      WHERE i.id = incident_id
                        AND public.is_org_member(i.org_id, auth.uid())));

DROP POLICY IF EXISTS artifacts_parent ON artifacts;
CREATE POLICY artifacts_parent ON artifacts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM incidents i
                      WHERE i.id = incident_id
                        AND public.is_org_member(i.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i
                      WHERE i.id = incident_id
                        AND public.is_org_member(i.org_id, auth.uid())));

DROP POLICY IF EXISTS patterns_owner_select ON patterns;
DROP POLICY IF EXISTS patterns_owner_insert ON patterns;
DROP POLICY IF EXISTS patterns_owner_update ON patterns;
DROP POLICY IF EXISTS patterns_owner_delete ON patterns;
DROP POLICY IF EXISTS patterns_org_select   ON patterns;
DROP POLICY IF EXISTS patterns_org_insert   ON patterns;
DROP POLICY IF EXISTS patterns_org_update   ON patterns;
DROP POLICY IF EXISTS patterns_org_delete   ON patterns;
CREATE POLICY patterns_org_select ON patterns
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY patterns_org_insert ON patterns
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id, auth.uid()));
CREATE POLICY patterns_org_update ON patterns
  FOR UPDATE TO authenticated
  USING      (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));
CREATE POLICY patterns_org_delete ON patterns
  FOR DELETE TO authenticated USING (public.is_org_member(org_id, auth.uid()));

-- =====================================================================
-- G2: canonical_service normalization
-- =====================================================================
CREATE OR REPLACE FUNCTION public.canonicalize_service(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]+', '-', 'g'),
             '-(api|svc|service)$', ''
           ),
           '(^-+|-+$)', '', 'g'
         )
$$;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS canonical_service text;
ALTER TABLE patterns  ADD COLUMN IF NOT EXISTS canonical_service text;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS canonical_service text;

UPDATE incidents SET canonical_service = public.canonicalize_service(service)
  WHERE canonical_service IS NULL OR canonical_service = '';
UPDATE patterns  SET canonical_service = public.canonicalize_service(service)
  WHERE canonical_service IS NULL OR canonical_service = '';
UPDATE artifacts SET canonical_service = public.canonicalize_service(service)
  WHERE canonical_service IS NULL OR canonical_service = '';

CREATE INDEX IF NOT EXISTS incidents_canon_fp_idx
  ON incidents(canonical_service, symptom_fingerprint);
CREATE INDEX IF NOT EXISTS patterns_canon_fp_idx
  ON patterns(canonical_service, symptom_fingerprint);

-- Collapse pattern duplicates per (org, canonical_service, fingerprint, normalized first_action):
-- sum counts into the keeper, then drop losers, then enforce the new unique key.
WITH ranked AS (
  SELECT id, org_id, canonical_service, symptom_fingerprint,
         lower(btrim(first_action)) AS norm_fa,
         success_count, failure_count,
         row_number() OVER (
           PARTITION BY org_id, canonical_service, symptom_fingerprint, lower(btrim(first_action))
           ORDER BY (success_count + failure_count) DESC, created_date ASC
         ) AS rn
  FROM patterns
  WHERE org_id IS NOT NULL
),
keepers AS (SELECT * FROM ranked WHERE rn = 1),
losers  AS (SELECT * FROM ranked WHERE rn > 1),
agg AS (
  SELECT k.id AS keep_id,
         k.success_count + COALESCE(SUM(l.success_count), 0) AS new_s,
         k.failure_count + COALESCE(SUM(l.failure_count), 0) AS new_f
    FROM keepers k
    LEFT JOIN losers l USING (org_id, canonical_service, symptom_fingerprint, norm_fa)
   GROUP BY k.id, k.success_count, k.failure_count
)
UPDATE patterns p SET success_count = a.new_s, failure_count = a.new_f
  FROM agg a WHERE p.id = a.keep_id;

DELETE FROM patterns p USING (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY org_id, canonical_service, symptom_fingerprint, lower(btrim(first_action))
      ORDER BY (success_count + failure_count) DESC, created_date ASC
    ) AS rn
    FROM patterns WHERE org_id IS NOT NULL
  ) z WHERE z.rn > 1
) d WHERE p.id = d.id;

ALTER TABLE patterns DROP CONSTRAINT IF EXISTS patterns_identity_unique;
ALTER TABLE patterns
  ADD CONSTRAINT patterns_identity_unique
  UNIQUE (org_id, canonical_service, symptom_fingerprint, first_action);

-- =====================================================================
-- G8: richer resolution states
-- =====================================================================
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_outcome_valid;
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_resolution_consistent;
UPDATE incidents SET outcome = CASE outcome
  WHEN 'success' THEN 'resolved'
  WHEN 'failure' THEN 'rolled-back'
  ELSE outcome END
WHERE outcome IN ('success', 'failure');
ALTER TABLE incidents
  ADD CONSTRAINT incidents_outcome_valid
  CHECK (outcome IS NULL OR outcome IN ('mitigated','resolved','rolled-back','escalated'));
ALTER TABLE incidents
  ADD CONSTRAINT incidents_resolution_consistent CHECK (
    (status = 'active'   AND resolved_at IS NULL AND outcome IS NULL)
    OR
    (status = 'resolved' AND resolved_at IS NOT NULL AND outcome IS NOT NULL)
  );

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_outcome_valid;
UPDATE artifacts SET outcome = CASE outcome
  WHEN 'success' THEN 'resolved'
  WHEN 'failure' THEN 'rolled-back'
  ELSE outcome END
WHERE outcome IN ('success', 'failure');
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_outcome_valid
  CHECK (outcome IN ('mitigated','resolved','rolled-back','escalated'));

-- =====================================================================
-- G7: deferred postmortem
-- =====================================================================
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS rca_status text NOT NULL DEFAULT 'pending'
    CHECK (rca_status IN ('pending','complete'));
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS rca_prompt_due timestamptz;

CREATE OR REPLACE FUNCTION public.sync_rca_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.root_cause_note IS NOT NULL
     AND length(btrim(NEW.root_cause_note)) > 0 THEN
    NEW.rca_status := 'complete';
  ELSE
    NEW.rca_status := 'pending';
  END IF;
  IF NEW.status = 'resolved'
     AND NEW.resolved_at IS NOT NULL
     AND NEW.rca_prompt_due IS NULL THEN
    NEW.rca_prompt_due := NEW.resolved_at + interval '24 hours';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incidents_rca_status ON incidents;
CREATE TRIGGER trg_incidents_rca_status
  BEFORE INSERT OR UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION public.sync_rca_status();

UPDATE incidents
   SET rca_prompt_due = resolved_at + interval '24 hours'
 WHERE status = 'resolved'
   AND resolved_at IS NOT NULL
   AND rca_prompt_due IS NULL;
UPDATE incidents
   SET rca_status = 'complete'
 WHERE root_cause_note IS NOT NULL
   AND length(btrim(root_cause_note)) > 0
   AND rca_status <> 'complete';

-- =====================================================================
-- G9: blind spot inference
-- =====================================================================
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rca_category text;
CREATE INDEX IF NOT EXISTS incidents_canon_cat_idx
  ON incidents(canonical_service, rca_category);

CREATE TABLE IF NOT EXISTS blind_spot_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_service   text NOT NULL,
  rca_category        text NOT NULL,
  incident_count      int  NOT NULL,
  predicted_impact_pct numeric(5,1) NOT NULL,
  status              text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','dismissed','actioned')),
  created_date        timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS blind_spot_unique_active
  ON blind_spot_recommendations(org_id, canonical_service, rca_category)
  WHERE status = 'active';

ALTER TABLE blind_spot_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blind_spot_org ON blind_spot_recommendations;
CREATE POLICY blind_spot_org ON blind_spot_recommendations
  FOR ALL TO authenticated
  USING      (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.recompute_blind_spots(_org uuid, _service text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total int;
  rec   record;
BEGIN
  IF _org IS NULL OR _service IS NULL OR _service = '' THEN RETURN; END IF;
  SELECT count(*) INTO total
    FROM incidents
   WHERE org_id = _org
     AND canonical_service = _service
     AND created_date > now() - interval '90 days';
  IF total = 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT rca_category, count(*) AS c
      FROM incidents
     WHERE org_id = _org
       AND canonical_service = _service
       AND rca_category IS NOT NULL
       AND rca_category <> 'unknown'
       AND created_date > now() - interval '90 days'
     GROUP BY rca_category
  LOOP
    IF rec.c >= 3 THEN
      INSERT INTO blind_spot_recommendations(
        org_id, canonical_service, rca_category,
        incident_count, predicted_impact_pct, status
      )
      VALUES (
        _org, _service, rec.rca_category,
        rec.c, round((rec.c::numeric / total) * 100, 1), 'active'
      )
      ON CONFLICT (org_id, canonical_service, rca_category) WHERE status = 'active'
      DO UPDATE SET incident_count = EXCLUDED.incident_count,
                    predicted_impact_pct = EXCLUDED.predicted_impact_pct;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_incident_blind_spot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.rca_category      IS DISTINCT FROM OLD.rca_category
     OR NEW.canonical_service IS DISTINCT FROM OLD.canonical_service THEN
    PERFORM public.recompute_blind_spots(NEW.org_id, NEW.canonical_service);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incidents_blind_spot ON incidents;
CREATE TRIGGER trg_incidents_blind_spot
  AFTER INSERT OR UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION public.trg_incident_blind_spot();

COMMIT;
