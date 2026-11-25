-- STAGED ONLY — do not apply in production without owner approval.
--
-- Read-only live introspection on 2026-11-24 confirmed
-- public.business_settings has public_read_business_settings USING(true)
-- and anon SELECT privilege. The table also has api_url, api_key, api_secret
-- and api_company_id columns. RLS is row-based; a public SELECT policy
-- does NOT protect those sensitive columns from select("*").
--
-- QuotePDFPreview and OrderPDFPreview have been staged to consume public
-- Edge Functions returning ONLY safe business display fields. This migration
-- must deploy atomically with BOTH updated Edge Functions and both frontend
-- preview pages. Verify all other public integrations first.
begin;
drop policy if exists public_read_business_settings on public.business_settings;

-- Keep the exact existing owner-scoped read policy unchanged. A manager who
-- is not the owner auth user retains their existing access semantics; this
-- policy does not add a new broad manager permission or expose secret fields.
-- Explicitly close remote anonymous table SELECT independent of RLS policy.
revoke select on public.business_settings from anon;
commit;
