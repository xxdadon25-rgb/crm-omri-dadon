#!/usr/bin/env bash
# Run the existing agent tests on a disposable, offline PostgreSQL container.
# No cloud credentials, ports, Supabase link, or production network access.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
  echo "Refusing non-default Docker connection; use a local Docker Desktop context." >&2
  exit 2
fi
if ! command -v docker >/dev/null || ! command -v node >/dev/null; then
  echo "Docker Desktop and Node 22 are required for offline rehearsal." >&2
  exit 2
fi
context="$(docker context show)"
if [[ "$context" != "default" && "$context" != "desktop-linux" ]]; then
  echo "Refusing Docker context '$context': local Docker Desktop required." >&2
  exit 2
fi
pg_container=""
cleanup() {
  if [[ -n "$pg_container" ]]; then
    docker rm -f "$pg_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
pg_container="$(docker run --rm -d --network none \
  --label quickstock.agent-test=offline \
  -e POSTGRES_PASSWORD=disposable_agent_test_only \
  -e POSTGRES_DB=postgres postgres:16)"
if [[ ! "$pg_container" =~ ^[a-f0-9]{12,64}$ ]]; then
  echo "Unexpected disposable container ID"; exit 3
fi
ready=false
for i in {1..45}; do
  if docker exec "$pg_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable PostgreSQL never became ready"; exit 3
fi
# Reuse the EXACT ordered fixture/migration/test sequence already used in CI.
# Do not guess names or execute any cloud migration.
sql_files=()
while IFS= read -r file; do
  sql_files+=("$file")
done < <(node --input-type=module - <<'NODE'
import fs from 'node:fs';
const y=fs.readFileSync('.github/workflows/agent-foundation-tests.yml','utf8');
const m=y.match(/sql_files=\(\s*([\s\S]*?)\s*\)/);
if (!m) process.exit(3);
const files=[...m[1].matchAll(/^\s*"([^"]+\.sql)"\s*$/gm)].map(x=>x[1]);
if (files.length<40 || files.some(f=>!f.startsWith('tests/agent-db/') &&
    !/^supabase\/agent-foundation\/[\w]+_NOT_APPLIED\.sql$/.test(f))) process.exit(4);
for(const f of files) {
 if(!fs.existsSync(f))process.exit(5);
 console.log(f);
}
NODE
)
if [[ "${#sql_files[@]}" -lt 40 ]]; then
  echo "Missing or invalid isolated test manifest"; exit 3
fi
for file in "${sql_files[@]}"; do
  docker exec -i "$pg_container" psql -X -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < "$file" > /dev/null || {
    echo "Offline synthetic test failed: $file"; exit 4;
  }
done
bash tests/agent-db/negative_manager_seed_gate.sh "$pg_container"
bash tests/agent-db/rehearse_release_manifest.sh "$pg_container"
echo "PASS: offline synthetic agent SQL/RLS and 27-file release rehearsal"
echo "Container removed automatically. NO remote database accessed."
