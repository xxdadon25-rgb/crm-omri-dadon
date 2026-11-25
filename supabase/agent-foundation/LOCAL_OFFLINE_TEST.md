# Sales-agent offline rehearsal — no production connection

Run from the GitHub feature branch `feature/sales-agents-foundation-20261123`.

## Already prepared
```bash
bash tests/agent-db/run_offline_rehearsal.sh
```

Requirements: local Docker Desktop running and Node 22 available. On macOS the script uses the built-in Bash syntax.

- Starts its own **throwaway PostgreSQL 16 Docker container** with `--network none` and **no published ports**.
- Reads the ordered SQL fixture and staged agent regression list directly from the existing GitHub Actions workflow. Runs the existing synthetic SQL/RLS test series, negative manager-seed test, and all 27 staged migrations in a second synthetic rehearsal database.
- Destroys the container on normal completion or test failure. No personal/customer production data, remote SQL URL, Supabase link or secrets are needed. Does not change Vercel or any cloud resources.
- Stops on errors; passing means **SQL/RLS synthetic rehearsal only**.

## Not yet verified — real browser workflow
This disposable PostgreSQL fixture does **not** provide Supabase Auth, PostgREST or browser-accessible APIs, and is **not** a faithful production-schema restore. Do not point Vite or any agent login at the existing Vercel preview: its preview settings currently inherit the live Supabase API connection.

For genuine browser testing, run an entirely separate **local-only Supabase Auth + Data API stack**, with fictional users and a compatible isolated schema. Ensure `VITE_SUPABASE_URL` is an explicit loopback address (e.g. `http://127.0.0.1:54321`) and that the key comes from that local stack, not from QuickStock. The 27 staged migrations must be reviewed for compatibility with that local schema before use. Then test: local agent login, assigned customer, product order, owner invoice, agent receipt/debt view and agent deactivation. Never install the agent migrations against QuickStock live without separate approval.

## Safety / readiness
This local script requires no paid Supabase project or branch. It may download the public PostgreSQL Docker image if absent. It does not modify the live CRM; it does not itself satisfy the remaining browser-auth and production-schema release gates.
