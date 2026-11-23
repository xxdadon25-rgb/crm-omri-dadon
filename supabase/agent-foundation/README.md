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
8. The owner and Ben must be explicitly enrolled as managers using verified
   auth IDs before agents can sign in.

## Build sequence (safe, small phases)

**Gate A — identity + isolation**
1. Validate both managers' auth IDs and protect the existing app.
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

- DONE: repository branch, pure UI calculation helpers, **unapplied** additive
  schema candidate with default-deny new table write access.
- NOT DONE: live role/identity implementation, existing-table RLS corrections,
  server margin enforcement, WhatsApp API, manager approval UI, dashboards,
  commission engine, repeat order, automated tests, deployment.
- No SQL from this folder has been executed in Supabase.
