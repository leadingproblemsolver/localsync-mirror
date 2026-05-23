# Gap A — Capture Rationale on Every Logged Action

**Why this gap, why now.** The spec's `codebase_gap_registry` ranks **A** as the only `critical` gap and puts it first in `build_order` ("A and D first — without accurate capture … the feedback loop that improves everything else is broken"). It also maps directly to the prospect signal already captured for Kwasi: *"reasoning chains, signals ruled out, why rollback chosen."* Today `IncidentEvent` stores **what** happened (`message`) but has no field for **why** — so the product calls its output a "decision trace" while it is structurally an action log. Closing A turns every later feature (suggestions, divergence, postmortem, blind spots) into reasoning-aware, not just action-aware.

Scope is deliberately narrow: one optional field, one secondary input, one subdued render, one export line. No behavior change for users who skip it.

## What changes (user-visible)

1. **AddEventForm** gets a second, smaller textarea under the action input: *"Why? (optional — signals ruled out, what made you pick this)"*. Empty rationale is allowed and is the common case.
2. **EventTimeline** renders the rationale as a subdued italic line beneath the action when present. Nothing shown when absent — no empty placeholder.
3. **IncidentReport / markdown export** includes rationale on its own indented line per step when present.
4. **artifact.js `eventSequence`** carries `rationale` so downstream consumers (artifact row, postmortem JSON) keep the field.

Nothing else changes: divergence math, suggestions ranking, patterns, RLS, and step counting are untouched.

## Files to edit

```text
db/migrations/0007_event_rationale.sql   NEW   add nullable column + comment
src/components/AddEventForm.jsx          EDIT  second textarea, include in payload
src/components/EventTimeline.jsx         EDIT  render rationale when present
src/lib/artifact.js                      EDIT  include rationale in eventSequence + markdown
src/pages/IncidentReport.jsx             EDIT  render rationale in per-step block
db/README.md                             EDIT  log 0007
```

No schema changes to `patterns`, `incidents`, or RLS. No new RPCs.

## Technical details

### Migration `0007_event_rationale.sql` (idempotent, forward-only)

```sql
BEGIN;

ALTER TABLE incident_events
  ADD COLUMN IF NOT EXISTS rationale text;

COMMENT ON COLUMN incident_events.rationale IS
  'Optional free-text "why" for this step: signals ruled out, reasoning, ' ||
  'why this action was chosen. Captured at log time. Nullable by design — ' ||
  'most steps will not have one and that is fine.';

INSERT INTO schema_migrations(version, notes) VALUES
  ('0007_event_rationale', 'optional rationale on incident_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

No RLS change needed: existing `incident_events` policies already gate by parent incident's org/membership.

### AddEventForm.jsx

- Add `rationale` local state (string), reset on submit.
- New textarea (`rows={2}`, muted styling, placeholder "Why? Signals ruled out, what made you pick this (optional)").
- `payload.rationale = rationale.trim() || null` — only send when non-empty so PostgREST leaves nullable default alone for empty.
- ⌘↵ still submits.

### EventTimeline.jsx

- After the existing `{event.message}` block, render:

```jsx
{event.rationale ? (
  <div className="mt-1 pl-4 border-l border-border/40 font-mono text-xs italic text-muted-foreground/70">
    {event.rationale}
  </div>
) : null}
```

Keeps current visual hierarchy intact; rationale reads as annotation, not co-equal content.

### artifact.js

- In the `eventSequence.map`, include `rationale: e.rationale || null`.
- In `generateMarkdownExport`, when a step has rationale, emit:

```text
**[3]** Rolled back deploy abc123  _(diverged)_  `14:32:10`
    > why: traffic dropped on new pod but old pod was healthy
```

(Indented `> why:` line; only when present.)

### IncidentReport.jsx

- In the per-step block (next to "Suggestions shown"), if `e.rationale` is set, render a subdued "Why" row using the same border-left treatment as the timeline.

## Failure modes considered

- **Legacy rows have `rationale = NULL`** — every read site uses `e.rationale || null` / truthy check, so old incidents render identically to today.
- **PostgREST write of unknown column** — blocked until migration 0007 is deployed. Mitigation: deploy migration *before* shipping client. README updated to call this out.
- **User pastes a wall of text** — no length cap in MVP; field is `text`. Worth revisiting if abuse appears, but premature now.
- **Pattern reinforcement** — explicitly out of scope. Rationale is *not* fed into `reinforce_pattern` or fingerprinting in this gap; that would be Gap C territory and changes the pattern identity surface.

## Out of scope (named so it stays out)

- Gap D (semantic divergence via `overlapScore`) — separate change, separate plan.
- Gap C (resolution summary on Pattern) — would consume rationale, but only after A is live and producing data.
- Any UI prompt that forces rationale entry. Optional means optional; coercion would tank logging speed and violate the "behavior over structure" rule in `lean_build_engine`.
- Backfill of historical events. They stay null.

## Verification

1. Run migration; confirm `\d incident_events` shows `rationale text` and `schema_migrations` has `0007_event_rationale`.
2. Open an incident, log a step with rationale → reload → rationale persists, renders italic.
3. Log a step without rationale → renders exactly as today.
4. Export markdown → step with rationale shows indented `> why:` line; step without doesn't.
5. Open a pre-migration incident → all old events render unchanged.

## Build order

1. Migration file
2. AddEventForm (write path)
3. EventTimeline (read path)
4. artifact.js + IncidentReport.jsx (export path)
5. db/README.md note
