-- Disposable PostgreSQL integration only. No live data or database.
-- Verifies alert state sync; full stock flow still requires restored-DB tests.
reset role;
reset request.jwt.claim.sub;

do $
declare n integer; original_financial_status text; original_inventory_state boolean;
begin
 select status,inventory_deducted
 into original_financial_status,original_inventory_state
 from public.orders
 where id='30303030-3030-4030-8030-303030303030';

 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id='30303030-3030-4030-8030-303030303030'
   and closed_at is null;
 if n<>1 then raise exception 'expected pending delivery alert'; end if;

 -- Simulates the already-committed order.fulfilled state transition.
 -- Production MUST use existing inventory-aware order save for this transition.
 update public.orders set fulfilled=true
 where id='30303030-3030-4030-8030-303030303030';

 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id='30303030-3030-4030-8030-303030303030'
   and closed_at is not null;
 if n<>1 then raise exception 'delivery alert was not closed'; end if;

 -- Delivery and financial settlement are independent. Delivery alone MUST
 -- NOT mark the order financially completed, affect invoice payments, or
 -- let this trigger change inventory deductions.
 if (select status from public.orders
     where id='30303030-3030-4030-8030-303030303030')
       is distinct from original_financial_status
 then raise exception 'delivery changed financial order status'; end if;
 if (select inventory_deducted from public.orders
     where id='30303030-3030-4030-8030-303030303030')
       is distinct from original_inventory_state
 then raise exception 'delivery-alert trigger changed stock flag'; end if;

 -- Updating an unrelated field cannot reopen an alert.
 update public.orders set status='הושלם'
 where id='30303030-3030-4030-8030-303030303030';

 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id='30303030-3030-4030-8030-303030303030'
   and closed_at is not null;
 if n<>1 then raise exception 'financial status changed delivery state'; end if;

 if (select fulfilled from public.orders
    where id='30303030-3030-4030-8030-303030303030')
      is distinct from true
 then raise exception 'financial completion altered delivery state'; end if;

 -- If fulfilment is explicitly reversed through the regular order workflow,
 -- the alert returns to the pending queue (no second alert row).
 update public.orders set fulfilled=false
 where id='30303030-3030-4030-8030-303030303030';

 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id='30303030-3030-4030-8030-303030303030'
   and closed_at is null;
 if n<>1 then raise exception 'delivery reversal did not reopen alert'; end if;

 select count(*) into n from public.sales_agent_delivery_alerts
 where order_id='30303030-3030-4030-8030-303030303030';
 if n<>1 then raise exception 'delivery sync duplicated alerts'; end if;
end $$;
select 'delivery alert sync PASS' as result;
