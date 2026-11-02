-- Cancellation is terminal. Worker writes must also match status='running'.
alter table public.automation_jobs drop constraint automation_jobs_status_check;
alter table public.automation_jobs add constraint automation_jobs_status_check
  check (status in ('queued','running','completed','failed','cancelled'));

create function public.cancel_job(org uuid, job uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  update automation_jobs set status='cancelled', completed_at=now(),
    error=null, worker_id=null, lease_until=null
    where organization_id=org and id=job and status in ('queued','running');
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

-- Lock schedules before jobs, just as enqueue_due_schedules does.
create function public.stop_discovery(org uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  perform id from discovery_queries where organization_id=org order by id for update;
  update discovery_queries set enabled=false,
    config=jsonb_set(config,'{enabled}','false') where organization_id=org;
  update automation_jobs set status='cancelled', completed_at=now(),
    error=null, worker_id=null, lease_until=null
    where organization_id=org and type='discovery' and status in ('queued','running');
  get diagnostics changed = row_count;
  return changed;
end $$;

-- Serialize child enqueue with cancellation so a stopped discovery cannot
-- leave new audit work in the queue after cancellation has returned.
create function public.enqueue_discovered_audit(org uuid, parent uuid, worker uuid, store uuid, config jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform id from automation_jobs where id=parent and organization_id=org
    and type='discovery' and status='running' and worker_id=worker
    and lease_until>now() for update;
  if not found then raise exception 'Worker lease lost or job cancelled'; end if;
  insert into automation_jobs(organization_id,type,dedupe_key,payload)
    values(org,'audit','audit:'||store,jsonb_build_object('store_id',store,'config',config,'parent_job_id',parent))
    on conflict do nothing;
end $$;

-- Budget reservation shares the cancellation lock. A request already sent
-- to a provider cannot be recalled, but cancelled jobs cannot reserve more.
create or replace function public.reserve_api_unit(org uuid,job uuid,provider text,budget integer)
returns void language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  perform id from automation_jobs where id=job and organization_id=org
    and status='running' and lease_until>now() for update;
  if not found then raise exception 'Job not running'; end if;
  insert into api_usage_daily(organization_id,units) values(org,0) on conflict do nothing;
  update api_usage_daily set units=units+1 where organization_id=org and day=current_date and units<budget returning units into n;
  if n is null then raise exception 'Daily API request budget exhausted'; end if;
  update automation_jobs set api_usage=jsonb_set(api_usage,array[provider],to_jsonb(coalesce((api_usage->>provider)::integer,0)+1)) where id=job;
end $$;

-- Publication also holds the job lock: cancellation and publication have a
-- definite order, with no report published by a job cancelled first.
create or replace function public.finalize_audit(org uuid, audit uuid, store uuid, job uuid, worker uuid, report_path text, audit_summary jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform id from automation_jobs where id=job and organization_id=org and type='audit'
    and payload->>'store_id'=store::text and status='running' and worker_id=worker
    and lease_until>now() for update;
  if not found then raise exception 'Worker lease lost'; end if;
  if not exists(select 1 from audit_runs where id=audit and organization_id=org and store_id=store and status='running') then raise exception 'Invalid running audit'; end if;
  if exists(select 1 from suppression_list s join discovered_stores d on d.organization_id=s.organization_id and d.domain=s.domain where d.id=store and d.organization_id=org) then raise exception 'Domain suppressed while audit was running'; end if;
  if report_path not like org::text||'/'||audit::text||'/%' then raise exception 'Invalid report storage path'; end if;
  insert into reports(organization_id,audit_id,store_id,storage_path) values(org,audit,store,report_path) on conflict(organization_id,audit_id) do update set storage_path=excluded.storage_path;
  insert into leads(organization_id,store_id,audit_id) values(org,store,audit) on conflict(organization_id,store_id) do update set audit_id=excluded.audit_id,updated_at=now();
  update audit_runs set status='completed',completed_at=now(),summary=audit_summary where id=audit and organization_id=org;
  update automation_jobs set status='completed',progress=100,completed_at=now(),error=null,worker_id=null,lease_until=null where id=job and organization_id=org;
end $$;

revoke all on function public.cancel_job(uuid,uuid),public.stop_discovery(uuid),public.enqueue_discovered_audit(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cancel_job(uuid,uuid),public.stop_discovery(uuid),public.enqueue_discovered_audit(uuid,uuid,uuid,uuid,jsonb) to service_role;
