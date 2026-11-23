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
  enrollment), 07 (verified-unit-cost margin preview), 08 (atomic basic agent
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

## Key pre-activation business constraint: verified costs

On 2026-11-23, the live product table contained 740 records (28 with NULL
purchase cost, 10 with zero purchase cost). Existing orders mix unit/carton
purchase bases; only 21 historic lines had the explicit
`catalog_same_sold_unit_v1` price basis. An empty verified-costs table is
intentional: NEVER guess all 740 products have comparable unit costs, and do
not allow a new agent to sell a product with an unknown normalized cost.
Manager must approve the cost-per-sold-unit evidence or confirm an existing
trusted catalogue source before production activation. This is a business
review decision; do not seed costs automatically. Document-level discounts,
editable order totals, credit offsets and multi-level pack/carton pricing
require further server/JS parity tests before release. The staged writer
currently fails closed on unsupported document-level discounts.
