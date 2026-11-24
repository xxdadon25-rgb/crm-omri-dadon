# Public document compatibility — staged release runbook (NOT EXECUTED)

## Verified in live production by read-only introspection

- `quotes`: `public_read_quotes` is a permissive `SELECT TO public USING(true)` policy.
- `business_settings`: `public_read_business_settings` is a permissive
  `SELECT TO public USING(true)` policy, and `anon` has table SELECT.
- `business_settings` includes `api_url`, `api_key`, `api_secret`
  and `api_company_id` columns. **Never retrieve, log, or publish their values.**
- `/quote-pdf/:quoteId` formerly read `quotes.select("*")` and
  `business_settings.select("*")` in the browser.
- `/order-pdf/:orderId` already uses deployed `public-order-pdf` Edge
  Function for orders, but formerly loaded public business settings from
  the browser. Both URLs are known public, customer-facing links.
- Exact code search against GitHub's index returned no reliable results;
  we inspected `src/App.jsx`, `QuotePDFPreview.jsx`,
  `OrderPDFPreview.jsx`, `QuoteEditor.jsx`, `Quotes.jsx`,
  `src/api/entities.js` and portal dashboard/orders source directly.
  This is *not* proof of all external integrations or old installed clients.

## Staged alternative that preserves existing UUID link formats

1. New `supabase/functions/public-quote-pdf/index.ts` accepts a single
   UUID in a POST body (no JWT, like existing public-order-pdf), looks up
   only that quote through the server service role, returns an explicitly
   allowlisted public quote and six public business display fields.
   It does not expose owner IDs, buyer IDs, purchase costs or API keys.
2. Updated `public-order-pdf/index.ts` continues returning the same
   `order` shape and additionally returns safe business display fields.
   Its customer-facing order UUID URL stays unchanged.
3. Both staged React PDF pages use their respective Edge Functions, with
   no direct public `quotes` or `business_settings` table SELECT.
4. Staged stage 25 removes the global public quote SELECT, leaving owner,
   assigned agent and own authenticated portal policies.
5. Staged stage 27 removes global public business settings SELECT and
   revokes `anon` table SELECT. Owner-scoped policy remains unchanged.
6. Stage 26 counter hardening is a DIFFERENT migration and still needs a
   compatibility verification for all legacy portal/client callers.

## Mandatory rollout conditions (release HOLD)

- Never deploy the two React pages BEFORE the matching Edge Functions are
  live and verified; never apply 25/27 BEFORE the matched frontend and Edge
  Functions have been tested from an incognito phone browser.
- Public quote UUID is treated as a bearer share link; anyone in possession
  can read that one quote, matching the already agreed public-order-PDF
  access model. Existing distributed UUID links retain their format, but
  actual anonymous production smoke tests remain REQUIRED.
- Deno Edge Functions require verify_jwt=false for public recipients. Do
  not transmit or log service role key, database API secret, or full settings.
  Verify domain allowlist includes the real deployed public domain; known
  current allowed origins are `adstock.co.il` and `www.adstock.co.il`.
- Confirm that the older order-PDF generator uses no missing essential
  business profile fields; historically it requested `fax` and
  `payment_terms`, neither present in the inspected live
  `business_settings` columns. The new safe endpoint returns only the
  six existing display columns.
- Test owner quote creation (QuoteEditor uses `get_next_quote_number`),
  quote->order conversion, portal login/catalog and public order/quote
  download before revoking existing public privileges.
- Run a privilege check after migration: `anon` must not SELECT from
  either base table; only scoped owner/agent/portal reads may work.
- Back up deployment/function versions and stage SQL beforehand. Recovery
  requires explicit approval; do not silently re-open public API-credential
  access as a routine rollback.
- Check historical API credentials for exposure and plan rotation through
  supported providers if they have real scopes. Do not display values.

## Tests actually executed

- PostgreSQL synthetic SQL/RLS security suite including anonymous / owner /
  portal / agent quotes and the staged settings access restriction.
- Node static contract tests for public PDF frontend calls, approved
  business allowlists and explicit line-item fields.
- Vite frontend build and esbuild TypeScript parse of both staged functions.
- GitHub Actions run 45480869661: all three jobs SUCCESS.

**No production migrations, Edge Functions, frontend deployments, data edits,
credentials rotations, new paid project, or first agent activation occurred.**
