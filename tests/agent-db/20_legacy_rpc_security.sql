-- Execute ONLY on disposable PostgreSQL after 09 is loaded.
-- All seven legacy owner-only definer APIs must reject a sales-agent caller
-- *before* inspecting arguments or attempting any mutation.
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$
declare n integer := 0; raised boolean;
begin
 raised:=false;
 begin
  perform public.create_order_with_inventory(null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy create_order'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.save_order_with_inventory(null,null,false);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy save_order'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.allocate_payment_across_invoices(null,null,null,null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy payment allocator'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.credit_note_confirm(null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy credit confirmation'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.credit_note_reserve(null,null,null,null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy credit reserve'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.credit_note_resolve(null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy credit resolution'; end if;
 n:=n+1;

 raised:=false;
 begin
  perform public.credit_note_return_lines(null,null);
 exception when others then raised:=SQLERRM='agent_legacy_rpc_forbidden'; end;
 if not raised then raise exception 'agent could enter legacy credit lines'; end if;
 n:=n+1;

 if n<>7 then raise exception 'incorrect guarded RPC test count'; end if;
end $$;

reset role;
reset request.jwt.claim.sub;
select 'all seven legacy agent bypasses blocked' as result;
