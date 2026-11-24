# QuickStock Sales Agents — Release Readiness

**Status:** DEVELOPMENT ONLY. No production migration, no merged PR, no
activated agent and no new paid infrastructure. Do not flip
`VITE_ENABLE_SALES_AGENTS` or manually execute any `*_NOT_APPLIED.sql`
without a distinct live rollout approval.

## Implemented / tested in isolated PostgreSQL + Vite build

- Separate agent-specific CRM access, RLS and no direct writes to manager
  payments, invoices, products or stock; legacy SECURITY DEFINER RPC gates.
- Agent dashboard, customer assignments/history, secure new customer creation,
  agent orders with server 40% blended margin and one-time exception approval.
- Manager named approvals (עומרי / בן), manager agent registry, assignment
  and immediate access revocation, with disabled-only registration.
- Delivery alert on the existing order fulfilled flag, separate from financial
  status and invoice-payment completion.
- Agent collection followups read-only via existing signed
  `invoiceBalance` behavior; manager remains sole recorder of customer
  payments; owner confirmed recorded cheques were already cleared.
- Historical original-order commission-rate snapshot, 8% net receipts
  preview using per-invoice VAT, immutable ledger with idempotent settlement
  rows/compensating reversals, manager-only reconciliation, manager-only
  bookkeeping of EXTERNALLY completed commission payouts, and full-history
  accrued-versus-paid balance. No money is moved by these functions.
- Anti-tampering: server controls name, SKU, sale-unit label, cost and
  packaging metadata for order lines. Changed source costs invalidate an
  approved under-40% exception. Direct JSON input cannot change an order
  description or its inventory metadata.
- Synthetic CI verifies grouped and partial receipts, refunds, credit
  review, stale pricing, overpayments, permission boundaries, reassignments,
  double payouts and order idempotency. Frontend build runs disabled.

## Remaining hard launch gates — NOT PRODUCTION READY

1. **Packaging parity:** the existing `products.unit` is a human-readable
   label (`יחידה`, `חבילה`, `קרטון`, `מארז`, `מטר`), not a trustworthy
   conversion ratio. Agent cost calculation covers the current same-sold-unit
   catalogue basis, not verified mixed carton/pack/unit conversions. Do NOT
   guess conversion factors from prices. Explicit mismatched levels fail closed.
   No requirement to manually re-verify the whole catalogue; resolve actual
   unsupported cases using previously approved invoices or packaging records.
2. **Document edits and discounts:** server rejects document-wide discounts
   and final-total overrides pending exact QuickStock parity. No agent order
   edit RPC has been approved. Validate original stock/invoice/order flows on
   a schema-faithful isolated restore before enabling these.
3. **Commission edge cases:** genuinely multi-order invoices and credits
   involving final payout require approved allocation/refund policy. Current
   preview/ledger does NOT award commission on ambiguous invoices; after a
   reversal, previous settlement is not automatically re-earned. Manager
   review is required rather than silent financial corrections.
4. **Secure account provisioning:** register real, separate Supabase Auth
   accounts for agents, excluding the manager and any customer-portal account.
   The management RPC only registers already-existing identities DISABLED;
   it cannot create authentication users or activate the module.
5. **Full live-schema regression / restore:** stage the EXACT current DB
   schema and legacy SECURITY DEFINER function bodies, and test owner/Ben
   flows, customer portal, invoice payment -> financial completed status,
   inventory deductions, credit/return and authorized delivery completion.
   Synthetic fixture tests passing do not prove these production workflows.
6. **Rollout gate:** review staged DDL against fresh, live read-only audit
   and production backup, explicitly approve the one-time schema rollout,
   test one genuine agent end-to-end, then separately approve enabling the UI.
   No production changes or external charges before that authorization.

## Scope/ownership decisions already settled

- Both managers keep ONE current manager login. Audit decisions show
  self-selected `עומרי` or `בן`, not cryptographic proof of the person.
- Agents contact customers to collect, while only the manager records
  customer payments. An entered payment appears in the agent read-only
  collection view; agent commission is 8% of linked net received receipts.
- No cheque-clearance confirmation is required for already-recorded payments.
- Low-margin exception must be approved once before an order can be created.
- Financial order `הושלם` remains payment-driven; delivery is separate.
- No paid WhatsApp/third-party services without permission.
- All deployment decisions and actual activation require owner approval.

## Mechanical validation

GitHub Actions workflow:
`.github/workflows/agent-foundation-tests.yml`

Execution order for disposable SQL fixture and stages is that workflow's
`sql_files` array. Some staged files depend on later-numbered snapshots
(e.g. 14 must be loaded before 08/11), so **do not run migrations in numeric
filename order**.

The `00_PRELAUNCH_READ_ONLY_AUDIT.sql` checks current catalogue anomalies,
invoice/payment linkage and function drift WITHOUT applying changes.

## Additional safety regression in this development cycle

- Added `18_commission_balance_NOT_APPLIED.sql` to calculate the FULL ledger
  sum on the server (not the manager UI's limited recent activity page);
  authenticated agents see only their own balance and managers only agents
  of their business. Negative carryovers after later refunds remain visible.
- Preserved existing manager receipt deletion: the staged ledger's optional
  payment FK uses `ON DELETE SET NULL`, while `source_key` preserves the
  original payment ID and an eventual synchronization issues ONE reversal.
  Only this constrained FK cleanup is permitted by the immutable-entry trigger.
  Tested deleting an original receipt without destroying its audit trail.
- Hardened agent order snapshots to whitelist server-trusted product name,
  SKU, sale-unit label, metres-per-roll and purchase cost from
  `public.products`. Browser-supplied stock/invoice metadata is ignored.
  Manager can audit these via `tests/agent-db/35_order_line_tamper.sql`.
- Added commission overpayment detection. A receipt paid above its invoice
  total is marked for allocation instead of accruing 8% on unmatched
  customer credit; later edits result in a compensating ledger entry.
- GitHub Actions run **45269948634** completed all three jobs with SUCCESS:
  pure rules, actual SQL/RLS synthetic PostgreSQL, and Vite compilation.
- The work remains in unmerged feature PR #3; no production table, policy,
  payment, customer, invoice, product or stock record was changed.

## 2026-11-24 — Normal agent order idempotency audit

- Fixed the normal-order RPC's existing idempotency hole: a repeated
  `p_request_id` from the same agent/customer is now accepted **only if**
  the original product IDs, line order, quantities, sale prices, discounts,
  stored line totals, document discount and notes match. A modified request
  fails with `order_request_payload_changed`, without writing another
  order. This check runs before and after the owner order-counter lock.
- The comparer uses only whitelisted financial inputs, not client-supplied
  names, SKU, stock data or cost; those remain trusted server snapshots.
  Successful identical retry returns the same order and does not increment
  counters or duplicate alerts.
- Extended the isolated SQL test to cover changed quantity, unit price,
  line discount and notes with the original request ID.
- **GitHub Actions 45336227246**: pure Node agent rules SUCCESS, isolated
  PostgreSQL/RLS SQL integration SUCCESS and Vite build SUCCESS.
- No production SQL applied and no live CRM data changed.

## 2026-11-24 — Product unit/cost safety audit

- READ-ONLY live catalogue query found 740 active products: 38 have a NULL
  or nonpositive purchase price; 2 have an unusually high catalogue sale
  price relative to recorded purchase cost (greater than 12x); the
  remaining 700 pass this *coarse ratio screen*, NOT a proven pack/carton
  conversion audit. None of the records was edited.
- Tightened the staged server margin function to REJECT nonpositive purchase
  costs, unverified >3x buy/sale or >12x sale/buy price ratios, including
  a check using the trusted catalogue reference price. An agent cannot
  bypass a flagged product by quoting a different price or supplying a
  `price_basis` field. A missing cost is an error, never a free product
  with a fictitious 100% gross margin.
- Enforced exact two-decimal net line totals before storing an agent order.
  A fractional-cent total cannot pass the rounding validation and be
  saved with an unrounded value that differs from the server's margin base.
- Added isolated PostgreSQL regression `tests/agent-db/25_margin_cost_basis.sql`
  and SQL contract tests for zero-cost, suspicious purchase/sale bases,
  source-reference-price bypass and fractional-cent invoice totals.
- These are targeted fail-closed safeguards, NOT full compatibility with
  confirmed mixed units or legacy document-wide discounts. They protect
  the current same-sold-unit workflow while the outstanding launch gates
  remain in force.

## 2026-11-24 — Agent blocks and delivery/payment separation

- Extended synthetic integration to demonstrate a genuinely **approved but
  not yet consumed** below-40% margin exception is invalidated if the manager
  later blocks one of its products for agents. Attempting to create the
  approved order returns `agent_product_blocked`; no new order or delivery
  alert exists. Blocking affects agents ONLY.
- Verified separate state transitions: fulfilling an order closes a delivery
  alert but must not set its financial order `status` or modify its stock
  deduction flag; changing the financial `status` does not alter
  `fulfilled` or reopen its alert. Existing production inventory-aware
  `save_order_with_inventory` still requires a *restored live-schema*
  regression before deployment.
- GitHub Actions run **45341775808**: pure Node, disposable PostgreSQL and
  Vite compilation all SUCCESS.
- READ-ONLY query of current production SECURITY DEFINER function signature
  and MD5 hashes (snapshot on 2026-11-24). These hashes are a **new baseline**,
  not proof that staged owner-function bodies are identical or safe to deploy:

| Function | Deployed md5(pg_get_functiondef) |
|---|---|
| allocate_payment_across_invoices | `68702e50d0eb7dde77f7242363665524` |
| create_order_with_inventory | `017a994740adf56ceff2b43598b37868` |
| credit_note_confirm | `06aa408fe5ee79491e113867c1c0f693` |
| credit_note_reserve | `a63cb1d918a49426969783495687d69b` |
| credit_note_resolve | `00f061da18c1a54cd2699f19b69406e8` |
| credit_note_return_lines | `de6028c384ace4e4cd694e40b8c9b2e3` |
| save_order_with_inventory | `6df7f57fe5922299cbdaddfe06c456a9` |

- Before any production migration: recheck deployed signatures/hashes and
  diff the actual function bodies with those in staged
  `09_legacy_security_definer_guard_NOT_APPLIED.sql`. Rebuild the stage if
  existing functions drifted. Never overwrite updated live business logic.

## 2026-11-24 — Seven live legacy RPC bodies compared, READ ONLY

- Compared `pg_get_functiondef` for all seven live production functions
  against the corresponding staged definitions in
  `09_legacy_security_definer_guard_NOT_APPLIED.sql`.
- Removed ONLY the exact staged `AGENT ACCESS GATE` from each candidate,
  normalized whitespace and trailing SQL delimiter. **7/7 matched** the
  corresponding live function definitions byte-for-byte after normalization.
  No other business-function differences were found at this snapshot.
- This verifies the SQL staging snapshot against the actual existing
  owner/payment/stock/credit logic **as of 2026-11-24**. It does NOT
  constitute deployment approval or proof of application safety.
- Before rollout, repeat this comparison in the same deployment session
  and abort on ANY drift. Never apply the staged full-function replacements
  based solely on these dated hashes or this static report.

## 2026-11-24 — Dashboard completeness / live read-only column check

- Confirmed via READ-ONLY production `information_schema.columns` that
  `invoices.due_date`, `credit_notes.external_credit_note_number`,
  `orders.fulfilled`, `orders.created_date` and the remaining selected
  customer/payment/history fields actually exist. This verifies names only;
  role-scoped integration still needs a restored production-schema test.
- Fixed `AgentDashboard.jsx` pending-delivery summary: the original UI
  counted `fulfilled !== true` inside the most recent 500 orders and
  silently underreported larger queues. It now uses a server-side exact
  `head:true` count, with both NULL and FALSE fulfillment statuses.
  Total order count also uses an exact `head:true` count.
- Added `tests/agentDashboard.test.js` and ran in GitHub Actions alongside
  pure agent rules, disposable SQL/RLS tests and Vite build. Feature flag
  remains disabled; no live CRM data was written.

## 2026-11-24 — Disabled-agent commission access revocation

- Resolved a direct-RPC authorization gap: an inactive agent was correctly
  denied assigned customer data by RLS, but could still query old
  `sales_agent_commission_preview` and
  `sales_agent_commission_balance` data through SECURITY DEFINER RPCs.
- Both read functions now require an ACTIVE profile when caller=agent.
  A manager of the same owner business can still inspect accrued/paid
  history of a disabled agent for final accounting and dispute resolution.
- Added synthetic PostgreSQL assertions for disabled-agent direct RPC
  rejection and preserved manager balance; added static SQL contract guard.
- Tested against disposable fixture only. Agent activation still disabled,
  and no production data, product pricing, stock or customer access changed.

## 2026-11-24 — Agent product blocking concurrency fix

- Found a potential race: the manager's agent-only product block previously
  used `FOR SHARE` on `products`, compatible with the order writers'
  `FOR SHARE` lock. A new agent order and product blocking operation could
  therefore overlap and observe an obsolete block state.
- Changed ONLY the agent-only toggle RPC's product lock to `FOR UPDATE`.
  Normal and approved-exception order writers already hold `FOR SHARE`
  on their referenced catalogue products before calling the trusted margin
  gate. Consequently, a block transaction and an order transaction now
  serialize on the same product row; no manager/portal product availability,
  price or stock data is changed by this RPC.
- Added SQL contract assertions checking lock coordination and margin gates.
  GitHub Actions run **45350676285**: Node rules, isolated PostgreSQL SQL/RLS
  and Vite build all SUCCESS.
- A true two-connection race exercise and legacy stock/fulfilment E2E
  remain required on schema-faithful isolated database before production.


## 2026-11-24 — Reconciled original owner scope and current rollout status

Single continuation checkpoint: avoid redoing successful development or auditing unrelated historical orders.

### Confirmed scope
- Existing QuickStock manager/Ben shared login, customer portal, products and documents stay unchanged by agent-only blocks.
- Separate agent accounts, assigned/new customers and history, agent orders >=40% blended margin before VAT; below 40% requires manager approval, self-declared עומרי or בן.
- 8% on actually collected net receipts, partial/credited transactions reconciled; manager alone records customer payments and external agent payouts.
- Delivery alerts are independent of financial completion. Repeat orders and dormant-customer follow-ups are in original scope.
- WhatsApp notification/approval is a requested requirement, NOT live-connected. Manager in-app approval is available without a paid messaging dependency.
- Item #37 buy cost ₪5.50 and other owner-proposed catalogue changes remain UNAPPLIED. Never change manager/portal product visibility.

### Newly implemented and verified
- Agent activation staged in 20_agent_activation_NOT_APPLIED.sql. Only authorized manager may activate an existing separate registered disabled agent. Self-activation, portal identity and staff identity are rejected. Manager UI has confirmation and disabling remains available.
- Customer-history repeat-order shortcut constructs a reviewable draft from current allowed products; checks original line consistency, rejects missing/blocklisted and mixed-uncertain packaging, then invokes existing server margin checks before any order can be created.
- Assigned-customer last-order follow-up list with selectable 30/60/90-day thresholds. Full RLS-scoped order pagination; fail closed on incomplete reads; no automatic message is sent.
- GitHub Actions run 45472165567: all three jobs SUCCESS (Node including new feature tests, disposable PostgreSQL integration, Vite build).
- No migration run on production, no feature flag enabled, no customer/payment/stock/portal changes, no actual agent account activated.

### Still-open gates before first real agent
1. Production-schema-faithful isolated E2E with manager, agent and portal identities, existing inventory-aware fulfillment, invoice/payment completion and commission/credits. Current test fixture is simplified, and no isolated actual-schema clone is available.
2. Trustworthy mixed pack/carton/unit conversions and exact agent order document discounts / final total overrides / post-create edits; current agent writer fails closed on unsupported cases. Never guess packaging multipliers.
3. Truly ambiguous multi-order invoice commission allocation/refund decisions remain manager review, never automatic payouts.
4. Fresh diff of seven live SECURITY DEFINER functions, safe backup/restore route, audit staging SQL migration ordering, RLS and EXECUTE, and explicit approval before production installation.
5. Provision separate real agent Auth user, assign customers, run controlled live E2E, and separately approve enabling sales-agent UI.
No new paid Supabase project, branch or third-party service without prior approval.


## 2026-11-24 — Agent orders and existing manager inventory flow verified

- Staged disposable DB fixture now includes order_inventory_effects and orders.total_override, matching the fields required by the legacy manager save_order_with_inventory SECURITY DEFINER function.
- Normal agent orders leave stock intact until manager fulfillment. Fulfillment deducts exactly once; repetition does not deduct twice; reversal restores exactly the original stock effect, reopens the delivery alert and leaves financial status unchanged.
- Approved under-40% exception orders were also tested through the SAME manager stock fulfillment/reversal path.
- Test-only privileged stock-ledger inspection did not grant the actual manager user direct SELECT permissions to that protected ledger.
- GitHub Actions run 45474213505: Node rules, isolated PostgreSQL integration and Vite build all passed.
- The fixture still differs from full live schema and does not prove complete real invoice/payment/credit lifecycle. Those remain rollout gates.
- This development was not merged or activated. Production QuickStock remains unchanged, with no paid infrastructure.


## 2026-11-24 — Fresh live legacy function drift audit and manual total parity

- READ ONLY comparison against currently deployed pg_get_functiondef for all
  seven legacy SECURITY DEFINER functions staged in
  09_legacy_security_definer_guard_NOT_APPLIED.sql:
  allocate_payment_across_invoices, create_order_with_inventory,
  credit_note_confirm, credit_note_reserve, credit_note_resolve,
  credit_note_return_lines and save_order_with_inventory.
- Every staged function body matches its LIVE equivalent after removing
  exactly the 325-character agent-denial guard and normalizing whitespace.
  No unexpected modification of the existing business logic was detected.
  This observation is dated 2026-11-24; repeat drift audit at actual rollout.
- Verified from current OrderCreateModal that a manual gross total is a
  TAXABLE adjustment: subtotal stays equal to line totals; taxable net
  adjustment = round(gross/(1+vat_rate)-subtotal,2); VAT = gross-subtotal-
  adjustment; discount_amount remains a line-discount total.
- Added agentDocumentTotal.js and isolated unit cases for 40% boundary,
  taxable increase/decrease, agorot reconciliation and invalid cost/total.
  It is PREVIEW/PARITY ONLY and is NOT wired to the trusted agent order RPC.
  Existing agent RPC continues to reject unsupported document-level
  discounts/overrides. Never enable browser override without server enforcement,
  exception hash binding and full accounting E2E.
- Nothing deployed or changed in production.


## 2026-11-24 — Trusted manual-total server preflight (not order-write permission)

- Added 21_manual_total_preview_NOT_APPLIED.sql as an authenticated agent-only
  SECURITY DEFINER read-only preview for a gross total override.
- The routine invokes the SAME trusted sales_agent_check_order_margin first,
  so active-agent access, assigned customer, current cost, blocked products,
  verified same-unit lines, integer-agorot line consistency and catalogue
  price anomalies are all enforced by the server.
- It reads the current business VAT rate, follows OrderCreateModal's taxable
  manual-total adjustment split and compares 40% using INTEGER AGOROT.
  Server result includes original goods subtotal, taxable adjustment net,
  effective net revenue, VAT, verified cost and whether manager exception
  would be required.
- Full DB integration validates unchanged 118.00 gross (40% exactly),
  manually lowered 106.20 gross (below margin, exception required),
  raised 120.00 gross (VAT adjustment parity), fractional-agorot rejection,
  unassigned-customer rejection and portal identity denial.
- CI run 45475619981 all 3 jobs SUCCESS (isolated Postgres, Node and Vite).
- This preview intentionally does NOT alter or bypass the existing
  sales_agent_create_order, sales_agent_request_margin_exception and approved
  exception consumption flow. Those still reject unsupported document-wide
  discounts and have NO gross-total override argument.
- NEXT: trustworthy server order-write and exception-hash binding for gross
  override + full accounting/invoicing E2E, before enabling agent editing.
- No production migrations, UI feature enablement or business data writes.


## 2026-11-24 — Verified manual total end-to-end branch integration

- New server order writer in 22_manual_total_order_writes_NOT_APPLIED.sql
  persists manual gross total, recomputed VAT and existing goods subtotal
  atomically; it rejects a changed retry payload and any under-40%-margin
  order lacking manager approval. Existing 5-argument order writer unchanged.
- A separate margin-exception request hashes selected items, trusted current
  costs, gross total, net-revenue result and VAT amount. The existing one-time
  manager-approved exception materializer was extended to recognize this
  additional HASH-BOUND request form without changing old exception behavior.
  A manager decision cannot be reused for another order or another VAT split.
- AgentOrders.jsx now displays an optional manual gross total with strict
  two-decimal validation and routes through trusted server preflight and
  server order/exception RPCs; repeat-order drafts clear stale manual totals.
- A new synthetic end-to-end scenario consumes a manager-approved 106.20
  gross adjusted order, creates its related 106.20 invoice, records TWO
  53.10 partial payments, verifies 8% of pre-VAT received money (7.20 total),
  idempotently reconciles and reverses the precise accrued commission upon
  confirmed credit. No automatic payout or actual money transfer.
- Added regression that changing the business VAT rate after approval
  invalidates the approved adjusted-total request WITHOUT creating an order.
- CI run 45476926733 passed all three jobs after UI wiring.
- CI run 45477156509 passed all three jobs after VAT-hash strengthening.
- CI run 45477370220 passed all three jobs including payment + 8% commission
  + credit reversal integrated regression.
- These integrations run against synthetic PostgreSQL fixtures, NOT a
  full restored QuickStock production database. They do not establish
  issuance through live Finbot/Rווח פלוס, nor real production deployment.
- No deployment, paid resource, real customer order or production data
  changes. Verified past agent-only product selections are not automatically
  changed by this work. Remaining launch gates: exact actual-schema E2E,
  mixed packaging evidence for affected products, and explicit rollout
  permission + secure Auth provisioning for first real agent.


## 2026-11-24 — Actual production policy/sequence introspection and guarded test coverage

- READ ONLY production catalog inspection verified the actual
  public.quotes policy public_read_quotes FOR SELECT TO public USING(true).
  PostgreSQL combines permissive policies using OR, so the initial agent
  quotes_read_assigned policy was not sufficient. New staged
  23_quote_read_scope_NOT_APPLIED.sql adds an authenticated RESTRICTIVE
  policy restricting an agent to assigned customer quotes, without narrowing
  existing non-agent manager or portal SELECT behavior.
  A faithful disposable fixture now includes the actual permissive public
  quote policy; regression tests verify assigned, unassigned, foreign,
  manager, portal and revoked-assignment cases.
- READ ONLY production introspection verified get_next_order_number and
  get_next_quote_number are SECURITY DEFINER wrappers of nextval,
  executable by authenticated, and the underlying public order_number_seq
  and quote_number_seq both grant authenticated/anon USAGE and UPDATE.
  Thus guarding the RPC alone cannot prevent direct sequence advancement.
  New staged 24_legacy_sequences_agent_guard_NOT_APPLIED.sql revokes direct
  remote sequence access and guards both legacy number RPCs against any
  registered agent (including disabled agents). The disposable fixture
  reproduces the historical grants. Tests cover manager RPC increments,
  portal RPC behavior, agent RPC denials and raw-sequence denials.
- All 3 groups passed in GitHub Actions 45477925703 for quote isolation.
  All 3 groups passed in GitHub Actions 45478347698 for sequence scope,
  including the full previous PostgreSQL/commission test suite.
- IMPORTANT ROLLOUT COMPATIBILITY GATE: revoking direct sequence privileges
  is a change to previously granted access. Search in GitHub's default
  branch did not return direct sequence references, but this does not
  prove there is no older client, SQL console workflow, external integration
  or stored procedure using nextval directly. Verify those dependencies in
  a production-schema-faithful isolated environment BEFORE applying 24.
- No migration was applied to production, no live user or customer state
  changed, no merge or feature activation was performed.


## 2026-11-24 — Anonymous authorization bypasses closed in STAGED SQL only

Read-only LIVE introspection exposed two IMPORTANT differences from the
earlier synthetic tests:
1. Actual public.quotes has a permissive public_read_quotes SELECT USING
   (true) policy, allowing any anonymous client to retrieve all quotes.
   An authenticated-agent restrictive policy alone does NOT solve this:
   an agent can omit the token and use the anonymous role. Stage 25 now
   removes the global public quote SELECT and provides an authenticated
   customer-portal policy only for its OWN linked customer (approved,
   active, not portal-deleted). Existing owner and assigned-agent SELECT
   policies are unchanged. Stage 25 changes previously public visibility
   and MUST NOT GO LIVE before confirming public quote links/external
   integrations that may intentionally rely on anonymous reads.
2. Both order_number_seq and quote_number_seq granted direct USAGE/UPDATE
   to anon/authenticated; get_next_order_number/quote_number were callable
   by anon. Stage 24 revoked underlying direct access and added agent
   guards, but its wrappers still permitted a user to OMIT the JWT and
   call those anonymous SECURITY DEFINER wrappers. Stage 26 now denies
   nonmanager callers at the SERVER, revokes anon EXECUTE and requires an
   explicit matching sales_agent_managers owner record. This is a behavior
   change for portal/anon callers and requires compatibility validation
   against the actual portal and all deployed clients before any rollout.

Read-only production catalog check found 14 SECURITY DEFINER public
functions (13 executable by authenticated): seven legacy owner order/payment/
credit functions protected by staged agent guards, two legacy number
generators (stages 24+26), credit_note_check_items delegating to protected
credit_note_return_lines, portal_my_purchased_products scoped to an active
portal identity, two trigger-oriented portal signup routines and one
Telegram purchasing draft append routine not callable by authenticated.
This listing is an audit starting point, NOT a complete sign-off of all
privileged code, triggers, PostgREST routes or external integrations.

Synthetic fixture updated to reflect the LIVE customer_portal_access
SELECT privileges and RLS after the first test correctly flagged a missing
fixture GRANT. The staged SQL and tests now cover manager, active assigned
agent, unrelated owner, portal, anonymous role, and revoked assignments.
GitHub Actions 45479252567: all three jobs SUCCESS (PostgreSQL/RLS integration,
Node agent rules and Vite build). No prod SQL executed.

**RELEASE HOLD:** Stage 25 and 26 are intentionally NOT_APPLIED because
their security repairs also change old anonymous and portal behavior.
Inspect actual published quote links/portal workflows and legacy counter
callers, and validate against a full isolated production-schema restore
before explicit user-approved install. Historical packaging-unit parity
and supplier evidence remain separate unresolved gates; no guessed costs
or owner product mutations are permitted.


## 2026-11-24 — Live catalogue-unit and counter dependency verification

- Read-only catalog introspection on the live public database shows no
  additional database-function callers of get_next_order_number,
  get_next_quote_number, order_number_seq or quote_number_seq apart from
  those two existing SECURITY DEFINER wrappers. This DOES NOT establish
  there are no frontend, Edge Function, portal, third-party, or anonymous
  callers; stages 24/25/26 remain NOT_APPLIED pending full compatibility.
- Read-only historical order-line aggregate found 452 stored items,
  29 explicit catalog_same_sold_unit_v1 markers, 12 historical lines with
  differing explicitly stored sale/buy levels, and 19 lines with packaging
  metadata. Those historical counts are NOT a list of current products
  missing prices and do not change the owner's approved 21-allowed/
  17-agent-only-blocked selections. No catalogue reapproval is requested.
- New disposable PostgreSQL test 29_verified_sold_units.sql demonstrates
  correctly costed current product unit labels "קרטון" and "חבילה":
  a sale of two ₪100 cartons at ₪60 cost each is 40% total gross margin,
  and two ₪10 packs at ₪6 cost each are also 40% margin.
  Explicitly forged mismatched carton/unit prices or unreviewed packaging
  are rejected by the SERVER regardless of submitted conversion numbers.
  No invented unit-to-carton ratios are used.
- GitHub Actions run 45479798186: all 3 jobs SUCCESS (SQL/RLS, Node,
  UI build). Development only; zero production mutations.
- Remaining gates before rollout are a production-schema-faithful
  restored/isolated test, actual customer-facing portal and anonymous
  quote-link compatibility, exact external counter callers, and a
  controlled first agent run under owner approval.


## 2026-11-24 — Public PDF compatibility solution staged, security rollout still on hold

- Inspected source files behind actual public CRM routes:
  /quote-pdf/:quoteId, /order-pdf/:orderId and
  /credit-note-pdf/:creditNoteId. Existing quote/credit-note public PDF
  pages had raw select("*") calls to quotes/credit_notes and
  business_settings. The existing public order PDF uses public-order-pdf
  for the order but read business_settings directly in the browser.
- Read-only LIVE Supabase inspection verified both quotes and
  business_settings have unrestricted public SELECT policies, and
  business_settings has anon SELECT privileges despite containing columns
  api_url, api_key, api_secret and api_company_id. No sensitive field
  values were fetched. This is a preexisting potentially severe exposure
  requiring a coordinated security release, not an agent-feature change.
- Added staged public-quote-pdf and public-credit-note-pdf Edge Functions:
  each requires a valid UUID and serves exactly one share document with
  explicitly allowlisted public display fields and business identity,
  never user/customer IDs, raw line costs, or API secrets. Existing public
  UUID link formats are preserved.
- Updated staged public-order-pdf to include only public business display
  fields in its return object. All three React public PDF pages now use
  their matched Edge endpoints; none queries business_settings directly.
- Stage 27_PUBLIC business settings hardening removes the global public
  table SELECT policy and revokes anon SELECT. Disposable PostgreSQL tests
  confirm owner read preserved, agent/portal/anonymous direct reads denied.
- Frontend Vite build, Node PDF allowlist tests and esbuild TypeScript parsing
  of all three Edge Functions passed; SQL/RLS tests passed:
  GitHub Actions run 45481580549 — all three jobs SUCCESS.
- NOT DONE: real deployed anonymous browser PDF smoke checks, review of any
  other external integrations depending on direct public business settings
  reads, backup/recovery, any production Edge/function/frontend rollout.
  Stages 25, 26, and 27 are NOT_APPLIED.
- Critical deployment order is detailed in PUBLIC_DOCUMENT_ROLLOUT.md.
  Do not merge the staged frontend or revoke public table privileges
  without deploying the matching safe Edge Functions and verifying
  existing links. No new paid services are necessary for this plan.


## 2026-11-24 — Last completed compatibility checkpoint

- The seven legacy function bodies match live definitions after removal
  of the proposed agent guard, as previously documented.
- Staged public quote/order/credit-note PDF sources and owner-safe
  business-settings scope tested with synthetic SQL and static checks.
- NEW: guarded legacy number-counter migration (stage 26) aborts
  transaction if existing QuickStock owners have not yet been seeded as
  explicit owner-manager identities. This prevents accidentally breaking
  the existing quote numbering path.
- NEW: staged public-order-pdf responses are marked Cache-Control:no-store;
  all three public document Edge sources have tested no-cache contract.
- GitHub Actions run 45482417013 passed ALL 3 jobs: Node security/rules,
  isolated PostgreSQL RLS and UI plus staged public Edge builds.
- Vercel read-only production baseline: `main` commit
  bcbb2b258c4f971b0f986d3a44f2baaf1e74a6bb. Separate feature branch
  previews are not a production release. Deployed public-order-pdf is v5
  and does NOT return the new `business` response required by branch UI.
- Next launch blockers are real anonymous PDF/portal integration smoke
  checks AFTER authorized deployment of matching Edge versions,
  the owner-manager Auth identity seed, actual-schema restored E2E,
  and explicit deployment approval. Do not silently apply any staged SQL.
- This checkpoint used only read-only live inspections and branch commits.
  Production schema, data and deployments were unchanged.


## 2026-11-24 — Real migration failure-path regression verified

- Added tests/agent-db/negative_manager_seed_gate.sh, invoked by the
  isolated PostgreSQL CI job after all positive integration tests.
- This runs the ACTUAL staged stage 26 migration text inside an explicit
  disposable transaction after deleting the synthetic owner-manager seed.
  Expected result is the exact error owner_manager_identity_not_seeded.
  A disconnected aborted transaction rolls back the simulated deletion;
  the test then asserts the owner-manager record still exists and the
  existing get_next_quote_number owner path still returns a number.
- This is a negative-path test of the migration and restoration, not just
  a static regex assertion or a duplicate of its predicate.
- GitHub Actions 45483192805: all 3 jobs SUCCESS, including the new
  negative migration test, full synthetic RLS/financial integration,
  Node tests and Vite + public PDF Edge compile tests.
- The test does NOT substitute for a schema-faithful isolated clone
  of the existing production database, actual public PDF device checks
  or owner-approved rollout. All changes remain on the feature branch.


## 2026-11-24 — Live schema read-only repeatable preflight

- Added LIVE_SCHEMA_PREFLIGHT_READ_ONLY.sql. It reads ONLY
  information_schema.columns; it contains no INSERT, UPDATE, DELETE,
  migration, payment, real customer rows, API credentials or production write.
- Ran the EXACT committed SQL file against existing QuickStock Supabase:
  all 20 of 20 required table-column-type checks PASS, zero failures.
  Covered items/orders, inventory effects, catalog pricing units, customer
  association, invoice VAT/order references, payment amounts, credits,
  business VAT and quote/customer portal fields.
- This narrows schema-drift risk but is NOT an isolated restore of all
  schema objects, dependent functions, indexes, RLS grants, triggers,
  Edge deployments or actual-world public PDF integration.
- Most recent complete synthetic CI run prior to this read-only check:
  45483192805, all three jobs success.
- Remaining rollout gate: full schema-faithful nonproduction rehearsal,
  safe customer-facing document/portal smoke checks after coordinated
  Edge/UI deployment, explicit manager Auth seed, user-approved production
  migration and initial agent activation. No production change made.


## 2026-11-24 — Production-grounded RLS/RPC + original trigger regression

- Added and executed exactly LIVE_RLS_RPC_PREFLIGHT_READ_ONLY.sql against
  existing live Supabase, without reading real business/customer/product data:
  23 checks; 20 PASS; 3 EXPECTED_RELEASE_HOLD; zero unexpected drift.
  The 3 known release holds are the historical public_read_quotes policy,
  public_read_business_settings policy and direct anon SELECT on settings.
  None of those were changed in production.
- Checked the real database trigger catalog for credit_notes/products:
  three externally relevant triggers, two before-update guards for Finbot
  credit states and frozen reserved credit notes, plus one after-update
  automatic product inventory movement audit.
- Added *synthetic only* fixture 01_live_inventory_audit_fixture.sql
  reproducing actual production stock-audit behavior. New SQL regression 47
  verifies one stock deduction movement and one compensating restoration
  movement during manager fulfillment and delivery reversal, without a
  double audit caused by idempotent repeated fulfillment. Also covers the
  approved margin-exception stock update/restore.
- Added *synthetic only* fixture 56_live_credit_guards_fixture.sql with
  read-only-introspected production Finbot status and immutable reserved
  credit note guards. Regression 57 proves that reserved totals and items
  cannot be changed, uncertain status cannot simply be retried, failed
  requires documented evidence, and a confirmed document cannot be
  reclassified. No real external provider was contacted.
- Full GitHub Actions run 45484277899: all THREE jobs SUCCESS:
  Node rules, Vite + three public PDF Edge builds, and the extended
  isolated PostgreSQL stock/credit/commission/RLS suite.
- This strengthens realism but does NOT equal a fully restored production
  schema with actual users and integration secrets. Release HOLD remains:
  isolated schema-complete rehearsal, real portal/PDF anonymous smoke tests
  after coordinated user-approved deployment, manager identity seed and
  explicit approval before any production migration.
- No live product/price/stock/payment/credit modifications, no PR merge,
  no new cloud database branch and no added charges.


## 2026-11-24 — Installation dependency manifest (review only)

- Created RELEASE_MANIFEST_REVIEW_ONLY.json covering all 27 staged
  NOT_APPLIED SQL migrations EXACTLY ONCE, separate from the synthetic CI
  fixture/test order. Three explicit owner-approved gates:
  * core (22 files): requires full isolated rehearsal, backup/rollback plan,
    explicit owner-manager identity provisioning;
  * public_docs_security (3 files): deploy/verify three document Edge
    Functions and matching frontend with agent flag OFF; smoke-test
    anonymous links and portal before closing public quote/settings read;
  * legacy_counter_security (2 files): management identity seed, legacy
    counter callers compatibility, separate approval.
- tests/agentReleaseManifest.test.js checks migration coverage against CI,
  prohibited production execution, required prerequisites and SQL
  dependencies. No automatic database execution is attached to the manifest.
- GitHub Actions 45484878230: all three jobs SUCCESS, including manifest
  contract, synthetic PostgreSQL tests, Vite, and public Edge parsing.
- Still NOT production-schema-faithful: this does not substitute for full
  restore/isolated rehearsal nor live public PDF/portal checks.
- No live installation, data mutations, configuration switches, or paid
  services.


## 2026-11-24 — CLEAN 27-migration release-order rehearsal PASS

- New tests/agent-db/rehearse_release_manifest.sh builds an independent
  disposable PostgreSQL database inside GitHub Actions. It uses fictional
  schema/data only; no Supabase production URL, password or project ref.
- Rehearsal executes EXACT RELEASE_MANIFEST_REVIEW_ONLY.json ordering:
  22 core migrations, 3 public-document security migrations and 2 legacy
  counter security migrations. The owner-manager test identity is seeded
  only after table 01 was installed. The script verifies all expected
  objects and that old global quote/settings reads are removed, anonymous
  settings SELECT is revoked, and the manager legacy quote counter works.
- First test found a fixture-only cluster-global role collision when
  the second database was initialized. Adjusted fixture setup so roles
  are created only once per disposable PostgreSQL CLUSTER; this does
  not change any production migration or user role.
- Re-ran CI: GitHub Actions 45485459157. All 3 jobs SUCCESS.
  Inspected SQL job log and confirmed exact output:
  "27-file staged release manifest applied in clean synthetic PostgreSQL: PASS".
  The run additionally executes earlier interleaved SQL/financial tests,
  negative owner-seed rollback test, Node rules and Vite/Edge builds.
- THIS IS NOT a production-schema-complete restored QuickStock rehearsal.
  It does not use real customer orders, Auth sessions, portal credentials,
  external invoices, live public PDFs, or a paid Supabase branch.
- The production release remains ON HOLD until owner-approved coordinated
  Edge/frontend/RLS rollout, full schema-faithful rehearsal, browser smoke
  tests and first agent provisioning. Do not merge or apply staged SQL.


## 2026-11-24 — Production constraints included in synthetic Finbot credit tests

- READ-ONLY metadata inspection found production public.credit_notes has
  constraint credit_notes_confirmed_needs_evidence_check: any row with
  finbot_status='confirmed' MUST have a non-blank
  external_credit_note_number. Also verified the allowed status CHECK
  pending/confirmed/failed/uncertain.
- Previous disposable tests omitted both constraints and created confirmed
  synthetic credit records without external document evidence. This was
  weaker than real QuickStock and could mask a compatibility failure.
- Added the two real CHECK constraints to the isolated-only
  56_live_credit_guards_fixture.sql, updated affected synthetic fixtures
  60/70/101 to carry clearly fictional external document references, and
  added a negative regression in test 57: confirmed without a document
  reference must be rejected; with a reference it is allowed and final.
- GitHub Actions 45486166975: all three jobs SUCCESS, including
  SQL/RLS commission + credit reversal, Node rules, UI and staged PDF
  functions. Real production constraint names and types were verified
  read-only; no real invoice/credit customer data or secrets were copied.
- The clean 27-file isolated rehearsal remains available; no production
  migration or user action executed. Full production-schema restore and
  genuine portal/PDF compatibility checks are still release gates.
