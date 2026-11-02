begin;
-- Additive workspace improvements. Provider evidence and original names remain intact.
alter table public.discovered_stores
  add column display_name text,
  add column preferred_email text,
  add column industry_confidence text not null default 'unknown' check(industry_confidence in ('high','medium','unknown','manual')),
  add column industry_evidence text,
  add column industry_manual boolean not null default false;
alter table public.api_usage_daily add column discovery_units integer not null default 0,
  add column audit_units integer not null default 0;
-- Existing usage must count against the new category limits too.
update public.api_usage_daily u set
  discovery_units=coalesce((select sum(case when j.type='discovery' then x.value::integer else 0 end) from automation_jobs j cross join lateral jsonb_each_text(j.api_usage) x where j.organization_id=u.organization_id and (j.started_at at time zone 'UTC')::date=u.day),0),
  audit_units=coalesce((select sum(case when j.type='audit' then x.value::integer else 0 end) from automation_jobs j cross join lateral jsonb_each_text(j.api_usage) x where j.organization_id=u.organization_id and (j.started_at at time zone 'UTC')::date=u.day),0);

create table public.worker_heartbeats (
  organization_id uuid not null references public.organizations on delete cascade,
  worker_id uuid not null,
  last_seen timestamptz not null default now(),
  state text not null check(state in ('idle','working','paused','stopped')),
  job_id uuid,
  primary key(organization_id,worker_id)
);
create table public.candidate_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  query_id uuid,
  domain text not null,
  name text not null,
  source_url text not null,
  reason text not null,
  metadata jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','dismissed','verified')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,domain),
  foreign key(organization_id,query_id) references public.discovery_queries(organization_id,id) on delete cascade
);
alter table public.automation_jobs add constraint automation_jobs_org_id_key unique(organization_id,id);
create table public.discovery_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  job_id uuid not null,
  query_id uuid,
  sequence integer not null,
  query text not null,
  keyword text not null,
  industry text not null,
  country text not null,
  returned integer not null default 0,
  checked integer not null default 0,
  verified integer not null default 0,
  queued integer not null default 0,
  previously_researched integer not null default 0,
  rejected integer not null default 0,
  credits integer not null default 1,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(organization_id,job_id,sequence),
  foreign key(organization_id,job_id) references public.automation_jobs(organization_id,id) on delete cascade,
  foreign key(organization_id,query_id) references public.discovery_queries(organization_id,id) on delete cascade
);

do $$ declare t text; begin
 foreach t in array array['worker_heartbeats','candidate_reviews','discovery_searches'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(organization_id))',t);
   execute format('grant select on public.%I to authenticated',t);
   execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.enqueue_discovered_audit(org uuid, parent uuid, worker uuid, store uuid, config jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform id from automation_jobs where id=parent and organization_id=org and type='discovery' and status='running' and worker_id=worker and lease_until>now() for update;
 if not found then raise exception 'Worker lease lost or job cancelled'; end if;
 insert into automation_jobs(organization_id,type,dedupe_key,payload)
 values(org,'audit','audit:'||store,jsonb_build_object('store_id',store,'config',config-'_search_id','parent_job_id',parent,'search_id',config->>'_search_id')) on conflict do nothing;
end $$;
create index findings_audit_kind on public.audit_findings(organization_id,audit_id,kind,severity);
create index contacts_store on public.contacts(organization_id,store_id);
create index leads_workspace_updated on public.leads(organization_id,updated_at desc,id);

-- Used only by the tenant-scoped server. All-history search and page counts.
create view public.lead_search_index as
select l.id,l.organization_id,l.store_id,l.audit_id,l.stage,l.updated_at,
 coalesce(nullif(s.display_name,''),s.name) as business_name,s.country,s.industry,
 sc.performance,
 case when exists(select 1 from suppression_list x where x.organization_id=l.organization_id and x.domain=s.domain) then -1
      when exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified' and f.severity='high')
       or (sc.performance<50 and exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified')) then 2
      when exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified') then 1 else 0 end as opportunity_rank,
 exists(select 1 from contacts c where c.organization_id=l.organization_id and c.store_id=l.store_id and c.route ilike 'mailto:%@%') as has_email,
 case when pr.status='approved' and pr.expires_at>now() then 'approved' when pr.status='rejected' then 'rejected' else 'unknown' end as permission,
 concat_ws(' ',s.name,s.display_name,s.domain,s.industry,(select string_agg(c.route,' ') from contacts c where c.organization_id=l.organization_id and c.store_id=l.store_id)) as search_text
from leads l join discovered_stores s on s.id=l.store_id and s.organization_id=l.organization_id
left join lateral (select performance from lead_scores where organization_id=l.organization_id and audit_id=l.audit_id order by created_at desc limit 1) sc on true
left join lateral (select status,expires_at from contact_permission_reviews where organization_id=l.organization_id and store_id=l.store_id order by reviewed_at desc limit 1) pr on true;
revoke all on public.lead_search_index from public,anon,authenticated;
grant select on public.lead_search_index to service_role;

create or replace function public.reserve_api_unit(org uuid,job uuid,provider text,budget integer)
returns void language plpgsql security definer set search_path=public as $$
declare j automation_jobs; limits jsonb; category_limit integer; n integer;
begin
 select * into j from automation_jobs where id=job and organization_id=org and status='running' and lease_until>now() for update;
 if not found then raise exception 'Job not running'; end if;
 select config into limits from app_settings where organization_id=org;
 category_limit=case when j.type='discovery' then coalesce((limits->>'discovery_daily_budget')::integer,budget) else coalesce((limits->>'audit_daily_budget')::integer,budget) end;
 insert into api_usage_daily(organization_id,day,units) values(org,(now() at time zone 'UTC')::date,0) on conflict do nothing;
 update api_usage_daily set units=units+1,
  discovery_units=discovery_units+case when j.type='discovery' then 1 else 0 end,
  audit_units=audit_units+case when j.type='audit' then 1 else 0 end
 where organization_id=org and day=(now() at time zone 'UTC')::date and units<coalesce((limits->>'daily_api_budget')::integer,budget)
 and (case when j.type='discovery' then discovery_units else audit_units end)<category_limit returning units into n;
 if n is null then raise exception 'Daily API request budget exhausted (total or % limit)',j.type; end if;
 update automation_jobs set api_usage=jsonb_set(api_usage,array[provider],to_jsonb(coalesce((api_usage->>provider)::integer,0)+1)) where id=job;
end $$;

notify pgrst, 'reload schema';
commit;
