begin;
alter table public.discovery_searches add column format text not null default 'legacy',
 add column credits_measured boolean not null default false;
alter table public.discovery_searches add constraint discovery_searches_org_id unique(organization_id,id);

create table public.discovery_candidates (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade,
 query_id uuid not null, search_id uuid not null, domain text not null check(domain=lower(domain) and domain !~ '[/@:[:space:]]'),
 candidate jsonb not null, priority integer not null default 0,
 status text not null default 'pending' check(status in ('pending','checking','queued','researched','suppressed','rejected','review')),
 reason text, checked_at timestamptz, next_check_at timestamptz not null default now(),
 lease_until timestamptz, job_id uuid, created_at timestamptz not null default now(),
 unique(organization_id,query_id,domain),
 foreign key(organization_id,query_id) references discovery_queries(organization_id,id) on delete cascade,
 foreign key(organization_id,search_id) references discovery_searches(organization_id,id) on delete cascade
);
create index discovery_candidates_due on public.discovery_candidates(organization_id,query_id,status,next_check_at,priority desc);
create table public.discovery_rejections (
 organization_id uuid not null references organizations on delete cascade, domain text not null,
 scope text not null, reason text not null, code text not null, retry_at timestamptz not null,
 observed_at timestamptz not null default now(), primary key(organization_id,domain,scope)
);
alter table public.discovery_candidates enable row level security;
alter table public.discovery_rejections enable row level security;
revoke all on public.discovery_candidates,public.discovery_rejections from public,anon,authenticated;
grant all on public.discovery_candidates,public.discovery_rejections to service_role;

-- Search response, rotation and candidate storage commit together. Retrying the
-- same sequence cannot erase already checked candidates or reset cooldowns.
create function public.save_discovery_batch(org uuid,job uuid,worker uuid,campaign uuid,sequence_no integer,summary jsonb,cursor_value text,items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare event uuid; item jsonb;
begin
 perform id from automation_jobs where id=job and organization_id=org and type='discovery' and status='running' and worker_id=worker and lease_until>now() and payload->>'query_id'=campaign::text for update;
 if not found then raise exception 'Worker lease lost'; end if;
 insert into discovery_searches(organization_id,job_id,query_id,sequence,query,keyword,country,industry,returned,duplicate_results,duplicate_results_recorded,format,credits,credits_measured,completed)
 values(org,job,campaign,sequence_no,summary->>'query',summary->>'keyword',summary->>'country',summary->>'industry',(summary->>'returned')::integer,coalesce((summary->>'duplicates')::integer,0),true,summary->>'format',coalesce((summary->>'credits')::integer,1),coalesce((summary->>'credits_measured')::boolean,false),true)
 on conflict(organization_id,job_id,sequence) do nothing returning id into event;
 if event is null then select id into event from discovery_searches where organization_id=org and job_id=job and sequence=sequence_no; return event; end if;
 for item in select * from jsonb_array_elements(items) loop
  insert into discovery_candidates(organization_id,query_id,search_id,domain,candidate,priority)
  values(org,campaign,event,item->>'domain',item,coalesce((item->>'priority')::integer,0))
  on conflict(organization_id,query_id,domain) do nothing;
 end loop;
 update discovery_queries set source_cursor=cursor_value where organization_id=org and id=campaign;
 return event;
end $$;

create function public.claim_discovery_candidate(org uuid,job uuid,worker uuid,campaign uuid,scope_value text)
returns setof discovery_candidates language plpgsql security definer set search_path=public as $$
begin
 perform id from automation_jobs where id=job and organization_id=org and type='discovery' and status='running' and worker_id=worker and lease_until>now() and payload->>'query_id'=campaign::text for update;
 if not found then raise exception 'Worker lease lost'; end if;
 return query update discovery_candidates set status='checking',lease_until=now()+interval '3 minutes',job_id=job where id=(
 select c.id from discovery_candidates c where c.organization_id=org and c.query_id=campaign
 and exists(select 1 from discovery_queries q where q.organization_id=org and q.id=campaign
  and (c.candidate->>'search_country') in (select jsonb_array_elements_text(q.config->'countries'))
  and (jsonb_array_length(q.config->'industries')=0 or (c.candidate->>'search_industry') in (select jsonb_array_elements_text(q.config->'industries')))
  and not exists(select 1 from jsonb_array_elements_text(coalesce(q.config->'excluded_domains','[]')) d where c.domain=d or c.domain like '%.'||d))
 and ((c.status in ('pending','rejected') and c.next_check_at<=now()) or (c.status='checking' and (c.lease_until<now() or c.job_id=job)))
 and not exists(select 1 from discovery_rejections r where r.organization_id=org and r.domain=c.domain and r.scope in ('*',scope_value) and r.retry_at>now())
 order by c.priority desc,c.created_at,c.id for update skip locked limit 1
 ) returning *;
end $$;

create function public.settle_discovery_candidate(org uuid,job uuid,worker uuid,item_id uuid,next_status text,message text,code_value text,scope_value text,retry_at_value timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare c discovery_candidates;
begin
 perform id from automation_jobs where id=job and organization_id=org and status='running' and worker_id=worker and lease_until>now() for update;
 if not found then raise exception 'Worker lease lost'; end if;
 select * into c from discovery_candidates where id=item_id and organization_id=org and job_id=job and status='checking' for update;
 if not found then raise exception 'Candidate ownership lost'; end if;
 if next_status not in ('queued','researched','suppressed','rejected','review') then raise exception 'Invalid candidate result'; end if;
 if next_status='rejected' then
  insert into discovery_rejections(organization_id,domain,scope,reason,code,retry_at) values(org,c.domain,scope_value,message,code_value,retry_at_value)
  on conflict(organization_id,domain,scope) do update set reason=excluded.reason,code=excluded.code,retry_at=excluded.retry_at,observed_at=now();
 end if;
 update discovery_candidates set status=next_status,reason=message,checked_at=now(),next_check_at=retry_at_value,lease_until=null where id=c.id;
 update discovery_searches set checked=checked+1,
 verified=verified+case when next_status in ('queued','review') then 1 else 0 end,
 queued=queued+case when next_status='queued' then 1 else 0 end,
 previously_researched=previously_researched+case when next_status='researched' then 1 else 0 end,
 rejected=rejected+case when next_status='rejected' then 1 else 0 end where organization_id=org and id=c.search_id;
end $$;

-- Count publication against this job's audit, rather than any historical report
-- for the same store. Preserve unambiguous legacy attribution only.
update automation_jobs j set payload=jsonb_set(j.payload,'{audit_id}',to_jsonb((
 select min(r.audit_id::text) from reports r join audit_runs a on a.organization_id=r.organization_id and a.id=r.audit_id
 where r.organization_id=j.organization_id and r.store_id::text=j.payload->>'store_id' and a.completed_at between j.started_at and j.completed_at
))) where j.type='audit' and j.status='completed' and (select count(*) from reports r join audit_runs a on a.organization_id=r.organization_id and a.id=r.audit_id where r.organization_id=j.organization_id and r.store_id::text=j.payload->>'store_id' and a.completed_at between j.started_at and j.completed_at)=1;

create function public.tag_completed_audit() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='completed' and old.status<>'completed' then
  update automation_jobs set payload=jsonb_set(payload,'{audit_id}',to_jsonb(new.id::text)) where organization_id=new.organization_id and type='audit' and status='running' and payload->>'store_id'=new.store_id::text;
 end if; return new;
end $$;
create trigger tag_completed_audit after update of status on audit_runs for each row execute function tag_completed_audit();

create index audit_job_search on automation_jobs(organization_id,(payload->>'search_id')) where type='audit';
create view public.discovery_search_outcomes as
 select s.*,coalesce(o.completed_audits,0)::integer as completed_audits,coalesce(o.suitable_contacts,0)::integer as suitable_contacts,
 (select count(*)::integer from discovery_candidates c where c.organization_id=s.organization_id and c.search_id=s.id and c.status='pending') as saved_candidates
 from discovery_searches s left join lateral (
 select count(distinct j.payload->>'store_id') as completed_audits,
 count(distinct j.payload->>'store_id') filter(where exists(
 select 1 from contacts c where c.organization_id=s.organization_id and c.store_id::text=j.payload->>'store_id'
 and c.route ilike 'mailto:%' and split_part(substr(c.route,8),'@',1) !~* '^(hr|career|careers|jobs|recruitment|recruiting|talent)([._+-]|$)'
 and split_part(substr(c.route,8),'@',1) !~* 'wholesale|stockist|trade|b2b'
 and split_part(substr(c.route,8),'@',1) ~* 'support|service|help|returns|orders|customercare|customer[._-]care|^(hello|info|contact|enquiries|inquiries|business|office|admin|shop|sales)([._+-]|$)'
 )) as suitable_contacts
 from automation_jobs j where j.organization_id=s.organization_id and j.type='audit' and j.payload->>'search_id'=s.id::text and j.status='completed'
 and exists(select 1 from reports r where r.organization_id=s.organization_id and r.audit_id::text=j.payload->>'audit_id')
 ) o on true;
revoke all on public.discovery_search_outcomes from public,anon,authenticated;
grant select on public.discovery_search_outcomes to service_role;

create function public.discovery_pool_summary(org uuid,campaign uuid default null) returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('pending',count(*) filter(where status='pending'),'checking',count(*) filter(where status='checking'),
 'cooling_down',count(*) filter(where status='rejected' and next_check_at>now()),'review',count(*) filter(where status='review'),
 'queued',count(*) filter(where status='queued')) from discovery_candidates where organization_id=org and (campaign is null or query_id=campaign)
$$;

create function public.discovery_exclusions(org uuid,scope_value text) returns table(domain text) language sql stable security definer set search_path=public as $$
select d from (
 select s.domain as d,s.researched_at as seen from discovered_stores s where s.organization_id=org and (
 exists(select 1 from audit_runs a where a.organization_id=org and a.store_id=s.id) or
 exists(select 1 from automation_jobs j where j.organization_id=org and j.type='audit' and j.payload->>'store_id'=s.id::text))
 union all select r.domain,r.observed_at from discovery_rejections r where r.organization_id=org and r.scope in ('*',scope_value) and r.retry_at>now()
 union all select s.domain,now() from suppression_list s where s.organization_id=org
) x group by d order by max(seen) desc,d limit 150
$$;

revoke all on function public.save_discovery_batch(uuid,uuid,uuid,uuid,integer,jsonb,text,jsonb),public.claim_discovery_candidate(uuid,uuid,uuid,uuid,text),public.settle_discovery_candidate(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),public.discovery_pool_summary(uuid,uuid),public.discovery_exclusions(uuid,text),public.tag_completed_audit() from public,anon,authenticated;
grant execute on function public.save_discovery_batch(uuid,uuid,uuid,uuid,integer,jsonb,text,jsonb),public.claim_discovery_candidate(uuid,uuid,uuid,uuid,text),public.settle_discovery_candidate(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),public.discovery_pool_summary(uuid,uuid),public.discovery_exclusions(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
