#!/usr/bin/env bash
# OFFLINE / SYNTHETIC ONLY: GitHub Actions temporary PostgreSQL container.
# Never accepts a database URL, credentials, project ref, or remote hostname.
set -euo pipefail
pg_container="${1:?Expected disposable GitHub Actions postgres service container ID}"
database="agent_release_rehearsal"
worklog="/tmp/agent-release-rehearsal.log"
if [[ ! "$pg_container" =~ ^[a-f0-9]{12,64}$ ]]; then
  echo "Only a disposable local Docker container ID is accepted"; exit 1
fi
psql_local() {
  docker exec -i "$pg_container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 "$@"
}
echo "Creating independent synthetic release rehearsal database"
docker exec "$pg_container" createdb -U postgres "$database"
for file in \
  tests/agent-db/00_fixture.sql \
  tests/agent-db/22_live_sequence_fixture.sql \
  tests/agent-db/55_commission_fixture_columns.sql \
  tests/agent-db/01_live_inventory_audit_fixture.sql \
  tests/agent-db/56_live_credit_guards_fixture.sql; do
  echo "Preparing synthetic schema: $file"
  psql_local < "$file" > "$worklog" || { cat "$worklog"; exit 1; }
done

# Execute the EXACT reviewed phase manifest, not the interleaved CI test
# sequence. Owner manager record seeded only AFTER stage 01 created table.
node -e '
const fs=require("node:fs");
const m=JSON.parse(fs.readFileSync("supabase/agent-foundation/RELEASE_MANIFEST_REVIEW_ONLY.json","utf8"));
if(m.production_execution!=="PROHIBITED_UNTIL_SEPARATE_EXPLICIT_OWNER_APPROVAL"||
   m.phases.length!==3||m.phases.flatMap(p=>p.files).length!==27)process.exit(2);
for (const p of m.phases) for (const f of p.files) {
 if(!f.startsWith("supabase/agent-foundation/")||!f.endsWith("_NOT_APPLIED.sql")||
   !fs.existsSync(f))process.exit(3);
 process.stdout.write(p.id+"|"+f+"\n");
}' > /tmp/rehearsal-manifest.txt

while IFS='|' read -r phase file; do
  echo "Rehearsing $phase: $file"
  psql_local < "$file" > "$worklog" || {
    echo "Staged release manifest failed at: $file"
    cat "$worklog"; exit 1;
  }
  if [[ "$file" == "supabase/agent-foundation/01_schema_NOT_APPLIED.sql" ]]; then
    psql_local > "$worklog" <<'SQL'
insert into public.sales_agent_managers(auth_user_id,owner_auth_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SQL
  fi
done < /tmp/rehearsal-manifest.txt

# Release-side privilege checks: no publicly accessible quote/settings
# table, manager document counters work, and agent tables are RLS protected.
psql_local <<'SQL'
do $release_guard$
declare count_agents integer; count_rows integer; quote_number bigint;
begin
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename='quotes' and policyname='public_read_quotes') then
    raise exception 'public quote-read policy survived';
  end if;
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename='business_settings'
    and policyname='public_read_business_settings') then
    raise exception 'public settings-read policy survived';
  end if;
  if has_table_privilege('anon','public.business_settings','SELECT') then
    raise exception 'anonymous settings SELECT survived';
  end if;
  select count(*) into count_agents from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'sales_agent_%'
    and c.relkind='r' and not c.relrowsecurity;
  if count_agents<>0 then raise exception 'agent table has RLS disabled'; end if;
  select count(*) into count_rows from public.sales_agent_managers;
  if count_rows<>1 then raise exception 'owner manager seed missing'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  select public.get_next_quote_number() into quote_number;
  if quote_number is null then raise exception 'manager legacy counter unavailable'; end if;
end $release_guard$;
SQL
echo "27-file staged release manifest applied in clean synthetic PostgreSQL: PASS"
