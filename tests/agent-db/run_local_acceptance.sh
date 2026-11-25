#!/usr/bin/env bash
# Local, synthetic-only acceptance rehearsal. No production connection.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Prevent accidentally running the app with a production Supabase URL.
# The SQL rehearsal itself always uses an offline Docker network.
if [[ -n "${DATABASE_URL:-}" || -n "${SUPABASE_DB_URL:-}" || -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Refusing: database URL or Supabase access token present in environment." >&2
  exit 2
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Node.js 22 and npm are required." >&2
  exit 2
fi

echo "[1/3] Agent logic and session/permissions tests (offline)"
node --test tests/agentPermissions.test.js tests/agentCommission.test.js \
  tests/agentMarginDecision.test.js tests/agentExceptionApproval.test.js \
  tests/agentSqlContracts.test.js tests/agentExistingProfitParity.test.js \
  tests/agentOrderForm.test.js tests/agentDocumentTotal.test.js \
  tests/agentRepeatOrder.test.js tests/agentDormantCustomers.test.js \
  tests/publicDocumentSecurity.test.js tests/agentApprovedWorkflow.test.js \
  tests/agentRequestRetry.test.js tests/agentAuthSession.test.js \
  tests/agentReleaseManifest.test.js tests/agentCollections.test.js \
  tests/agentDashboard.test.js

echo "[2/3] Synthetic PostgreSQL: agent -> manager -> invoice -> receipt"
bash tests/agent-db/run_offline_rehearsal.sh

echo "[3/3] Compile local frontend against localhost-only placeholder settings"
if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts
fi
VITE_ENABLE_SALES_AGENTS=true \
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_ANON_KEY=offline-placeholder-not-a-credential \
  npm run build

echo "PASS: offline acceptance tests and frontend compilation. No live database contacted."
echo "NOTE: real browser sign-in still requires a separate local Auth/PostgREST stack."
