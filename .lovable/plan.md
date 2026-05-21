## Goal

Close the gaps still open after the P0–P3 schema unification, per `itisinfactjson.json`. The 5 critical-path fixes already shipped (auth routing, `resetPassword`, force-resolve artifact, resolve-failure toast, unified schema). The 11 issues below are the remainder, ordered by the spec's phase 2/3 plus the cheap deletes flagged "vestigial".

## Changes

### 1. `db/schema.sql` — add `suggestions_shown` JSONB to `incident_events`
Issue #3: telemetry is narrower than UI. Currently only `suggested_action` (rank-1) is persisted; the user actually saw top-3.

Append, idempotent, inside the existing `BEGIN`:
```sql
ALTER TABLE incident_events
  ADD COLUMN IF NOT EXISTS suggestions_shown JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE incident_events DROP CONSTRAINT IF EXISTS incident_events_suggestions_is_array;
ALTER TABLE incident_events
  ADD CONSTRAINT incident_events_suggestions_is_array
  CHECK (jsonb_typeof(suggestions_shown) = 'array');
```
Re-runnable; no backfill needed (default `[]`).

### 2. `src/components/SuggestionsBox.jsx` → expose the full ranked list upward
- Compute `ranked` as `{ source, items: string[] }` (top-3, same logic).
- Add new prop `onRankedChange?: (ranked) => void`; call it in a `useEffect` whenever `ranked` changes.
- Add an explicit empty-state row when **service has zero patterns** (issue #9): `"No history for {service} yet — using heuristics."` shown above the heuristic list.

### 3. `src/pages/IncidentDetail.jsx` → lift ranked suggestions into state
- `const [ranked, setRanked] = useState({ source: 'heuristic', items: [] })`.
- Pass `onRankedChange={setRanked}` to `SuggestionsBox`.
- Pass `topSuggestions={ranked.items}` to `AddEventForm` (replacing today's single `topSuggestion`).

### 4. `src/components/AddEventForm.jsx` — persist top-3
- Accept `topSuggestions: string[]` (keep `topSuggestion` as a fallback alias for safety).
- On first-event create, set `payload.suggested_action = topSuggestions[0] ?? null` **and** `payload.suggestions_shown = topSuggestions.slice(0, 3)`.

### 5. `src/components/ResolveControls.jsx` — failure-aware scoring guard
Issue #7: `failure_count` is recorded but never used. Make resolve write reflect the spec's intent: when a previously-failed pattern is reinforced as success, leave failure_count intact (already does); but **also** drop a hard rule so a pattern with `failure_count > success_count + 1` doesn't get further-inflated on a coincidental success — append a one-line `// gap #7: scoring penalty consumed in SuggestionsBox via successRate` comment and move the actual penalty into the suggestions ranker (step 6). No DB-shape change here.

### 6. `src/components/SuggestionsBox.jsx` — apply failure penalty in ranking
Replace the secondary sort tie-breaker with a Laplace-smoothed success rate, then overlap:
```js
const successRate = p => (p.success_count + 1) / (p.success_count + p.failure_count + 2);
// sort: overlap desc, then successRate desc, then success_count desc
```
Patterns with high failure counts now sink even when overlap matches.

### 7. `src/components/DivergenceSignal.jsx` + `src/lib/artifact.js` — full-sequence divergence
Issue #11. Add a small helper `computeDivergence(events)` in `src/lib/divergence.js` that:
- iterates events sorted by `step_order`,
- for each event with a non-null `suggested_action`, compares `normalizeAction(suggested_action)` vs `normalizeAction(message)`,
- returns `{ total, diverged, firstDivergentStep, divergenceRate }`.

Wire it into:
- `DivergenceSignal` — show "{diverged}/{total} steps diverged" with the first-step detail block kept as the primary callout.
- `artifact.js` — set `diverged = result.diverged > 0` and embed the counts into `event_sequence` (`{ step, message, suggested, diverged, timestamp }`) and the markdown export ("Divergence: 2/5 steps").

### 8. `src/pages/IncidentReport.jsx` — TTR formatting + nav recovery
- Issue #4: replace `{artifact.ttr_minutes} minutes` with the existing `formatDuration` logic (compute from minutes: hours+min); fall back to `"<1m"` when null/0.
- Issue #10: add a second link in the header row — `<Link to="/">All incidents</Link>` next to "Back to incident".
- Issue #11 surfaces: show `diverged_count / total_with_suggestion` in the meta grid replacing the binary "Divergence detected" badge when richer counts are present in `event_sequence`.

### 9. `src/lib/app-params.js` — tune staleness window + externalize
Issue #6: 7 days is too wide. Change default to **4 hours** and read from env:
```js
const stalenessMs = Number(importMetaEnv.VITE_STALENESS_THRESHOLD_MS) || 4 * 60 * 60 * 1000;
export const COLD_START_PARAMS = Object.freeze({ STALENESS_THRESHOLD_MS: stalenessMs });
```
Add `VITE_STALENESS_THRESHOLD_MS` to `.env.example` with a comment.

### 10. `src/pages/IncidentDetail.jsx` — visibility-aware polling with backoff
Issue #8. Replace the fixed 10s `setInterval` with:
```js
useEffect(() => {
  if (!incident || incident.status !== 'active') return;
  let delay = 10_000;
  let timer;
  const tick = async () => {
    if (document.visibilityState === 'visible') {
      await load();
      delay = 10_000;                 // reset on visible tick
    } else {
      delay = Math.min(delay * 2, 5 * 60_000); // cap at 5 min
    }
    timer = setTimeout(tick, delay);
  };
  timer = setTimeout(tick, delay);
  const onVis = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); delay = 10_000; tick(); } };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
}, [incident, load]);
```

### 11. Error boundary — wire into App root, delete dead `.ts` siblings
Issue #14. Create `src/components/ErrorBoundary.jsx` (class component) that renders a minimal fallback (mirroring the HTML in `error-page.ts`: "This page didn't load" + Try again / Go home buttons) and logs `componentDidCatch` to console. Wrap `<AuthenticatedApp />` in `src/App.jsx` with `<ErrorBoundary>`.

Then delete:
- `src/lib/error-capture.ts` (server-side h3 plumbing — no server)
- `src/lib/error-page.ts` (replaced by the React boundary fallback)

### 12. Delete vestigial deployment config
Issue #13. Delete:
- `wrangler.jsonc` (points at non-existent `src/server.ts`, names a TanStack Start app this project no longer is)

## Out of scope (deliberate scope cuts, per spec's "Defer" list)
- Calibration / review UI for pattern thresholds (issue #2 minimal-fix's "review UI").
- Distribution logging of overlap scores.
- Embeddings / semantic symptom matching.
- Anti-pattern surfacing in `SuggestionsBox`.

## Technical notes
- Schema change in (1) is additive + idempotent; safe to re-run `db/schema.sql` against existing DBs.
- `topSuggestions` prop is backwards-compatible (`AddEventForm` falls back to `topSuggestion` when array is empty), so the change is staged.
- The 4-hour staleness default can be lengthened per-deploy via env without a code change.
- The polling change keeps the same 10s baseline for foregrounded tabs; only background tabs back off.

## Verification
1. `bun run build` clean.
2. Apply updated `db/schema.sql` to Supabase (re-run is safe).
3. Smoke flow:
   - new incident → first action logged → confirm `incident_events.suggestions_shown` has 1-3 items.
   - resolve as failure → re-open same fingerprint → confirm the failed action sinks vs. a fresh success.
   - load `/incident/:id/report` → "All incidents" link works; TTR shows `1h 23m`, not `83 minutes`; divergence shows `2/5 steps` when applicable.
   - Hide the tab for 60s → return → poll interval reset to 10s (DevTools network panel).
   - Force a throw inside `Home` (temp) → ErrorBoundary fallback renders with Try again / Go home.
