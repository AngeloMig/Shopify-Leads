-- Publish a completed audit atomically, fenced by current worker ownership.
create unique index reports_per_audit on public.reports(organization_id,audit_id);
create function public.finalize_audit(org uuid, audit uuid, store uuid, job uuid, worker uuid, report_path text, audit_summary jsonb) returns void language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from automation_jobs where id=job and organization_id=org and type='audit' and payload->>'store_id'=store::text and status='running' and worker_id=worker and lease_until>now()) then raise exception 'Worker lease lost'; end if;
 if not exists(select 1 from audit_runs where id=audit and organization_id=org and store_id=store and status='running') then raise exception 'Invalid running audit'; end if;
 if exists(select 1 from suppression_list s join discovered_stores d on d.organization_id=s.organization_id and d.domain=s.domain where d.id=store and d.organization_id=org) then raise exception 'Domain suppressed while audit was running'; end if;
 if report_path not like org::text||'/'||audit::text||'/%' then raise exception 'Invalid report storage path'; end if;
 insert into reports(organization_id,audit_id,store_id,storage_path) values(org,audit,store,report_path) on conflict(organization_id,audit_id) do update set storage_path=excluded.storage_path;
 insert into leads(organization_id,store_id,audit_id) values(org,store,audit) on conflict(organization_id,store_id) do update set audit_id=excluded.audit_id,updated_at=now();
 update audit_runs set status='completed',completed_at=now(),summary=audit_summary where id=audit and organization_id=org;
end $$;
revoke all on function public.finalize_audit(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_audit(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;

alter table public.discovery_queries add column source_cursor text;

revoke create on schema public from public,anon,authenticated;

alter table public.audit_metrics add column environment jsonb not null default '{}';
