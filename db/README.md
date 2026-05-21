# Database schema

`schema.sql` is the **original V1 source of truth** (owner-scoped RLS).

Forward-only migrations live in `db/migrations/` and must be applied **in
filename order** on top of `schema.sql`:

| File | Adds |
|---|---|
| `0005_team_visibility_and_p1.sql` | Organizations + memberships (G1), canonical_service (G2), richer resolution states (G8), deferred postmortem (G7), blind-spot inference (G9) |

To apply against a Supabase project: open the SQL editor in the Supabase
dashboard, paste the contents of each file, and run in order. Or via psql:

```
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/migrations/0005_team_visibility_and_p1.sql
```

Every file is idempotent — re-running converges to the same end state.

## After 0005 is applied

- A personal organization is auto-created for every existing user, and for
  every new user via the `on_auth_user_created` trigger.
- All RLS for `incidents`, `incident_events`, `artifacts`, and `patterns`
  is org-scoped via `public.is_org_member(org_id, auth.uid())`.
- Pattern unique key is `(org_id, canonical_service, symptom_fingerprint, first_action)`.
- Resolved incidents without a root cause are flagged `rca_status='pending'`
  with a `rca_prompt_due = resolved_at + 24h` for the Home prompt.
- Blind-spot recommendations are recomputed by trigger whenever an incident
  gains or changes `rca_category`.
