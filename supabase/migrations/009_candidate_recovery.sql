begin;
create or replace function public.claim_discovery_candidate(org uuid,job uuid,worker uuid,campaign uuid,scope_value text)
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
 and ((c.status in ('pending','rejected') and c.next_check_at<=now()) or (c.status='checking' and (c.lease_until<now() or c.job_id=job or not exists(select 1 from automation_jobs p where p.organization_id=org and p.id=c.job_id and p.status='running' and p.lease_until>now()))))
 and not exists(select 1 from discovery_rejections r where r.organization_id=org and r.domain=c.domain and r.scope in ('*',scope_value) and r.retry_at>now())
 order by c.priority desc,c.created_at,c.id for update skip locked limit 1
 ) returning *;
end $$;

create or replace function public.discovery_pool_summary(org uuid,campaign uuid default null) returns jsonb language sql stable security definer set search_path=public as $$
with pool as (
 select c.status,c.next_check_at,(c.status='checking' and c.lease_until>now() and exists(select 1 from automation_jobs p where p.organization_id=org and p.id=c.job_id and p.status='running' and p.lease_until>now())) as active
 from discovery_candidates c where c.organization_id=org and (campaign is null or c.query_id=campaign)
) select jsonb_build_object('pending',count(*) filter(where status='pending' or (status='checking' and not active)),
 'checking',count(*) filter(where active),'cooling_down',count(*) filter(where status='rejected' and next_check_at>now()),
 'review',count(*) filter(where status='review'),'queued',count(*) filter(where status='queued')) from pool
$$;
notify pgrst,'reload schema';
commit;
