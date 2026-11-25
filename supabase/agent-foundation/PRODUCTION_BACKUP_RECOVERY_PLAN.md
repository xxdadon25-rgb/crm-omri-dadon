# QuickStock — production backup and recovery gate (PREPARED, NOT RUN)
Last review: 2026-11-25
Target: existing Supabase project `nzmpxacaovhtmyvhtjtb` and Vercel project `crm-omri-dadon`.
Purpose: protect the current customer portal, products, stock, orders, quotes, invoices, payment/credit records, Auth identities and public document links before the agent launch.
**Status: NO BACKUP CREATED; NO RESTORE VERIFIED; DO NOT DEPLOY.**

## Strict safety conditions
1. Never change production schema, Auth accounts, data, grants, Edge functions, Vercel configuration or live agent flag during this work.
2. Never put a database password, database URL, private key, SQL dump, personal data, token, or command containing secrets in GitHub, Claude logs, terminal transcripts, the chat or `.env` files under this repository.
3. Store the backup OUTSIDE this checkout, on the operator's computer in an access-restricted directory (chmod 700) or an encrypted private location. Never commit backup files.
4. Do not reset database passwords, install Docker, start a paid service, create a new project or run restore against production as an implicit part of backup.
5. A backup is not verified until a separate throwaway destination can be restored, checked and safely discarded. If this is not available free of charge, report STOP and seek approval rather than claiming recovery readiness.

## Baseline (read-only, reconfirm before release)
- Project: `nzmpxacaovhtmyvhtjtb`, PostgreSQL 17; Supabase Free; Vercel production branch `main`.
- `public-order-pdf` deployed v5. Staged branch PDF handlers and agent migrations are not deployed.
- Previously audited: 20/20 required columns, 20/20 RLS and privileged-RPC checks PASS. Three known legacy public quote/settings reads remain for coordinated hardening.
- Current installation plan: `supabase/agent-foundation/RELEASE_MANIFEST_REVIEW_ONLY.json`, exactly 27 staged `*_NOT_APPLIED.sql` files. DO NOT APPLY during backup.

## Phase A — inventory, read-only
- Check project/DB status; inspect `supabase_migrations` migration list, Edge function names/versions and the live Vercel deployment ID/commit.
- Inventory Storage buckets and note whether actual objects need independent export. A database SQL dump includes Storage metadata, NOT uploaded object bytes.
- Inventory external secrets, functions configuration, custom domains, provider credentials, Supabase Auth/Storage configuration, external payment integrations and any background schedulers. Keep values private: record only existence and secure recovery procedure.
- Record size and critical table **counts only** (no rows/PII): customers, products, orders, invoices, payments, credit_notes, order_inventory_effects and customer_portal_access.
- Check available disk storage and database client prerequisites; if no suitable trusted export tool exists, stop without installing anything.

## Phase B — make logical backup (read-only remote; requires operator's private credentials)
Official instructions: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
Official Free-plan guidance: https://supabase.com/docs/guides/platform/backups

The Supabase CLI `db dump` produces the THREE independent logical SQL exports:
- `roles.sql` using `--role-only`
- `schema.sql` (default schema dump)
- `data.sql` using `--data-only --use-copy`

CLI versions have changed flags: first run `supabase db dump --help` and confirm the target project and the actual tool's syntax. The current docs support `--remote=<connection>` or `--db-url <connection>`. Provide the connection privately, without shell history or printed command arguments containing a password. DO NOT paste the connection into this repository or chat. Treat dump files as highly sensitive.

Example flag structure ONLY (never paste actual URL into tracked files or conversation):
```text
supabase db dump --db-url [PRIVATE_DB_CONNECTION] --role-only -f [PRIVATE_BACKUP_DIR]/roles.sql
supabase db dump --db-url [PRIVATE_DB_CONNECTION] -f [PRIVATE_BACKUP_DIR]/schema.sql
supabase db dump --db-url [PRIVATE_DB_CONNECTION] --data-only --use-copy \
  -x storage.buckets_vectors -x storage.vector_indexes \
  -f [PRIVATE_BACKUP_DIR]/data.sql
```
These are reference shapes, not a script to execute automatically. CLI may require Docker; alternatively an operator-controlled compatible `pg_dump`/libpq install can export directly without Docker if available. Confirm version compatibility with Postgres 17. Do not silently install tools.

Also export any customized `auth`/`storage` schema changes and migration history as required by Supabase official restore instructions. Never assume default dump captures all of these. Save Storage object bytes separately if any, and note how their metadata/paths match the DB snapshot. Save an inventory of Edge function source/version and Vercel production deployment IDs separately. Include off-database provider secrets/config in an operator-controlled secure record, never a plaintext archive.

## Phase C — validate backup artifact (no production writes)
- Require nonzero roles/schema/data file sizes; verify no errors, no partial dump, sufficient disk capacity.
- Generate SHA-256 hashes and a manifest for each file and separate Storage archive; keep all manifests and files private. Prefer encrypted offsite copy.
- Inspect expected CREATE/DDL and COPY/data records *locally only*, never quote customer data or credentials in console output.
- Check that the critical tables, Auth users and RLS/privilege definitions have a matching export strategy. Check archived Storage objects against bucket manifest.

## Phase D — restore rehearsal (REQUIRED BEFORE RELEASE)
- Restore into a separate disposable PostgreSQL/Supabase-compatible target, NEVER production. Explicitly verify target hostname/ref before any restore command; abort if target is `nzmpxacaovhtmyvhtjtb`.
- Follow official restore sequencing including role/schema/data, special Auth/Storage customizations, replication and Vault considerations; migration SQL already applied by the target may need reconciliation. A generic empty Postgres alone cannot demonstrate that Supabase Auth, Storage or Edge flows work.
- Compare post-restore counts for critical tables, validate invoice-to-order, payment links, credit notes, inventory effects, portal account mappings, relevant sequences, triggers, RLS and function signatures.
- Separate user-interface smoke tests: portal login/catalog/order, invoice payment -> completed order state, stock deduction/restoration, credits, anonymous quote/order/credit PDF links and manager quote/order numbering. Use fictional data in the restored environment.
- Record exact PASS/FAIL, time, artifact checksum, restore destination and any remaining unverified integrations. Do not show sensitive rows or logins.

## Recovery if a staged rollout later fails
- STOP further migrations, stop agent access and disable the UI flag after explicit approval.
- Preserve new legitimate orders/payments/credits created since backup; do not overwrite them via full-point-in-time restore.
- Vercel can roll the FRONTEND back to a verified production deployment but this does NOT undo SQL migrations, function changes or financial transactions.
- Restore Edge handlers from their recorded versions and only reverse database changes using a **reviewed tested** rollback tailored to what changed; some security revocations should NOT be reversed to public read.
- If complete DB restore is necessary, perform change-freeze, transaction reconciliation and separately approved recovery to the verified target. Never run blind destructive SQL on production.

## Release decision
**BLOCK** until (1) real backup artifacts exist privately, (2) verified restore evidence exists, (3) current live schema and affected integrations pass, (4) safe phased sequence/rollback is approved, and (5) owner explicitly approves each production step. No stage is auto-authorized by preparation.
