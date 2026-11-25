#!/usr/bin/env bash
# Disposable CI postgres ONLY. Verify stage 26's actual SQL safely fails
# before replacing legacy functions when an owner manager seed is missing.
set -euo pipefail
pg_container="${1:?Pass disposable postgres Docker container ID}"
log=/tmp/agent-owner-seed-negative.log

if {
  printf "BEGIN;\nDELETE FROM public.sales_agent_managers WHERE auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';\n"
  cat supabase/agent-foundation/26_manager_only_sequence_wrappers_NOT_APPLIED.sql
} | docker exec -i "$pg_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 > "$log" 2>&1; then
  echo "ERROR: stage 26 accepted a missing owner-manager seed"
  exit 1
fi
if ! grep -q "owner_manager_identity_not_seeded" "$log"; then
  echo "ERROR: stage 26 failed for an unrelated reason"
  cat "$log"
  exit 1
fi

# The client connection fails during the explicit open transaction, which
# must rollback the DELETE and preserve previously-installed numbering.
docker exec -i "$pg_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $check_rollback$
declare n integer; next_number bigint;
begin
  select count(*) into n from public.sales_agent_managers
  where auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and owner_auth_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n<>1 then raise exception 'owner identity not restored on failure'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  select public.get_next_quote_number() into next_number;
  if next_number is null then raise exception 'quote numbering stopped'; end if;
end $check_rollback$;
SQL
echo "Missing-owner migration rollback: PASS"
