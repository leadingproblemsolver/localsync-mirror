# Supabase Edge Functions

**Status: none. This project ships zero Supabase Edge Functions.**

Deploy nothing under `supabase/functions/` for this codebase. If your
Supabase dashboard currently lists edge functions for this project, they
are **not** required by the client and can be left alone (or removed) —
the React app never calls `supabase.functions.invoke(...)` anywhere.

```
$ rg "functions\.invoke|supabase/functions" src/
(no matches)
```

---

## Why there are none

The original V1 plan referenced a `recompute_blind_spots()` edge function
for G9 (Blind Spot Inference). During implementation it was moved into
the database as a **Postgres trigger + SECURITY DEFINER function** so it
runs transactionally with the incident write, with no network hop and no
extra deploy surface.

All server-side logic for this app lives in:

- `db/schema.sql` — base tables, RLS, original triggers
- `db/migrations/0005_team_visibility_and_p1.sql` — orgs, canonical
  service, richer outcomes, deferred postmortem, blind-spot recompute

Everything else (suggestions, divergence scoring, fingerprinting,
canonicalization, RCA categorization, staleness) runs **client-side** in
`src/lib/*.js` against the standard PostgREST endpoints exposed by
Supabase. No custom HTTP function is required.

---

## Deploy checklist (Supabase)

In the dashboard for your project, you only need:

| Area | Action |
|---|---|
| **Database → SQL Editor** | Run in order, each idempotent: `db/schema.sql` → `db/migrations/0005_team_visibility_and_p1.sql` → `db/migrations/0006_pattern_aging_and_robustness.sql` → `db/migrations/0007_event_rationale.sql`. |
| **Authentication → Providers** | Enable Email (password). Enable Google OAuth if you want the social login button to work — set redirect to `${SITE_URL}/`. |
| **Authentication → URL Configuration** | Set Site URL to your deployed origin. Add `${SITE_URL}/reset-password` to Redirect URLs (used by `auth.resetPasswordForEmail`). |
| **Project Settings → API** | Copy Project URL → `VITE_SUPABASE_URL`. Copy `anon` public key → `VITE_SUPABASE_ANON_KEY`. |
| **Edge Functions** | **Skip. None to deploy.** |
| **Storage** | **Skip. No buckets used.** |
| **Secrets / Function env vars** | **Skip. None required.** |

---

## Client env vars (for completeness)

These are the only values the app reads at runtime. Put them in your
hosting provider's environment (or `.env.local` for dev):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>

# Optional, defaults to 4h. Milliseconds before an active incident is
# treated as stale by the cold-start repair UI.
VITE_STALENESS_THRESHOLD_MS=14400000
```

No service-role key, no function-scoped secrets, no webhook signing
secrets — none of those code paths exist in this build.

---

## If you add edge functions later

Future gaps that *would* introduce edge functions (kept here so you
remember the trigger conditions, not because they exist today):

| Gap | Function name (proposed) | Trigger to add |
|---|---|---|
| G19 | `normalize-service-llm` | If `canonicalizeService()` regex rules prove insufficient and you wire in an LLM rewrite. |
| G20 | `ingest-alert-webhook` | If you accept inbound PagerDuty / Grafana / Opsgenie webhooks. Needs `verify_jwt = false` plus an HMAC shared secret. |
| G23 | `export-postmortem` | If you push artifacts to Slack / Linear / Jira on resolve. |
| G22 | `sso-saml-callback` | If you add enterprise SSO. |

Until one of those ships, this file should keep saying **none**.
