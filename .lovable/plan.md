
## Scope

From the uploaded `legaps.json` falsifier, the following are NOT yet closed and directly impact functional robustness (correctness / race safety / signal quality). Already-shipped items (G1 org RLS, G2 canonical_service backfill, error boundaries, IncidentReport home nav, age-aware polling) are out of scope.

Closing:

1. **Divergence reads the full `suggestions_shown` array, not only rank‑1** (correctness — current metric overcounts divergence)
2. **Pattern decay / recency weighting** (ranking quality — stale wins drown out fresh signal)
3. **Collision‑safe pattern reinforcement** (race under concurrent resolves on the same org/service/fingerprint/action)
4. **Migration ledger** (operational safety — knows what ran)
5. **Ranked suggestions exposed in the report** (traceability for the data we now persist)

Out of scope: LLM ranking, broader heuristic rule expansion, polling tuning, schema redesign.

## Technical changes

### New migration `db/migrations/0006_pattern_aging_and_robustness.sql`

```sql
BEGIN;

-- ---------- 1. migration ledger ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  notes       text
);
INSERT INTO schema_migrations(version, notes) VALUES
  ('0000_baseline', 'db/schema.sql'),
  ('0005_team_visibility_and_p1', 'orgs, canonical_service, G6/7/8/9'),
  ('0006_pattern_aging_and_robustness', 'last_seen_at, decay, upsert RPC')
ON CONFLICT (version) DO NOTHING;

-- ---------- 2. pattern aging columns ----------
ALTER TABLE patterns
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
UPDATE patterns SET last_seen_at = COALESCE(updated_at, created_date)
  WHERE last_seen_at = created_date;
CREATE INDEX IF NOT EXISTS patterns_last_seen_idx ON patterns(last_seen_at DESC);

-- ---------- 3. collision-safe reinforce RPC ----------
-- Single atomic upsert keyed on the existing patterns_identity_unique
-- (org_id, canonical_service, symptom_fingerprint, first_action).
-- Eliminates the read-modify-write race in ResolveControls.
CREATE OR REPLACE FUNCTION public.reinforce_pattern(
  _org uuid, _service text, _canonical text,
  _fingerprint text, _first_action text,
  _success int, _failure int
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  IF NOT public.is_org_member(_org, auth.uid()) THEN
    RAISE EXCEPTION 'not a member of org %', _org USING ERRCODE = '42501';
  END IF;
  INSERT INTO patterns(
    org_id, owner_id, service, canonical_service,
    symptom_fingerprint, first_action,
    success_count, failure_count, last_seen_at
  ) VALUES (
    _org, auth.uid(), _service, _canonical,
    _fingerprint, _first_action,
    GREATEST(_success,0), GREATEST(_failure,0), now()
  )
  ON CONFLICT (org_id, canonical_service, symptom_fingerprint, first_action)
  DO UPDATE SET
    success_count = patterns.success_count + EXCLUDED.success_count,
    failure_count = patterns.failure_count + EXCLUDED.failure_count,
    last_seen_at  = now()
  RETURNING id INTO pid;
  RETURN pid;
END $$;

COMMIT;
```

### Client changes

**`src/lib/divergence.js`** — accept the ranked `suggestions_shown` array per event and mark a step as non‑divergent if the user's action matches **any** suggestion shown (top‑3), tracking the matched rank. Falls back to current top‑1 behavior when `suggestions_shown` is absent (legacy rows).
- New `perStep` shape: `{ step, diverged, suggested, suggestionsShown, matchedRank, actual }`.
- `divergenceRate` and `firstDivergentStep` recomputed from the broader match.
- `src/lib/artifact.js` passes the richer per‑step data into `event_sequence` (`suggestions_shown`, `matched_rank`).

**`src/components/SuggestionsBox.jsx`** — recency‑weighted scoring:
```
score = overlap * 0.6 + successRate * 0.3 + recency * 0.1
recency = exp(-ageDays / 30)   // half-life ~21d
```
Sort key changes; tie‑breakers unchanged. Read `p.last_seen_at` (falls back to `updated_at`/`created_date`).

**`src/components/ResolveControls.jsx`** — replace the read/find/update-or-create block with one call:
```js
await base44.supabase.rpc('reinforce_pattern', {
  _org: await getCurrentOrgId(),
  _service: service,
  _canonical: canonicalizeService(service),
  _fingerprint: symptomFingerprint,
  _first_action: firstAction,
  _success: def.signal === 'success' ? 1 : 0,
  _failure: def.signal === 'failure' ? 1 : 0,
});
```
Removes the `patterns` prop dependency for write‑path correctness.

**`src/pages/IncidentReport.jsx`** — add a small "Suggestions shown" block per diagnostic step (collapsed by default) listing the ranked list with the chosen rank highlighted. Pulls from `event_sequence[i].suggestions_shown` + `matched_rank`. No new endpoint.

**`db/README.md`** — append a row for `0006_pattern_aging_and_robustness.sql` plus a one‑line note that the ledger now records applied versions.

## Sequencing

1. Write `db/migrations/0006_...sql` (idempotent; safe re‑run).
2. Update `divergence.js` + `artifact.js` (pure functions, no DB).
3. Update `SuggestionsBox.jsx` for recency weighting.
4. Update `ResolveControls.jsx` to call the RPC.
5. Update `IncidentReport.jsx` for ranked‑suggestion display.
6. Update `db/README.md`.

## Out of scope (deferred)

- LLM normalization, heuristic rule expansion (G19 / `getSuggestions` coverage)
- Polling tuning beyond what already exists
- Pattern decay applied at write (only ranking‑side decay in v1)
- Edge functions — none required by these changes

## What the user must do after merge

Run `db/migrations/0006_pattern_aging_and_robustness.sql` in the Supabase SQL editor. No env changes, no Edge Functions.
