-- SYNTHETIC DB ONLY: existing production credit-note BEFORE UPDATE
-- guards, copied behaviorally from read-only pg_get_functiondef inspection.
-- Real customer data and financial documents are NEVER used.
alter table public.credit_notes
 add column operation_id uuid,
 add column items jsonb,
 add column credit_note_number text,
 add column finbot_resolution_note text;

create or replace function public.credit_notes_guard_finbot_status()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $status_guard$
begin
 if new.finbot_status is not distinct from old.finbot_status then return new; end if;
 if old.finbot_status is not null and new.finbot_status is null then
   raise exception 'credit_notes: refusing to erase finbot_status (was %). A finding about a tax document is not reversible.',old.finbot_status;
 end if;
 if old.finbot_status='confirmed' then
   raise exception 'credit_notes: % is confirmed and cannot change state. Correct it by issuing another credit document.',old.credit_note_number;
 end if;
 if old.finbot_status='uncertain' and new.finbot_status='pending' then
   raise exception 'credit_notes: % is uncertain — a Finbot document may already exist for it, and Finbot has no endpoint that can tell us. Retrying would risk a second credit document. Check Finbot: if the document exists set finbot_status to confirmed with its number, and only if it does not, set failed.',old.credit_note_number;
 end if;
 if old.finbot_status='uncertain' and new.finbot_status='failed'
    and (new.finbot_resolution_note is null or btrim(new.finbot_resolution_note)='') then
   raise exception 'credit_notes: % is uncertain; calling it failed unlocks a retry that could issue a second credit document. Set finbot_resolution_note in the same statement with the evidence that Finbot holds no such document.',old.credit_note_number;
 end if;
 return new;
end;
$status_guard$;

create or replace function public.credit_notes_freeze_reserved()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $reserved_guard$
begin
 if old.operation_id is null then return new; end if;
 if new.items is distinct from old.items then
   raise exception 'credit_notes: % was reserved; its items cannot be changed. Issue a separate credit note instead.',old.credit_note_number using errcode='check_violation';
 end if;
 if new.total is distinct from old.total then
   raise exception 'credit_notes: % was reserved for %; its total cannot be changed.',old.credit_note_number,old.total using errcode='check_violation';
 end if;
 if new.invoice_id is distinct from old.invoice_id then
   raise exception 'credit_notes: % belongs to invoice %; it cannot be moved to another.',old.credit_note_number,old.invoice_id using errcode='check_violation';
 end if;
 if new.operation_id is distinct from old.operation_id then
   raise exception 'credit_notes: the operation id of % cannot be changed — it is what makes a retry safe.',old.credit_note_number using errcode='check_violation';
 end if;
 return new;
end;
$reserved_guard$;
create trigger credit_notes_finbot_status_guard
before update on public.credit_notes
for each row execute function public.credit_notes_guard_finbot_status();
create trigger credit_notes_freeze_reserved_guard
before update on public.credit_notes
for each row execute function public.credit_notes_freeze_reserved();

-- Real production CHECK constraints also reject a confirmed credit without
-- external tax-document evidence. The earlier synthetic schema omitted this.
alter table public.credit_notes
 add constraint credit_notes_confirmed_needs_evidence_check
 check (finbot_status is distinct from 'confirmed'
        or (external_credit_note_number is not null
            and btrim(external_credit_note_number) <> ''));
alter table public.credit_notes
 add constraint credit_notes_finbot_status_check
 check (finbot_status is null
        or finbot_status in ('pending','confirmed','failed','uncertain'));
