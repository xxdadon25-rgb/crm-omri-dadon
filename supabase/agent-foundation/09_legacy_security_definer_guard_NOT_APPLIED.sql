-- STAGED ONLY, DO NOT APPLY TO LIVE PRODUCTION.
-- Requires 01_schema_NOT_APPLIED.sql (agent profiles table).
-- Explicitly blocks ANY user present in sales_agent_profiles, even inactive,
-- from the seven existing owner-only SECURITY DEFINER write/credit APIs.
-- Without this, their creator privileges bypass table RLS.
-- Manager/Ben's existing shared login has no agent profile: unchanged.
-- Confirm each function body still matches deployed code before applying;
-- the implementation is a point-in-time snapshot and must not overwrite
-- later production changes. Test role impersonation + old manager flow in
-- an isolated database before ANY production deployment.

begin;

-- Existing function: allocate_payment_across_invoices. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.allocate_payment_across_invoices(p_group_id uuid, p_customer_id uuid, p_allocations jsonb, p_payment_method text, p_payment_date date, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_branch text DEFAULT NULL::text, p_bank_account text DEFAULT NULL::text, p_check_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_existing     INT;
  v_alloc        JSONB;
  v_invoice_id   UUID;
  v_amount       NUMERIC;
  v_inv          RECORD;
  v_remaining    NUMERIC;
  v_new_paid     NUMERIC;
  v_new_status   TEXT;
  v_total        NUMERIC := 0;
  v_count        INT := 0;
  v_payment_ids  UUID[] := ARRAY[]::UUID[];
  v_payment_id   UUID;
  -- invoice_id -> payment_id -> amount, returned explicitly. The caller issues
  -- one Finbot receipt per allocation and must write each receipt number onto
  -- the right row; matching by array POSITION would break silently the day the
  -- loop order changes, so the pairing is stated rather than implied.
  v_lines        JSONB := '[]'::jsonb;
  v_customer     RECORD;
  -- Invoices this payment settled in full. Returned so the caller can complete
  -- the orders they cover, exactly as the single-invoice flow does.
  v_settled      UUID[] := ARRAY[]::UUID[];
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  -- ---- authentication -----------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'group_id_required';
  END IF;

  -- ---- serialise the group ------------------------------------------------
  -- Taken BEFORE the idempotency count, and this ordering is the whole point.
  --
  -- Under READ COMMITTED the count below cannot see an uncommitted sibling, so
  -- two simultaneous submissions of the SAME group id would both read zero and
  -- both insert. Blocking on the invoice locks further down does not save it:
  -- by then the stale count has already been taken, and after the first
  -- transaction commits the second simply proceeds with it — recording the
  -- same money twice whenever the invoices still have room for it.
  --
  -- A unique constraint cannot express this, because N rows legitimately share
  -- one group id. A transaction-level advisory lock keyed on the group does:
  -- the second caller waits here until the first commits or aborts, and then
  -- its count sees the truth.
  --
  -- The first key is a fixed namespace so this cannot collide with an advisory
  -- lock taken elsewhere; a hash collision between two different groups only
  -- makes them take turns, which is harmless.
  PERFORM pg_advisory_xact_lock(492117, hashtext(p_group_id::text));

  -- ---- idempotency --------------------------------------------------------
  -- A re-submitted group (double click, retried request, a browser that lost
  -- the response) must NOT record the payment twice.
  SELECT count(*) INTO v_existing
    FROM public.payments
   WHERE user_id = v_uid AND payment_group_id = p_group_id;

  IF v_existing > 0 THEN
    SELECT coalesce(sum(amount), 0), count(*)
      INTO v_total, v_count
      FROM public.payments
     WHERE user_id = v_uid AND payment_group_id = p_group_id;

    -- Which of this group's invoices are fully paid NOW. Reported on the
    -- retry path too, so a submission whose response was lost still gets its
    -- orders completed; that update is scoped by order status and is therefore
    -- harmless to repeat.
    SELECT coalesce(array_agg(DISTINCT i.id), ARRAY[]::uuid[])
      INTO v_settled
      FROM public.payments p
      JOIN public.invoices i ON i.id = p.invoice_id AND i.user_id = v_uid
     WHERE p.user_id = v_uid AND p.payment_group_id = p_group_id
       AND i.payment_status = 'שולם';

    -- The group's rows and the state of each one's receipt, so the caller can
    -- say WHICH allocations still lack a confirmed receipt. It still issues
    -- nothing on this path: a row left at 'pending' may have been attempted by
    -- the submission whose response was lost, and re-issuing it could produce
    -- a second tax document for the same allocation.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'invoice_id', p.invoice_id, 'payment_id', p.id, 'amount', p.amount,
             'invoice_number', p.invoice_number, 'receipt_status', p.receipt_status)
           ORDER BY p.amount), '[]'::jsonb)
      INTO v_lines
      FROM public.payments p
     WHERE p.user_id = v_uid AND p.payment_group_id = p_group_id;

    RETURN jsonb_build_object(
      'ok', true, 'already_recorded', true,
      'group_id', p_group_id, 'payment_count', v_count, 'total_amount', v_total,
      'settled_invoice_ids', to_jsonb(v_settled),
      'lines', v_lines
    );
  END IF;

  -- ---- the allocation list ------------------------------------------------
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'no_allocations';
  END IF;

  -- The customer must belong to the caller. Resolved once, and its name is
  -- denormalised onto the payment rows exactly as the existing dialog does.
  SELECT * INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id AND user_id = v_uid;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- ---- one invoice at a time, under lock ----------------------------------
  FOR v_alloc IN SELECT jsonb_array_elements(p_allocations)
  LOOP
    v_invoice_id := (v_alloc ->> 'invoice_id')::uuid;
    v_amount     := round((v_alloc ->> 'amount')::numeric, 2);

    IF v_invoice_id IS NULL THEN
      RAISE EXCEPTION 'invoice_id_required';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_amount:%', v_invoice_id;
    END IF;

    -- FOR UPDATE is the whole point: it serialises two payments racing for the
    -- same invoice. Without it both could read paid_amount = 0 and each write
    -- its own total, losing one of them and overpaying the invoice.
    --
    -- The ownership filter is part of the same statement, so an invoice that is
    -- not the caller's is indistinguishable from one that does not exist.
    SELECT * INTO v_inv
      FROM public.invoices
     WHERE id = v_invoice_id AND user_id = v_uid
     FOR UPDATE;

    IF v_inv IS NULL THEN
      RAISE EXCEPTION 'invoice_not_found:%', v_invoice_id;
    END IF;

    -- An invoice belonging to a different customer must never be settled by
    -- this customer's payment.
    IF v_inv.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'invoice_customer_mismatch:%', v_invoice_id;
    END IF;

    -- A credited invoice is no longer a debt; paying it would be meaningless.
    IF v_inv.credited_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoice_credited:%', v_invoice_id;
    END IF;

    -- ---- overpayment prevention, decided inside the lock ----------------
    v_remaining := round(coalesce(v_inv.total, 0) - coalesce(v_inv.paid_amount, 0), 2);
    IF v_amount > v_remaining THEN
      RAISE EXCEPTION 'overpayment:%:%:%', v_invoice_id, v_amount, v_remaining;
    END IF;

    v_new_paid := round(coalesce(v_inv.paid_amount, 0) + v_amount, 2);
    -- The SAME rule the single-invoice dialog applies, so a split payment and
    -- a direct one leave an invoice in an identical state.
    v_new_status := CASE WHEN v_new_paid >= round(coalesce(v_inv.total, 0), 2)
                         THEN 'שולם' ELSE 'שולם חלקית' END;

    INSERT INTO public.payments (
      user_id, invoice_id, invoice_number, customer_id, customer_name,
      amount, payment_method, payment_date, reference, notes, status,
      bank_name, bank_branch, bank_account, check_number, payment_group_id,
      -- The receipt has not been attempted yet when this transaction commits.
      -- Starting at 'pending' means a payment whose caller dies before the
      -- webhook call is findable afterwards instead of looking complete.
      receipt_status
    ) VALUES (
      v_uid, v_invoice_id, v_inv.invoice_number, p_customer_id, v_customer.name,
      v_amount, p_payment_method, p_payment_date, p_reference, p_notes, 'אושר',
      p_bank_name, p_bank_branch, p_bank_account, p_check_number, p_group_id,
      'pending'
    )
    RETURNING id INTO v_payment_id;

    v_payment_ids := v_payment_ids || v_payment_id;
    v_lines := v_lines || jsonb_build_object(
      'invoice_id', v_invoice_id,
      'payment_id', v_payment_id,
      'amount', v_amount,
      'invoice_number', v_inv.invoice_number,
      'payment_status', v_new_status
    );
    IF v_new_status = 'שולם' THEN
      v_settled := v_settled || v_invoice_id;
    END IF;

    UPDATE public.invoices
       SET paid_amount = v_new_paid,
           payment_status = v_new_status
     WHERE id = v_invoice_id AND user_id = v_uid;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;

  -- Any RAISE above aborts the whole function, so either every allocation was
  -- recorded or none was. There is no partial state to clean up.
  RETURN jsonb_build_object(
    'ok', true, 'already_recorded', false,
    'group_id', p_group_id, 'payment_count', v_count,
    'total_amount', v_total, 'payment_ids', to_jsonb(v_payment_ids),
    'settled_invoice_ids', to_jsonb(v_settled),
    'lines', v_lines
  );
END;
$function$;

-- Existing function: create_order_with_inventory. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.create_order_with_inventory(p_request_id uuid, p_order jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_settings public.business_settings%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_counter integer;
  v_fulfilled boolean;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_request_id IS NULL OR p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_order) AS k
    WHERE k NOT IN ('customer_id','customer_name','customer_tax_id',
      'date','delivery_date','delivery_address','items','subtotal',
      'gross_total','discount_amount','vat_rate','vat_amount','total',
      'total_override','notes','status','fulfilled','agent')) THEN
    RAISE EXCEPTION 'unknown_order_field';
  END IF;
  IF jsonb_typeof(p_order->'items') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_order->'items')=0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;
  IF nullif(trim(p_order->>'customer_name'),'') IS NULL THEN
    RAISE EXCEPTION 'customer_required';
  END IF;

  -- The UUID is generated once by the client, and makes retries idempotent.
  SELECT * INTO v_order FROM public.orders
    WHERE id=p_request_id AND user_id=v_caller;
  IF FOUND THEN RETURN v_order; END IF;

  -- Serialize all new order numbers for this user, including concurrent tabs.
  SELECT * INTO v_settings FROM public.business_settings
    WHERE user_id=v_caller ORDER BY created_date LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_not_found'; END IF;
  SELECT * INTO v_order FROM public.orders
    WHERE id=p_request_id AND user_id=v_caller;
  IF FOUND THEN RETURN v_order; END IF;
  SELECT greatest(coalesce(v_settings.order_counter,1000),
                  coalesce(max(order_number),1000))+1
    INTO v_counter FROM public.orders WHERE user_id=v_caller;
  v_fulfilled:=coalesce((p_order->>'fulfilled')::boolean,false);

  INSERT INTO public.orders(id,user_id,order_number,customer_id,customer_name,
      customer_tax_id,date,delivery_date,delivery_address,items,subtotal,
      gross_total,discount_amount,vat_rate,vat_amount,total,total_override,
      notes,status,fulfilled,inventory_deducted,agent)
  VALUES(p_request_id,v_caller,v_counter,
      nullif(p_order->>'customer_id','')::uuid,p_order->>'customer_name',
      p_order->>'customer_tax_id',nullif(p_order->>'date','')::date,
      nullif(p_order->>'delivery_date','')::date,
      p_order->>'delivery_address',p_order->'items',
      nullif(p_order->>'subtotal','')::numeric,
      nullif(p_order->>'gross_total','')::numeric,
      nullif(p_order->>'discount_amount','')::numeric,
      nullif(p_order->>'vat_rate','')::numeric,
      nullif(p_order->>'vat_amount','')::numeric,
      nullif(p_order->>'total','')::numeric,
      nullif(p_order->>'total_override','')::numeric,
      p_order->>'notes',coalesce(nullif(p_order->>'status',''),'ממתין לאישור'),false,false,p_order->>'agent')
  RETURNING * INTO v_order;

  IF v_fulfilled THEN
    SELECT * INTO v_order FROM public.save_order_with_inventory(
      p_request_id, '{"fulfilled":true}'::jsonb,false
    );
  END IF;
  -- Save the latest per-product price for this customer on new orders.
  -- This never changes catalog prices or prices for another customer.
  IF v_order.customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id=v_order.customer_id AND c.user_id=v_caller
    ) THEN RAISE EXCEPTION 'customer_not_found'; END IF;

    INSERT INTO public.customer_product_prices
      (customer_id, product_id, unit_price, updated_at)
    SELECT v_order.customer_id, s.product_id, s.unit_price, now()
    FROM (
      SELECT DISTINCT ON (i.value->>'product_id')
        (i.value->>'product_id')::uuid AS product_id,
        (i.value->>'unit_price')::numeric AS unit_price
      FROM jsonb_array_elements(v_order.items) WITH ORDINALITY AS i(value, position)
      JOIN public.products p ON p.id = nullif(i.value->>'product_id','')::uuid
        AND p.user_id=v_caller
      WHERE nullif(i.value->>'product_id','') IS NOT NULL
        AND nullif(i.value->>'unit_price','') IS NOT NULL
        AND (i.value->>'unit_price') ~ '^[+]?[0-9]+([.][0-9]+)?$'
      ORDER BY i.value->>'product_id', i.position
    ) s
    WHERE s.unit_price >= 0
    ON CONFLICT (customer_id, product_id) DO UPDATE
      SET unit_price=EXCLUDED.unit_price, updated_at=EXCLUDED.updated_at;
  END IF;

  UPDATE public.business_settings SET order_counter=v_counter WHERE id=v_settings.id;
  RETURN v_order;
END;
$function$;

-- Existing function: credit_note_confirm. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.credit_note_confirm(p_credit_note_id uuid, p_external_number text, p_external_url text DEFAULT NULL::text, p_source text DEFAULT 'api'::text, p_document_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_cn       public.credit_notes;
  v_invoice  public.invoices;
  v_restored INT := 0;
  v_full     BOOLEAN := false;
  v_pid      UUID;
  v_qty      NUMERIC;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_confirm: not authenticated';
  END IF;
  IF p_external_number IS NULL OR btrim(p_external_number) = '' THEN
    RAISE EXCEPTION 'credit_note_confirm: a Finbot document number is required — confirmed means a document exists';
  END IF;
  IF p_source NOT IN ('api', 'manual') THEN
    RAISE EXCEPTION 'credit_note_confirm: source must be api or manual, not %', p_source;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_confirm: credit note % not found', p_credit_note_id;
  END IF;

  PERFORM pg_advisory_xact_lock(492118, hashtext(v_cn.invoice_id::text));

  -- Already settled. Report rather than raise, so a retried confirmation after
  -- a dropped response is harmless — and restore nothing a second time.
  IF v_cn.finbot_status = 'confirmed' THEN
    IF btrim(COALESCE(v_cn.external_credit_note_number, '')) = btrim(p_external_number) THEN
      -- A repeat confirmation may supply the date that was missing, and only
      -- the date: nothing else about a confirmed document changes.
      IF v_cn.date IS NULL AND p_document_date IS NOT NULL THEN
        UPDATE public.credit_notes SET date = p_document_date WHERE id = v_cn.id;
      END IF;
      RETURN jsonb_build_object('confirmed', true, 'already', true,
                                'restored_products', 0,
                                'date_recorded', v_cn.date IS NULL AND p_document_date IS NOT NULL);
    END IF;
    RAISE EXCEPTION
      'credit_note_confirm: % is already confirmed as document %; refusing to attach a second document (%)',
      v_cn.credit_note_number, v_cn.external_credit_note_number, p_external_number;
  END IF;

  UPDATE public.credit_notes
     SET finbot_status = 'confirmed',
         external_credit_note_number = btrim(p_external_number),
         external_credit_note_url = COALESCE(p_external_url, external_credit_note_url),
         finbot_confirmed_source = p_source,
         -- COALESCE, not assignment: a date already on the row was recorded
         -- when the document was created and is not re-stated by a later
         -- confirmation of the same credit.
         date = COALESCE(date, p_document_date),
         finbot_attempted_at = COALESCE(finbot_attempted_at, now()),
         finbot_resolved_at = CASE WHEN p_source = 'manual' THEN now()
                                   ELSE finbot_resolved_at END
   WHERE id = v_cn.id;

  -- ---- stock, once, from the RESOLVED lines ------------------------------
  -- credit_note_return_lines validates and resolves in one pass, and every
  -- product id it yields comes FROM THE INVOICE LINE. This loop therefore
  -- cannot be pointed at a product the invoice never carried.
  --
  -- It used to read the credit line directly, as
  -- COALESCE(line ->> 'product_id', line ->> 'id') — and that `id` was checked
  -- against nothing: a line with an index and no product_id passed the
  -- validator untouched and then had stock added to whatever `id` said.
  --
  -- The re-validation is still a re-validation: items are frozen after reserve
  -- by the trigger below, but the INVOICE can change, and the cumulative
  -- per-line limit is recomputed here with this credit note excluded from its
  -- own sum.
  --
  -- A price adjustment yields no row at all, so an overcharge credit moves
  -- nothing.
  FOR v_pid, v_qty IN
    SELECT r.product_id, r.qty
      FROM public.credit_note_return_lines(
             v_cn.invoice_id, COALESCE(v_cn.items, '[]'::jsonb), v_cn.id) r
  LOOP
    -- One statement. No read-then-write, so nothing is lost under concurrency.
    -- The quantity is added in the SAME units the order deducted, which is what
    -- keeps a credit an exact reversal of its sale.
    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + v_qty
     WHERE id = v_pid AND user_id = v_uid;
    IF FOUND THEN v_restored := v_restored + 1; END IF;
  END LOOP;

  -- ---- the invoice, only for a FULL credit -------------------------------
  -- TEMPORARY, AND DELIBERATELY IDENTICAL TO TODAY'S BEHAVIOUR.
  --
  -- Twelve places in the application read invoices.credited_at to decide
  -- whether an invoice is still a debt and whether the credit button is
  -- offered. Gate C replaces all of them with a figure derived from the credit
  -- notes, after which this block goes away and invoices become immutable.
  -- Until then, not writing it would make a credited invoice look open again
  -- and offer the credit button a second time — a worse outcome than the
  -- write.
  --
  -- The change from today is one of TIMING, which is the point: it happens here,
  -- on confirmation, and never on a credit whose document may not exist.
  --
  -- A PARTIAL credit does not touch the invoice at all. There is no column that
  -- can express "partly credited", and inventing one by setting credited_at
  -- would hide the rest of the receivable.
  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = v_cn.invoice_id AND user_id = v_uid;
  IF FOUND THEN
    v_full := round(abs(COALESCE(v_cn.total, 0))::numeric, 2)
              >= round(abs(COALESCE(v_invoice.total, 0))::numeric, 2);
    IF v_full AND v_invoice.credited_at IS NULL THEN
      UPDATE public.invoices
         SET credited_at = now(),
             credit_note_id = v_cn.id,
             payment_status = 'זוכה'
       WHERE id = v_invoice.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('confirmed', true, 'already', false,
                            'restored_products', v_restored,
                            'full_credit', v_full,
                            'date_recorded', p_document_date IS NOT NULL);
END
$function$;

-- Existing function: credit_note_reserve. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.credit_note_reserve(p_operation_id uuid, p_invoice_id uuid, p_credit_note_number text, p_items jsonb, p_total numeric, p_reason text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_created_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_existing  public.credit_notes;
  v_invoice   public.invoices;
  v_amount    NUMERIC;
  v_committed NUMERIC;
  v_new       public.credit_notes;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_reserve: not authenticated';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'credit_note_reserve: operation_id is required — it is what makes a retry safe';
  END IF;

  -- The amount is held as a POSITIVE magnitude for the arithmetic and stored
  -- with the sign the table already uses (negative), so nothing downstream has
  -- to change how it reads `total`.
  v_amount := round(abs(COALESCE(p_total, 0))::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'credit_note_reserve: a credit of % is not an amount', p_total;
  END IF;

  -- ---- idempotency, BEFORE the lock and before any validation -------------
  -- A repeat of a settled operation must not be able to fail on a cap that has
  -- since been reached by its own earlier attempt.
  SELECT * INTO v_existing FROM public.credit_notes
   WHERE user_id = v_uid AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'credit_note_id', v_existing.id,
      'credit_note_number', v_existing.credit_note_number,
      'finbot_status', v_existing.finbot_status,
      'external_credit_note_number', v_existing.external_credit_note_number,
      'total', v_existing.total
    );
  END IF;

  -- ---- one writer per invoice --------------------------------------------
  -- Taken BEFORE the cap is computed. Read committed would otherwise let two
  -- concurrent reservations each read a stale sum and both pass.
  PERFORM pg_advisory_xact_lock(492118, hashtext(p_invoice_id::text));

  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = p_invoice_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_reserve: invoice % not found', p_invoice_id;
  END IF;

  -- ---- the cap -----------------------------------------------------------
  -- Everything that might exist as a document. 'failed' is excluded: it is the
  -- one state that means Finbot created nothing.
  SELECT COALESCE(sum(round(abs(total)::numeric, 2)), 0) INTO v_committed
    FROM public.credit_notes
   WHERE user_id = v_uid
     AND invoice_id = p_invoice_id
     AND (finbot_status IS NULL OR finbot_status <> 'failed');

  IF v_committed + v_amount > round(abs(COALESCE(v_invoice.total, 0))::numeric, 2) THEN
    RAISE EXCEPTION
      'credit_note_reserve: crediting % would take the invoice past its total — already credited %, invoice total %',
      v_amount, v_committed, round(abs(COALESCE(v_invoice.total, 0))::numeric, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- the lines, against the invoice ------------------------------------
  -- Under the same advisory lock as the amount cap, so the cumulative per-line
  -- check cannot read a stale sum either.
  PERFORM public.credit_note_check_items(p_invoice_id, COALESCE(p_items, '[]'::jsonb), NULL);

  INSERT INTO public.credit_notes (
    user_id, credit_note_number, invoice_id, order_id, customer_id,
    items, total, reason, created_by,
    operation_id, finbot_status, finbot_attempted_at
  ) VALUES (
    v_uid, p_credit_note_number, p_invoice_id, p_order_id, v_invoice.customer_id,
    COALESCE(p_items, '[]'::jsonb), -v_amount, p_reason, p_created_by,
    p_operation_id, 'pending', NULL
  )
  RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'created', true,
    'credit_note_id', v_new.id,
    'credit_note_number', v_new.credit_note_number,
    'finbot_status', v_new.finbot_status,
    'external_credit_note_number', NULL,
    'total', v_new.total
  );
END
$function$;

-- Existing function: credit_note_resolve. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.credit_note_resolve(p_credit_note_id uuid, p_status text, p_error text DEFAULT NULL::text, p_evidence text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_cn  public.credit_notes;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_resolve: not authenticated';
  END IF;
  IF p_status NOT IN ('failed', 'uncertain') THEN
    RAISE EXCEPTION 'credit_note_resolve: % is not a resolution; use credit_note_confirm for a document that exists', p_status;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_resolve: credit note % not found', p_credit_note_id;
  END IF;

  IF v_cn.finbot_status = 'uncertain' AND p_status = 'failed'
     AND (p_evidence IS NULL OR btrim(p_evidence) = '') THEN
    RAISE EXCEPTION
      'credit_note_resolve: % is uncertain; calling it failed unlocks a retry that could issue a second credit document. Pass the evidence that Finbot holds no such document.',
      v_cn.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.credit_notes
     SET finbot_status = p_status,
         finbot_error = COALESCE(p_error, finbot_error),
         finbot_attempted_at = now(),
         finbot_resolution_note = COALESCE(NULLIF(btrim(COALESCE(p_evidence, '')), ''),
                                           finbot_resolution_note),
         finbot_resolved_at = CASE
           WHEN NULLIF(btrim(COALESCE(p_evidence, '')), '') IS NOT NULL THEN now()
           ELSE finbot_resolved_at END
   WHERE id = v_cn.id;

  RETURN jsonb_build_object('status', p_status, 'credit_note_id', v_cn.id);
END
$function$;

-- Existing function: credit_note_return_lines. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.credit_note_return_lines(p_invoice_id uuid, p_items jsonb, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, qty numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_invoice   public.invoices;
  v_line      JSONB;
  v_kind      TEXT;
  v_idx       INT;
  v_qty       NUMERIC;
  v_pid       TEXT;
  v_inv_line  JSONB;
  v_inv_pid   TEXT;
  v_inv_qty   NUMERIC;
  v_already   NUMERIC;
  v_in_req    NUMERIC;
  v_matches   INT;
  -- The line's POSITION in the request. The within-request sum below has to
  -- exclude the line being checked, and two lines of one request can be
  -- byte-identical — a split over-credit is likeliest to look exactly like
  -- that — so excluding by value silently excluded both and let the split
  -- through. Position is the only thing that distinguishes them.
  v_ord       INT;
  v_out_pid   UUID;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'credit_note_return_lines: not authenticated';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = p_invoice_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_note_return_lines: invoice % not found', p_invoice_id;
  END IF;

  FOR v_line, v_ord IN
    SELECT t.e, t.ord FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
           WITH ORDINALITY AS t(e, ord)
  LOOP
    v_kind := COALESCE(NULLIF(v_line ->> 'kind', ''), 'return');

    -- ---- a price adjustment may not carry a quantity ----------------------
    -- Crediting an overcharge returns no goods. confirm skips any kind that is
    -- not 'return', but a line that claims to be an adjustment while carrying
    -- stock is a malformed request and is refused rather than silently zeroed:
    -- quietly rewriting a caller's figures hides the disagreement.
    IF v_kind = 'price_adjustment' THEN
      IF COALESCE(NULLIF(v_line ->> 'quantity', '')::numeric, 0) <> 0 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: a price_adjustment line carries quantity % — a price credit returns no goods'
          , v_line ->> 'quantity'
          USING ERRCODE = 'check_violation';
      END IF;
      CONTINUE;
    END IF;

    IF v_kind <> 'return' THEN
      RAISE EXCEPTION 'credit_note_return_lines: unknown line kind %', v_kind
        USING ERRCODE = 'check_violation';
    END IF;

    v_qty := COALESCE(NULLIF(v_line ->> 'quantity', '')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'credit_note_return_lines: a return line has quantity %', v_qty
        USING ERRCODE = 'check_violation';
    END IF;
    v_pid := NULLIF(v_line ->> 'product_id', '');

    -- ---- which invoice line is this reversing? ---------------------------
    -- source_line_index is the identifier: invoices.items is a JSON array with
    -- no stable id, and the index is safe because invoices are immutable.
    -- Without one, the product is resolved by id — but only when it appears on
    -- the invoice EXACTLY ONCE, since the same product can be on two lines at
    -- different prices and guessing between them would credit the wrong one.
    BEGIN
      v_idx := NULLIF(v_line ->> 'source_line_index', '')::int;
    EXCEPTION WHEN invalid_text_representation THEN
      v_idx := NULL;
    END;

    IF v_idx IS NULL THEN
      IF v_pid IS NULL THEN
        RAISE EXCEPTION
          'credit_note_return_lines: a return line has neither source_line_index nor product_id'
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*), min(ord - 1) INTO v_matches, v_idx
        FROM jsonb_array_elements(COALESCE(v_invoice.items, '[]'::jsonb))
             WITH ORDINALITY AS t(e, ord)
       WHERE t.e ->> 'product_id' = v_pid;
      IF v_matches = 0 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: product % is not on invoice %', v_pid, p_invoice_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_matches > 1 THEN
        RAISE EXCEPTION
          'credit_note_return_lines: product % is on % lines of invoice %; source_line_index is required to say which',
          v_pid, v_matches, p_invoice_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_inv_line := COALESCE(v_invoice.items, '[]'::jsonb) -> v_idx;
    IF v_inv_line IS NULL THEN
      RAISE EXCEPTION
        'credit_note_return_lines: invoice % has no line %', p_invoice_id, v_idx
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- the product must be THAT line's product ------------------------
    v_inv_pid := NULLIF(v_inv_line ->> 'product_id', '');
    IF v_pid IS NOT NULL AND v_inv_pid IS NOT NULL AND v_pid <> v_inv_pid THEN
      RAISE EXCEPTION
        'credit_note_return_lines: line % of invoice % is product %, not %',
        v_idx, p_invoice_id, v_inv_pid, v_pid
        USING ERRCODE = 'check_violation';
    END IF;

    v_inv_qty := COALESCE(NULLIF(v_inv_line ->> 'quantity', '')::numeric, 0);

    -- ---- cumulative, across every credit that might exist --------------
    -- 'failed' is excluded: no document was created, so it holds nothing.
    --
    -- BOTH SUMS BELOW MATCH ON THE RESOLVED INVOICE LINE, NOT ON THE RAW INDEX.
    -- They used to compare `COALESCE(index, -1) = v_idx`, which meant a line
    -- carrying no source_line_index collapsed to -1 and could never equal a
    -- resolved index. Two consequences, both real:
    --
    --   * every LEGACY credit — written before the index existed — was
    --     invisible to the cumulative check, so an invoice already fully
    --     credited by one of them could be credited again
    --   * two index-less lines in ONE request, resolving to the same product,
    --     each failed to see the other, so a split over-credit passed
    --
    -- A line resolves to this invoice line when it names the index, OR when it
    -- names no index and carries this line's product — which is the same rule
    -- the resolution above uses.
    --
    -- When a product is on several invoice lines, an index-less stored line is
    -- genuinely ambiguous and is counted against each of them. That
    -- over-counts, which only ever refuses more; the alternative is to ignore
    -- it, which under-counts and lets stock through.
    SELECT COALESCE(sum(COALESCE(NULLIF(e ->> 'quantity', '')::numeric, 0)), 0)
      INTO v_already
      FROM public.credit_notes cn,
           jsonb_array_elements(COALESCE(cn.items, '[]'::jsonb)) e
     WHERE cn.user_id = v_uid
       AND cn.invoice_id = p_invoice_id
       AND (p_exclude IS NULL OR cn.id <> p_exclude)
       AND (cn.finbot_status IS NULL OR cn.finbot_status <> 'failed')
       AND COALESCE(NULLIF(e ->> 'kind', ''), 'return') = 'return'
       AND (
             COALESCE(NULLIF(e ->> 'source_line_index', '')::int, -1) = v_idx
             OR (NULLIF(e ->> 'source_line_index', '') IS NULL
                 AND v_inv_pid IS NOT NULL
                 AND e ->> 'product_id' = v_inv_pid)
           );

    -- Other lines of THIS request that resolve to the same invoice line, so a
    -- single call cannot split an over-credit across two lines and slip past.
    SELECT COALESCE(sum(COALESCE(NULLIF(t.e ->> 'quantity', '')::numeric, 0)), 0)
      INTO v_in_req
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
     WHERE COALESCE(NULLIF(t.e ->> 'kind', ''), 'return') = 'return'
       AND (
             COALESCE(NULLIF(t.e ->> 'source_line_index', '')::int, -1) = v_idx
             OR (NULLIF(t.e ->> 'source_line_index', '') IS NULL
                 AND v_inv_pid IS NOT NULL
                 AND t.e ->> 'product_id' = v_inv_pid)
           )
       AND t.ord <> v_ord;

    IF v_already + v_in_req + v_qty > v_inv_qty THEN
      RAISE EXCEPTION
        'credit_note_return_lines: crediting % of line % would exceed what was sold — sold %, already credited %, also in this request %',
        v_qty, v_idx, v_inv_qty, v_already, v_in_req
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- the row the stock loop will act on -----------------------------
    -- THE PRODUCT COMES FROM THE INVOICE LINE, not from the credit line. The
    -- credit line's product_id was checked against it above when present, and
    -- when absent nothing about it was ever verified — so it is not used.
    --
    -- An invoice line with no product id, or one that is not a uuid, is a
    -- free-text line: it yields no row, and no stock moves for it. That is
    -- what the previous loop did by skipping it.
    BEGIN
      v_out_pid := NULLIF(v_inv_pid, '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_out_pid := NULL;
    END;
    IF v_out_pid IS NOT NULL THEN
      RETURN QUERY SELECT v_out_pid, v_qty;
    END IF;
  END LOOP;
END
$function$;

-- Existing function: save_order_with_inventory. Generated from the exact currently deployed
-- pg_get_functiondef on 2026-11-23. Only a single deny-agent guard inserted
-- immediately after BEGIN; no other business logic is intentionally changed.
CREATE OR REPLACE FUNCTION public.save_order_with_inventory(p_order_id uuid, p_updates jsonb, p_restore_stock boolean DEFAULT false)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid;
  v_order        public.orders%ROWTYPE;
  v_prev         jsonb;
  v_next         jsonb;
  v_delta        jsonb;
  v_row          record;
  v_was_deducted boolean;
  v_will_fulfil  boolean;
  v_cancelled    boolean;
  v_mode         text;
  v_deducted     boolean;
  v_change       numeric;
  v_qty          numeric;
  v_new_qty      numeric;
  v_actual_change numeric;
  v_recorded_qty numeric;
BEGIN

  -- AGENT ACCESS GATE: legacy owner-only RPC, not the agent order path.
  -- auth.uid() is still the HTTP caller even inside SECURITY DEFINER.
  IF EXISTS (
    SELECT 1 FROM public.sales_agent_profiles ap
    WHERE ap.auth_user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'agent_legacy_rpc_forbidden';
  END IF;
  v_caller := auth.uid();

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'invalid_updates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_updates) AS k
    WHERE k NOT IN (
      'status', 'notes', 'items', 'fulfilled',
      'subtotal', 'gross_total', 'discount_amount',
      'vat_amount', 'vat_rate', 'total', 'total_override'
    )
  ) THEN
    RAISE EXCEPTION 'unknown_order_field';
  END IF;

  IF p_updates ? 'items'
     AND jsonb_typeof(p_updates -> 'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  v_prev := COALESCE(v_order.items, '[]'::jsonb);
  v_next := COALESCE(p_updates -> 'items', v_prev);

  v_was_deducted := COALESCE(v_order.inventory_deducted, false);
  v_will_fulfil := COALESCE(
    (p_updates ->> 'fulfilled')::boolean,
    v_order.fulfilled,
    false
  );
  v_cancelled := COALESCE(
    p_updates ->> 'status',
    v_order.status,
    ''
  ) = 'בוטל';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'pid', d.pid,
        'prev_qty', d.prev_qty,
        'next_qty', d.next_qty
      )
    ),
    '[]'::jsonb
  )
  INTO v_delta
  FROM (
    SELECT
      f.pid,
      COALESCE(
        sum(f.qty) FILTER (WHERE f.side = 'prev'),
        0
      ) AS prev_qty,
      COALESCE(
        sum(f.qty) FILTER (WHERE f.side = 'next'),
        0
      ) AS next_qty
    FROM (
      SELECT
        'prev'::text AS side,
        (e ->> 'product_id')::uuid AS pid,
        COALESCE(
          NULLIF(e ->> 'quantity', '')::numeric,
          0
        ) AS qty
      FROM jsonb_array_elements(v_prev) AS e
      WHERE NULLIF(e ->> 'product_id', '') IS NOT NULL

      UNION ALL

      SELECT
        'next'::text,
        (e ->> 'product_id')::uuid,
        COALESCE(
          NULLIF(e ->> 'quantity', '')::numeric,
          0
        )
      FROM jsonb_array_elements(v_next) AS e
      WHERE NULLIF(e ->> 'product_id', '') IS NOT NULL
    ) AS f
    GROUP BY f.pid
  ) AS d;

  IF v_cancelled AND v_was_deducted AND p_restore_stock THEN
    v_mode := 'restore_all';
  ELSIF v_cancelled AND v_was_deducted THEN
    v_mode := 'none';
  ELSIF v_will_fulfil AND NOT v_was_deducted THEN
    v_mode := 'deduct_all';
  ELSIF NOT v_will_fulfil
        AND v_was_deducted
        AND NOT v_cancelled THEN
    v_mode := 'restore_all';
  ELSIF v_will_fulfil AND v_was_deducted THEN
    v_mode := 'delta';
  ELSE
    v_mode := 'none';
  END IF;

  v_deducted := CASE v_mode
    WHEN 'deduct_all' THEN true
    WHEN 'restore_all' THEN false
    WHEN 'delta' THEN true
    ELSE v_was_deducted
  END;

  IF v_mode <> 'none' THEN
    PERFORM set_config('app.inventory_order_id', v_order.id::text, true);
    PERFORM set_config('app.inventory_order_number', v_order.order_number::text, true);
    FOR v_row IN
      SELECT d.pid, d.prev_qty, d.next_qty
      FROM jsonb_to_recordset(v_delta)
        AS d(pid uuid, prev_qty numeric, next_qty numeric)
      ORDER BY d.pid
    LOOP
      v_change := CASE v_mode
        WHEN 'delta' THEN v_row.next_qty - v_row.prev_qty
        WHEN 'deduct_all' THEN v_row.next_qty
        WHEN 'restore_all' THEN -v_row.prev_qty
      END;

      CONTINUE WHEN v_change = 0;

      SELECT quantity
      INTO v_qty
      FROM public.products
      WHERE id = v_row.pid
        AND user_id = v_caller
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found';
      END IF;

      -- Record the exact stock effect, not merely the requested quantity.
      -- For older orders without a ledger entry, use the stored order quantity
      -- as a compatibility baseline, without rewriting existing orders.
      SELECT net_deducted INTO v_recorded_qty
      FROM public.order_inventory_effects
      WHERE order_id = p_order_id AND product_id = v_row.pid
      FOR UPDATE;

      IF NOT FOUND THEN
        v_recorded_qty := CASE WHEN v_was_deducted
          THEN GREATEST(0, v_row.prev_qty) ELSE 0 END;
      END IF;

      v_actual_change := CASE
        WHEN v_mode = 'restore_all' THEN -v_recorded_qty
        WHEN v_change > 0 THEN LEAST(v_change, GREATEST(0, COALESCE(v_qty, 0)))
        ELSE -LEAST(-v_change, v_recorded_qty)
      END;

      v_new_qty := COALESCE(v_qty, 0) - v_actual_change;

      UPDATE public.products
      SET quantity = v_new_qty
      WHERE id = v_row.pid
        AND user_id = v_caller;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory_update_failed';
      END IF;

      INSERT INTO public.order_inventory_effects
        (order_id, product_id, user_id, net_deducted)
      VALUES
        (p_order_id, v_row.pid, v_caller, GREATEST(0, v_recorded_qty + v_actual_change))
      ON CONFLICT (order_id, product_id)
      DO UPDATE SET net_deducted = EXCLUDED.net_deducted;

    END LOOP;
  END IF;

  UPDATE public.orders
  SET
    status = CASE
      WHEN p_updates ? 'status'
      THEN p_updates ->> 'status'
      ELSE status
    END,
    notes = CASE
      WHEN p_updates ? 'notes'
      THEN p_updates ->> 'notes'
      ELSE notes
    END,
    items = CASE
      WHEN p_updates ? 'items'
      THEN p_updates -> 'items'
      ELSE items
    END,
    fulfilled = CASE
      WHEN p_updates ? 'fulfilled'
      THEN (p_updates ->> 'fulfilled')::boolean
      ELSE fulfilled
    END,
    subtotal = CASE
      WHEN p_updates ? 'subtotal'
      THEN (p_updates ->> 'subtotal')::numeric
      ELSE subtotal
    END,
    gross_total = CASE
      WHEN p_updates ? 'gross_total'
      THEN (p_updates ->> 'gross_total')::numeric
      ELSE gross_total
    END,
    discount_amount = CASE
      WHEN p_updates ? 'discount_amount'
      THEN (p_updates ->> 'discount_amount')::numeric
      ELSE discount_amount
    END,
    vat_amount = CASE
      WHEN p_updates ? 'vat_amount'
      THEN (p_updates ->> 'vat_amount')::numeric
      ELSE vat_amount
    END,
    vat_rate = CASE
      WHEN p_updates ? 'vat_rate'
      THEN (p_updates ->> 'vat_rate')::numeric
      ELSE vat_rate
    END,
    total = CASE
      WHEN p_updates ? 'total'
      THEN (p_updates ->> 'total')::numeric
      ELSE total
    END,
    total_override = CASE
      WHEN p_updates ? 'total_override'
      THEN (p_updates ->> 'total_override')::numeric
      ELSE total_override
    END,
    inventory_deducted = v_deducted
  WHERE id = p_order_id
    AND user_id = v_caller
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  RETURN v_order;
END;
$function$;

commit;
