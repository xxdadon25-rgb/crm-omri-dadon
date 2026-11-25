# QuickStock sales agent — isolated local acceptance

This is a **synthetic, offline rehearsal**, not production installation, a live login or a deployed preview.

## One command (from the feature branch)

On a Mac with **Docker Desktop running** and **Node.js 22** installed:

```bash
bash tests/agent-db/run_local_acceptance.sh
```

This runs (1) agent permissions/order/commission logic tests, (2) all existing staged migrations and synthetic SQL/RLS workflows inside a temporary `postgres:16` Docker container using `--network none`, including agent order → manager invoice → assigned customer visibility and the 27-file rehearsal, and (3) a Vite build with **localhost placeholder** Supabase settings and agent UI enabled for compilation.

No existing QuickStock credentials are required. Do not copy production `.env` values, connect a production API, or deploy the resulting `dist`. The local PostgreSQL container is removed on completion, including failure. The script will not execute if explicit `DATABASE_URL`, `SUPABASE_DB_URL` or `SUPABASE_ACCESS_TOKEN` is present.

The helper's current security constraints are important: local Docker Desktop only; refuses alternate Docker contexts and Docker host variables; synthetic fixtures only; no published TCP port; no network inside the PostgreSQL container.

A **passing run is NOT real-browser E2E**: the application still lacks a dedicated local Supabase Auth/PostgREST/Edge stack with agent and owner login sessions. In particular, a Vercel preview uses shared Supabase settings and must **not** be used for write testing against QuickStock.

## Release remains blocked

Do not apply any `_NOT_APPLIED.sql` file to QuickStock, enable the Vercel flag, register a real agent or merge the branch based only on this rehearsal. Before release, separately arrange a schema-faithful isolated rehearsal, customer portal/public-document verification, and a complete agent/owner browser journey with a genuinely separate database; explicit owner approval remains required.
