
# P0+P1 Open Gaps Implementation Plan

Scope: G1, G2 (P0) + G6, G7, G8, G9 (P1). Six gaps, ordered from data layer up. Each gap has its own pass/fail metric from the registry.

## G1 — Team visibility (orgs + memberships)

Replace per-`owner_id` RLS with org-scoped RLS so teammates see each other's incidents.

**Schema migration** (`supabase/migrations/<ts>_orgs.sql`):
- New tables:
  - `organizations(id uuid pk, name text, slug text unique, created_date timestamptz)`
  - `org_members(org_id uuid, user_id uuid, role text check in ('owner','admin','member'), joined_at timestamptz, pk(org_id,user_id))`
- Add `org_id uuid references organizations` to `incidents`, `patterns`, `artifacts`. `incident_events` inherits via parent incident.
- Backfill: for each existing `owner_id`, create a personal org `{user}'s workspace`, set membership owner, copy into `org_id`. Make `org_id NOT NULL` after backfill.
- Security definer fn `is_org_member(_org uuid, _user uuid) returns boolean` to avoid recursive RLS.
- Replace all `owner_id = auth.uid()` policies with `is_org_member(org_id, auth.uid())`. `incident_events` policy joins through incident. Insert WITH CHECK requires membership.
- Drop old `patterns_identity_unique (owner_id, service, symptom_fingerprint, first_action)` and recreate keyed on `(org_id, service, canonical_service, symptom_fingerprint, first_action)` — see G2.
- Trigger `auto_create_personal_org()` on new auth.users via `handle_new_user` — creates an org named `<email-local>` and inserts the user as `owner`. Stores resulting `org_id` for client default.

**Client**:
- `src/lib/org.js`: `getCurrentOrgId()` — loads from `org_members` by `auth.uid()`, caches in memory; falls back to first membership. Single-org per user in V1.
- `base44Client.js`: extend `createEntityClient` with an optional `withOrg` flag; on `create`, auto-stamp `org_id` from `getCurrentOrgId()`. Keep `owner_id` writes for audit (who created), gated behind a `created_by` rename later.
- Update `NewIncident`, `ResolveControls` (pattern create), artifact create paths to call the org-aware client.
- Replace `FEATURE_FLAGS.P2_USER_ISOLATION` reads with org stamping unconditionally.

**Test metric**: two users in same org each create one incident; each sees both in `Home` list; both can append events to either; no RLS rejections.

## G2 — Service name normalization

Canonical bucket per logical service so `payments-api ≠ payment-api ≠ payments` collapses.

**Lib** (`src/lib/service.js`):
- `canonicalizeService(name)`: lowercase → trim → collapse whitespace → replace non-alphanum with `-` → strip leading/trailing `-` → drop common suffixes `-api|-svc|-service`. Pure, unit-testable.
- Examples: `Payments-API` → `payments`, `payment_api` → `payment`, `payments` → `payments`. Plural stays; we don't stem.

**Schema migration**:
- Add `canonical_service text` to `incidents`, `patterns`, `artifacts` (generated column not used — computed in client + backfilled).
- Backfill: `UPDATE incidents SET canonical_service = lower(regexp_replace(...))` mirroring client logic; same for patterns/artifacts.
- New unique key on patterns: `(org_id, canonical_service, symptom_fingerprint, first_action)`.
- Index `incidents(canonical_service, symptom_fingerprint)`, `patterns(canonical_service, symptom_fingerprint)`.

**Client**:
- `NewIncident` stamps `canonical_service` on create alongside `service` (kept as displayed name).
- `SuggestionsBox` pattern lookup uses `canonical_service` filter, not raw `service`.
- `ResolveControls` writes patterns keyed by `canonical_service`.
- `Home` displays original `service`; grouping/dedup keys use `canonical_service`.

**Test metric**: create 3 incidents with `Payments-API`, `payments`, `payment_api`; on the 4th matching the same canonical key, patterns from all 3 surface in `SuggestionsBox`.

## G6 — Live divergence (mid-incident)

Show nudge during active incident when first action diverges, not only after resolution.

**`DivergenceSignal.jsx`**:
- Accept `mode: 'live' | 'postmortem'`.
- In `live` mode, compute on every event ≥ 2 with a suggestion present; render a small inline banner: "Your trace has diverged from the suggested path at step N — `<suggested>` vs `<actual>`." Dismissible with `localStorage` per-incident key. Non-blocking.
- In `postmortem` mode, render existing summary (unchanged).

**`IncidentDetail.jsx`**:
- When `isActive` and `events.length >= 2`, render `<DivergenceSignal events={events} suggestions={ranked.items} mode="live" />` above the event timeline.

**Test metric**: active incident with step 1 diverging from rank-1 suggestion shows the live nudge by step 2.

## G7 — Deferred postmortem (RCA non-blocking at resolve)

**`ResolveControls.jsx`**:
- Make `root_cause_note` field optional; remove any required validation. Helper text: "You can add this later — we'll prompt you in 24h."
- On submit with empty RCA, set `incident.rca_status = 'pending'`.

**Schema**:
- Add `rca_status text check in ('pending','complete') default 'pending'` to `incidents`. Set `complete` when `root_cause_note` is non-empty (trigger).
- Add `rca_prompt_due timestamptz` defaulting to `resolved_at + interval '24 hours'`.

**Client**:
- `Home.jsx`: show a "Pending postmortem" chip + "Complete postmortem" button on resolved incidents past `rca_prompt_due` with `rca_status='pending'`.
- `IncidentDetail.jsx`: allow editing `root_cause_note` post-resolution while `rca_status='pending'` (input field surfaces on resolved view). Saving flips status to `complete`.
- `artifact.js`: mark RCA as `[Pending]` in markdown until completed; regenerates artifact on RCA save.

**Test metric**: resolving without RCA succeeds; 24h later a "Complete postmortem" prompt appears; filling it updates the artifact and removes the prompt.

## G8 — Richer resolution states

Replace binary `success/failure` with `mitigated | resolved | rolled-back | escalated`.

**Schema migration**:
- Drop `incidents_outcome_valid` and `artifacts_outcome_valid` CHECK; recreate as `IN ('mitigated','resolved','rolled-back','escalated')`.
- Backfill: existing `success` → `resolved`, `failure` → `rolled-back`. Document in migration comment.
- Add column `pattern_outcome text generated always as (case outcome when 'resolved' then 'success' when 'mitigated' then 'success' when 'rolled-back' then 'neutral' when 'escalated' then 'failure' end) stored` for pattern reinforcement mapping.

**Client**:
- `ResolveControls.jsx`: replace two-button success/failure with four-option select (radio group with descriptions). Default `resolved`.
- Pattern reinforcement (`ResolveControls`): increment `success_count` only when `pattern_outcome='success'`; increment `failure_count` only when `pattern_outcome='failure'`; `neutral` (rollback) increments neither. This preserves G3's causal-confirmation gate.
- `Home.jsx` + `IncidentDetail.jsx`: map outcome to color + label (resolved=green, mitigated=teal, rolled-back=amber, escalated=red).
- `artifact.js`: render new outcome verbatim in markdown.

**Test metric**: resolving as `rolled-back` does NOT auto-stamp pattern failure; resolving as `resolved` increments `success_count`; UI shows distinct chips for each state.

## G9 — Blind Spot Inference

Aggregate ≥3 incidents on a service sharing a root-cause category into a recommendation.

**RCA categorization**:
- `src/lib/rca.js`: `categorizeRca(text)` → one of `['deploy','config','dependency','capacity','data','unknown']` via keyword match (regex table). Pure function, no LLM (kept in scope).
- On RCA save (G7 path), compute and persist `rca_category` on `incidents`.

**Schema**:
- Add `rca_category text` to `incidents`. Index `(canonical_service, rca_category)`.
- New table `blind_spot_recommendations(id uuid pk, org_id uuid, canonical_service text, rca_category text, incident_count int, predicted_impact_pct numeric, status text check in ('active','dismissed','actioned') default 'active', created_date timestamptz, dismissed_at timestamptz, unique(org_id, canonical_service, rca_category) where status='active')`. RLS via org membership.
- Edge function or DB trigger `recompute_blind_spots(_service text)` runs after RCA save: counts last-90d incidents per (org, canonical_service, rca_category); if ≥3, upserts active recommendation with `predicted_impact_pct = round(count_in_category / total_in_service * 100, 1)`.

**Client**:
- New panel on `Home.jsx`: "Blind spots" section listing active recommendations with predicted impact and `Dismiss` / `Mark actioned` buttons (writes status + timestamp).
- Hide section when none active.

**Test metric**: after 3 incidents on `payments` with `rca_category='deploy'`, a recommendation appears with impact %; clicking dismiss/action updates status and persists.

## Sequencing

1. **Migrations first** — single SQL file applied in order: orgs → canonical_service → outcome states → rca + blind spots. Each block idempotent.
2. **Lib utilities** — `org.js`, `service.js`, `rca.js`. Unit-testable, no UI.
3. **Client wiring** — `base44Client` org stamping, then `NewIncident`, `SuggestionsBox`, `ResolveControls`, `IncidentDetail`, `Home`.
4. **Smoke checklist** at the end matching each gap's test_metric.

## Out of scope (P2/P3 deferred)

INC-{n} slugs, alert URL/severity, post-resolution editing window, evidence URLs, ColdStartRepair relabel, Home filters, LLM normalization, webhook ingest, pattern decay, SSO, exports, deletes, Stripe removal. These remain open and will need follow-up plans.

## Risk notes

- The orgs migration is the largest single change; the personal-org backfill must run before `org_id NOT NULL` and before policy swap, in one transaction.
- Pattern unique key changes from `(owner_id, ...)` to `(org_id, canonical_service, symptom_fingerprint, first_action)` will collapse duplicate rows where teammates trained the same pattern; migration must `DELETE` lower-count duplicates or `SUM` counts before reindex. Plan: `SUM` into the surviving row by (org, canonical_service, fingerprint, first_action).
- `pattern_outcome` as a generated stored column requires recreating the column if outcome values change; migration will guard with `DROP COLUMN IF EXISTS` first.
