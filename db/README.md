# Database schema

`schema.sql` is the **single source of truth**. It is idempotent and forward-only.

To apply against a Supabase project: open the SQL editor in the Supabase
dashboard, paste the contents of `schema.sql`, and run. Or via psql:

```
psql "$DATABASE_URL" -f db/schema.sql
```

Re-running on an existing database produces the same end state — safe to
execute repeatedly.
