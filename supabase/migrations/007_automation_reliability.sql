begin;
alter table public.automation_jobs drop constraint automation_jobs_status_check;
alter table public.automation_jobs add constraint automation_jobs_status_check check(status in ('queued','running','completed','failed','cancelled','blocked'));
alter table public.automation_jobs add column wait_reason text,
 add column error_code text, add column error_provider text;
update public.automation_jobs set wait_reason='budget',error_code='budget' where status='queued' and error ilike '%Daily API request budget exhausted%';
alter table public.discovery_searches add column duplicate_results integer not null default 0;
alter table public.discovery_searches add column duplicate_results_recorded boolean not null default false;
-- Legacy stores lack an immutable discovery timestamp. Do not label them new.
alter table public.discovered_stores add column first_seen_at timestamptz;
alter table public.discovered_stores alter column first_seen_at set default now();
alter table public.organizations add column automation_tracking_since timestamptz not null default now();

create table public.job_checkpoints (
 organization_id uuid not null references public.organizations on delete cascade,
 job_id uuid not null, step text not null, signature text not null,
 result jsonb not null, saved_at timestamptz not null default now(),
 primary key(organization_id,job_id,step),
 foreign key(organization_id,job_id) references public.automation_jobs(organization_id,id) on delete cascade
);
create table public.provider_blocks (
 organization_id uuid not null references public.organizations on delete cascade,
 provider text not null, reason text not null, code text not null,
 blocked_until timestamptz, created_at timestamptz not null default now(),
 primary key(organization_id,provider)
);
alter table public.job_checkpoints enable row level security;
alter table public.provider_blocks enable row level security;
revoke all on public.job_checkpoints,public.provider_blocks from public,anon,authenticated;
grant all on public.job_checkpoints,public.provider_blocks to service_role;

create function public.save_job_checkpoint(org uuid, job uuid, worker uuid, step_name text, request_signature text, value jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform id from automation_jobs where id=job and organization_id=org and status='running' and worker_id=worker and lease_until>now() for update;
 if not found then raise exception 'Worker lease lost'; end if;
 insert into job_checkpoints(organization_id,job_id,step,signature,result) values(org,job,step_name,request_signature,value)
 on conflict(organization_id,job_id,step) do update set signature=excluded.signature,result=excluded.result,saved_at=now();
end $$;

create function public.settle_job_failure(org uuid,job uuid,worker uuid,next_status text,message text,failure_code text,provider_name text,eligible_at timestamptz,restore_attempt boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if next_status not in ('queued','failed','blocked') then raise exception 'Invalid failure state'; end if;
 perform id from automation_jobs where id=job and organization_id=org and status='running' and worker_id=worker and lease_until>now() for update;
 if not found then return false; end if;
 if provider_name is not null and failure_code in ('credentials','rate_limit') then
   insert into provider_blocks(organization_id,provider,reason,code,blocked_until) values(org,provider_name,message,failure_code,case when failure_code='credentials' then null else eligible_at end)
   on conflict(organization_id,provider) do update set reason=excluded.reason,code=excluded.code,blocked_until=excluded.blocked_until,created_at=now();
 end if;
 update automation_jobs set status=next_status,error=message,error_code=failure_code,error_provider=provider_name,
 wait_reason=case when failure_code='budget' then 'budget' when next_status='queued' then 'retry' else 'attention' end,
 attempts=greatest(0,attempts-case when restore_attempt then 1 else 0 end),available_at=eligible_at,
 completed_at=case when next_status='failed' then now() else null end,lease_until=null,worker_id=null where id=job and organization_id=org;
 return true;
end $$;

-- Keep all existing atomic budget/cancellation guarantees inside the wrapper.
alter function public.reserve_api_unit(uuid,uuid,text,integer) rename to reserve_api_unit_unblocked;
create function public.reserve_api_unit(org uuid,job uuid,provider text,budget integer)
returns void language plpgsql security definer set search_path=public as $$
declare b provider_blocks;
begin
 select * into b from provider_blocks p where p.organization_id=org and p.provider=reserve_api_unit.provider and (p.blocked_until is null or p.blocked_until>now());
 if found then raise exception 'Provider paused (%): %',provider,b.reason; end if;
 perform reserve_api_unit_unblocked(org,job,provider,budget);
end $$;

create function public.automation_queue_reasons(org uuid) returns table(id uuid,reason text,provider text,available_at timestamptz)
language sql stable security definer set search_path=public as $$
 select j.id,
 case when b.provider is not null then 'provider'
      when j.available_at>now() then coalesce(j.wait_reason,'scheduled')
      when j.type='discovery' and (select count(*) from automation_jobs a where a.organization_id=org and a.type='audit' and a.status in ('queued','running'))>=coalesce((s.config->>'max_audit_backlog')::integer,5) then 'backlog'
      else 'ready' end,
 b.provider, greatest(j.available_at,coalesce(b.blocked_until,j.available_at))
 from automation_jobs j
 left join discovery_queries q on q.id::text=j.payload->>'query_id' and q.organization_id=j.organization_id
 left join app_settings s on s.organization_id=j.organization_id
 left join provider_blocks b on b.organization_id=j.organization_id and b.provider=case when j.type='audit' then 'pagespeed' else coalesce(j.payload->'config'->>'provider',q.config->>'provider','tavily') end and (b.blocked_until is null or b.blocked_until>now())
 where j.organization_id=org and j.status='queued';
$$;

create or replace function public.claim_job(worker uuid) returns setof public.automation_jobs
language plpgsql security definer set search_path=public as $$
begin
 -- A deliberate cap increase may release deferred work without waiting a day.
 update automation_jobs j set available_at=now(),wait_reason=null,error=null,error_code=null
 from app_settings s left join api_usage_daily u on u.organization_id=s.organization_id and u.day=(now() at time zone 'UTC')::date
 where j.organization_id=s.organization_id and j.status='queued' and j.wait_reason='budget' and j.available_at>now()
 and coalesce(u.units,0)<coalesce((s.config->>'daily_api_budget')::integer,100)
 and (case when j.type='discovery' then coalesce(u.discovery_units,0) else coalesce(u.audit_units,0) end)<coalesce((s.config->>(case when j.type='discovery' then 'discovery_daily_budget' else 'audit_daily_budget' end))::integer,(s.config->>'daily_api_budget')::integer,100);
 update automation_jobs set status=case when attempts>=max_attempts then 'failed' else 'queued' end,error='Worker lease expired',wait_reason='retry',error_code='lease_expired',worker_id=null,lease_until=null,completed_at=case when attempts>=max_attempts then now() else null end where status='running' and lease_until<now();
 return query update automation_jobs set status='running',worker_id=worker,attempts=attempts+1,lease_until=now()+interval '3 minutes',started_at=now(),completed_at=null,wait_reason=null where id=(
 select j.id from organizations o
 cross join lateral automation_queue_reasons(o.id) r
 join automation_jobs j on r.id=j.id and r.reason='ready'
 where j.status='queued' and j.available_at<=now() and j.attempts<j.max_attempts
 order by case when j.type='audit' then 0 else 1 end,j.available_at,j.id for update of j skip locked limit 1
 ) returning *;
end $$;

create or replace function public.enqueue_due_schedules() returns void language plpgsql security definer set search_path=public as $$
declare q discovery_queries; cap integer; backlog integer; active integer;
begin
 for q in select * from discovery_queries where enabled and next_run_at<=now() for update skip locked loop
 select coalesce((config->>'scheduled_runs_per_day')::integer,1),coalesce((config->>'max_audit_backlog')::integer,5) into cap,backlog from app_settings where organization_id=q.organization_id;
 cap=coalesce(cap,1); backlog=coalesce(backlog,5);
 select count(*) into active from automation_jobs where organization_id=q.organization_id and type='audit' and status in ('queued','running');
 if active>=backlog then continue; end if;
 if (select count(*) from automation_jobs where organization_id=q.organization_id and type='discovery' and payload->>'query_id'=q.id::text and payload->>'scheduled'='true' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cap then
   update discovery_queries set next_run_at=(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC' where id=q.id;
   continue;
 end if;
 insert into automation_jobs(organization_id,type,dedupe_key,payload) values(q.organization_id,'discovery','discovery:'||q.id,jsonb_build_object('query_id',q.id,'scheduled',true)) on conflict do nothing;
 update discovery_queries set next_run_at=q.next_run_at+make_interval(hours=>q.interval_hours)*(floor(extract(epoch from (now()-q.next_run_at))/(q.interval_hours*3600))+1)::integer where id=q.id;
 end loop;
end $$;

create function public.automation_summary(org uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'since',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',
 'stores_found',(select count(*) from discovered_stores where organization_id=org and first_seen_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'store_tracking_since',(select automation_tracking_since from organizations where id=org),
 'audits_completed',(select count(*) from audit_runs a where a.organization_id=org and a.completed_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and a.status='completed' and exists(select 1 from reports r where r.organization_id=org and r.audit_id=a.id)),
 'new_leads',(select count(*) from leads where organization_id=org and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'leads_with_email',(select count(*) from leads l where l.organization_id=org and l.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and exists(select 1 from contacts c where c.organization_id=org and c.store_id=l.store_id and c.route ilike 'mailto:%')),
 'previously_researched',(select coalesce(sum(previously_researched),0) from discovery_searches where organization_id=org and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'duplicate_results',(select coalesce(sum(duplicate_results),0) from discovery_searches where organization_id=org and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'duplicate_tracking_searches',(select count(*) from discovery_searches where organization_id=org and duplicate_results_recorded and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'searches_total',(select count(*) from discovery_searches where organization_id=org and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'failures',(select count(*) from automation_jobs where organization_id=org and status='failed' and completed_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
 'needs_attention',(select count(*) from automation_jobs where organization_id=org and status='blocked'),
 'audit_backlog',(select count(*) from automation_jobs where organization_id=org and type='audit' and status in ('queued','running'))
 );
$$;
create or replace function public.cancel_job(org uuid,job uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 update automation_jobs set status='cancelled',completed_at=now(),error=null,worker_id=null,lease_until=null,wait_reason=null where organization_id=org and id=job and status in ('queued','running','blocked');
 get diagnostics changed=row_count; return changed>0;
end $$;
create or replace function public.stop_discovery(org uuid) returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 perform id from discovery_queries where organization_id=org order by id for update;
 update discovery_queries set enabled=false,config=jsonb_set(config,'{enabled}','false') where organization_id=org;
 update automation_jobs set status='cancelled',completed_at=now(),error=null,worker_id=null,lease_until=null,wait_reason=null where organization_id=org and type='discovery' and status in ('queued','running','blocked');
 get diagnostics changed=row_count;return changed;
end $$;
revoke all on function public.save_job_checkpoint(uuid,uuid,uuid,text,text,jsonb),public.automation_queue_reasons(uuid),public.automation_summary(uuid),public.reserve_api_unit(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.save_job_checkpoint(uuid,uuid,uuid,text,text,jsonb),public.automation_queue_reasons(uuid),public.automation_summary(uuid),public.reserve_api_unit(uuid,uuid,text,integer) to service_role;
revoke all on function public.settle_job_failure(uuid,uuid,uuid,text,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.settle_job_failure(uuid,uuid,uuid,text,text,text,text,timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;
