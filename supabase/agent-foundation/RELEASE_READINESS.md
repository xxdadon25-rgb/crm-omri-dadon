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
