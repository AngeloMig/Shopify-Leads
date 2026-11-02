-- Serialize first-audit imports against repeated submissions and retained history.
create function public.enqueue_first_audit(org uuid, store uuid, config jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 perform id from discovered_stores where id=store and organization_id=org for update;
 if not found then raise exception 'Store not found in workspace'; end if;
 if exists(select 1 from suppression_list s join discovered_stores d on d.organization_id=s.organization_id and d.domain=s.domain where d.id=store and d.organization_id=org) then return false; end if;
 if exists(select 1 from audit_runs where organization_id=org and store_id=store)
   or exists(select 1 from automation_jobs where organization_id=org and type='audit' and payload->>'store_id'=store::text) then return false; end if;
 insert into automation_jobs(organization_id,type,dedupe_key,payload)
 values(org,'audit','audit:'||store,jsonb_build_object('store_id',store,'config',config,'imported',true)) on conflict do nothing;
 get diagnostics n=row_count;
 return n>0;
end $$;
revoke all on function public.enqueue_first_audit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_first_audit(uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
