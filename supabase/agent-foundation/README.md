# QuickStock sales agents — implementation checkpoint (NOT LIVE)

This branch contains **preparatory code only**. It does **not** create an agent,
activate a role, change existing RLS, alter historical business records, change
stock, send WhatsApp, or update production. **Do not merge or run the SQL yet.**

## Confirmed requirements

- Keep existing manager/Ben workflows unchanged; same QuickStock UI, agent-scoped data.
- Agent owns new customers, can also view assigned existing customers and history.
  Unassignment revokes read access. Attribution belongs to the creator of the sale,
  not the customer's current assignee.
- Agents can view product purchase/sale prices, never edit pricing or inventory.
- Agent order must have >= 40% **gross margin on the entire order**, before VAT,
  using `documentProfit` and packaging normalization; unknown costs block save.
- Below 40%: send exception details to both managers via configured WhatsApp,
  manager approves or rejects inside authenticated QuickStock; exactly one decision
  is effective. Approval binds to the precise payload and current cost data.
  Pending exceptions do NOT create inventory movements, deliveries or invoices.
- Accepted agent order creates one pending-delivery alert showing agent name.
  Fulfillment and financial payment/completion remain independent.
- Dashboard reuses existing layout with agent-scoped metrics.
- Commission is **8% of collected, settled, pre-VAT receipts attributable to the
  agent's own orders**. Partial payments count proportionally; grouped payments
  are allocated by invoice; refunds reverse accrual; unpaid or postdated checks
  do not count; attribution stays with original seller. Store paid-out status.
- Fast repeat order and an unobtrusive reminder for assigned dormant customers.

## Verified current system findings (2026-11-23)

1. `AuthContext.jsx` treats a hardcoded staff email / membership as *full admin*;
   `ProtectedRoute.jsx` does not distinguish manager from agent.
2. `customers`, `orders`, `invoices`, `payments` use owner `user_id`
   policies. An agent account does not automatically see those rows. Granting
   access by reusing the owner's credentials or setting `user_id` is forbidden.
3. Existing order RPCs `create_order_with_inventory` and
   `save_order_with_inventory` are SECURITY DEFINER and callable by
   authenticated users. They need role, assignment, order attribution, and
   margin checks **inside the server**; hiding controls is not security.
4. Legacy `customers_delete` and `products_delete` policies have
   `USING (true)` for PUBLIC. These must be corrected in a separately
   audited migration, proving manager workflows and portal access unchanged.
5. Product packaging and order line totals matter; comparing `buy_price *
   quantity` is incorrect. `documentProfit` is the reference behavior,
   but a trusted server implementation must recompute from DB product
   records and compare to that reference using fixtures.
6. A payment can be split over multiple invoices with `payment_group_id`.
   `payment_date`, status, and check clearing need distinct verification.
7. A legacy `orders.agent` is free text, not an authorization/attribution key.
8. The owner and Ben deliberately share ONE authenticated manager account.
   Keep this login unchanged. On exception approval, the human selects
   \"עומרי\" or \"בן\"; record the selected name as a self-declared label
   alongside the shared authenticated manager ID and decision timestamp.
   This is NOT independent verification of the individual person.

## Build sequence (safe, small phases)

**Gate A — identity + isolation**
1. Validate the existing shared manager auth ID and protect the existing app.
2. Add role detection with fail-closed states; server-level policy tests for
   agent/manager/portal/unauthenticated direct REST, including deletes.
3. Add customer assignments and scoped product read visibility. Never expose
   supplier/stock mutation or other clients' financial information.
4. Test direct URL and direct API bypass, not only sidebar filtering.

**Gate B — agent order lifecycle**
5. Agent creates customer, only within assigned owner business.
6. Atomic order RPC: authenticate agent; lock assignment; normalize historical
   packaging cost; enforce margin >= 40%; persist attribution and delivery alert.
7. Exception request is an inert draft; manager approval is single-winner,
   verifies fresh content/cost hash; successful order created exactly once.
8. Existing non-agent order and fulfillment flows must be regression-tested.

**Gate C — reporting/commission**
9. Invoice lineage across regular and monthly combined invoices, credit notes,
   partial/combined receipts. Disambiguate legacy receipts not clearly linked
   to orders; never guess attribution. Only settled receipts create entries.
10. Dashboard: reuse real charts and cards with server-scoped data; manager
    drilldown by agent; 8% immutable earned and paid ledger.
11. Repeat order and inactive customer reminders; no excessive GPS/routes.

**Gate D — notification/rollout**
12. Verify the existing WhatsApp Business number and approved API/message
    template; no assumption of free automated messaging. If not available,
    use only manager's authenticated in-app exception queue until connected.
13. QA with test agent and demo customer, no historical data changes or test
    inventory leakage; verify zero access to other clients and margin bypass.
14. Backup/restore check + rollout decision; activate only after production
    security gate and explicit review of impact.

## Current status

- DONE in separate branch: inactive UI role guards, pure margin and commission
  calculations, named approver selection and single-decision UI guard.
- STAGED but NOT APPLIED: SQL 01 (isolated tables), 02 (manager decision),
  03 (active-agent read-only assignment scope), 04 (owner-only customer/product
  delete policies), 05 (direct agent write restriction), 06 (atomic new customer
  enrollment), 07 (catalog-based same-unit margin preview), 08 (atomic basic agent
  order, immutable attribution, one delivery alert). These files **must not run
  against live Supabase**.
- DONE: GitHub Actions unit tests and static SQL contract tests. These tests
  are not substitutes for actual RLS access tests with separate auth identities.
- PENDING: full direct-RPC/security-definer audit, isolated Supabase clone/
  restored snapshot, DB authentication tests with owner/agent/portal/anon,
  full verification of packaging-based 40% parity and documented discounts,
  order updates and exception-approved order flow, order association with invoices
  including monthly-batched invoices, payment-settlement commission ledger,
  operational dashboards and delivery flow, WhatsApp, UI integration,
  regression checks and production rollout.
- Important: manager shared login continues unchanged. The chosen "עומרי"/"בן"
  is a human-entered label on the decision, not verified individual identity.
- No agent created, no schema executed in Supabase, no operational customers/
  orders/invoices/payments/product inventory changed, and no production deploy.


## Cost handling — owner decision, 2026-11-23

Use QuickStock's EXISTING catalogue purchase prices and the existing
`documentProfit` / `cartProfit` / `packagingMath` rules; do NOT create an
extra cost verification queue or ask the owner to re-verify all products.
Stage 07 now reads current `products.buy_price` directly and matches the
same-sold-unit path, including agorot rounding. Stage 08 snapshots the
server-side catalog buy price and applies the 40% margin guard.

**Not yet full parity:** `products` does NOT store universally trusted
packaging conversions; explicit differing purchase/sale levels are therefore
rejected until a trustworthy server-side conversion source is integrated.
Document-wide discounts, manual final-total overrides and order edits are
also not supported by the staged writer. These must be addressed BEFORE
agent activation. Never use the client-supplied packaging or buy_price for
server authorization. The new agent order flow must not mislead the owner
by claiming comprehensive pricing support before those tests pass.

## 2026-11-23 security/integration checkpoint

- Staged `09_legacy_security_definer_guard_NOT_APPLIED.sql`: exact snapshots
  of SEVEN live SECURITY DEFINER order/payment/credit-note APIs with only a
  new early deny-agent guard. Recheck function definitions immediately before
  applying to any environment to avoid overwriting newer live logic.
- Staged `10_margin_exception_request_NOT_APPLIED.sql`: below-40% requests
  become hashed inert drafts, not orders. An approval records the shared
  login's human-selected approver (`עומרי` or `בן`). Neither request nor
  approval changes stock or creates an order.
- Added `src/pages/AgentExceptions.jsx` and gated route/sidebar; build-time
  `VITE_ENABLE_SALES_AGENTS` defaults OFF. DO NOT enable until all agent
  flows and server security gates pass.
- Created an ephemeral PostgreSQL 16 synthetic test harness in GitHub Actions.
  It applies staged SQL 01 through 10 to a disposable DB and verifies real
  account isolation, 40% arithmetic, order + delivery alert idempotency,
  agent-owned customer creation, under-margin inert request, one approval,
  portal isolation, and direct denial of seven legacy privileged RPCs.
  No Supabase development branch was created (could incur extra charges).
- GitHub Actions run **45257956454** verified all THREE jobs completed with
  `success`: pure Node unit tests, ephemeral SQL integration, and Vite build.
- Still NOT DONE: authenticated agent self-service UI, support for all
  legitimate product packaging conversions and edited final totals, agent
  order modification, consuming approved exception into one real order with
  fresh cost snapshot checking, delivery closeout, settled-receipts commission
  accounting, WhatsApp setup, full regression on restored operational data,
  and deployment/rollout authorization. No agents were activated and NO SQL
  from this folder was executed on production Supabase.

## 2026-11-23 continuation: one-shot exception + delivery queue

- Staged `11_approved_exception_order_NOT_APPLIED.sql`: after an approved
  below-40% inert exception, the same active agent can create exactly one
  order, from the stored request only. Locks request, assigned customer,
  owner business settings and products; recalculates margin and a SHA256
  hash against current catalog cost; refuses stale cost / altered input,
  rejected requests, changed customer assignments, or a second order UUID.
  Stores immutable agent attribution and opens one delivery alert. Does not
  deduct inventory or issue an invoice. Tests live in
  `tests/agent-db/30_approved_exception_order.sql` using synthetic data.
- Staged `12_delivery_alert_sync_NOT_APPLIED.sql`: close/reopen the agent
  delivery alert when the existing order `fulfilled` flag changes; do not
  infer delivery from the financial `הושלם` status. No alternate inventory
  or fulfillment path is introduced. Synthetic tests in
  `tests/agent-db/40_delivery_alert_sync.sql`.
- Added read-only `src/components/agents/AgentDeliveryQueue.jsx` to the
  existing manager dashboard, hidden behind the disabled agent feature flag.
  Its links lead to the existing order workflow and it cannot mutate stock.
- All code and SQL remain only in `feature/sales-agents-foundation-20261123`.
  NOT DEPLOYED to production Supabase or live QuickStock, no agent activated.
- Remaining major blockers: comprehensive agent order-edit parity for mixed
  pack/carton and total overrides; safe completion of inventory workflow;
  settlement-aware 8% commission accounting; agent-facing order entry;
  restored-live-schema and portal/regression tests; deployment approval.
