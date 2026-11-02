begin;
-- Real sales outcomes, recorded by a researcher. Search learning reads these so it
-- can favor queries that win clients, not just queries that produce audits.
-- The lead index also exposes each lead's saved research score for sorting.
alter table public.leads
 add column outcome text check(outcome in ('won','lost')),
 add column outcome_reason text check(char_length(outcome_reason)<=200),
 add column outcome_at timestamptz;
create index leads_outcome on public.leads(organization_id,outcome) where outcome is not null;

create or replace view public.lead_search_index as
select l.id,l.organization_id,l.store_id,l.audit_id,l.stage,l.updated_at,
 coalesce(nullif(s.display_name,''),s.name) as business_name,s.country,s.industry,
 sc.performance,
 case when exists(select 1 from suppression_list x where x.organization_id=l.organization_id and x.domain=s.domain) then -1
      when exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified' and f.severity='high')
       or (sc.performance<50 and exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified')) then 2
      when exists(select 1 from audit_findings f where f.organization_id=l.organization_id and f.audit_id=l.audit_id and f.kind='verified') then 1 else 0 end as opportunity_rank,
 exists(select 1 from contacts c where c.organization_id=l.organization_id and c.store_id=l.store_id and c.route ilike 'mailto:%@%') as has_email,
 case when pr.status='approved' and pr.expires_at>now() then 'approved' when pr.status='rejected' then 'rejected' else 'unknown' end as permission,
 concat_ws(' ',s.name,s.display_name,s.domain,s.industry,(select string_agg(c.route,' ') from contacts c where c.organization_id=l.organization_id and c.store_id=l.store_id)) as search_text,
 l.outcome,
 case when exists(select 1 from suppression_list x where x.organization_id=l.organization_id and x.domain=s.domain) then null else sc.research_score end as research_score
from leads l join discovered_stores s on s.id=l.store_id and s.organization_id=l.organization_id
left join lateral (select performance,(breakdown->>'researchScore')::integer as research_score from lead_scores where organization_id=l.organization_id and audit_id=l.audit_id order by created_at desc limit 1) sc on true
left join lateral (select status,expires_at from contact_permission_reviews where organization_id=l.organization_id and store_id=l.store_id order by reviewed_at desc limit 1) pr on true;

create or replace view public.discovery_search_outcomes as
 select s.*,coalesce(o.completed_audits,0)::integer as completed_audits,coalesce(o.suitable_contacts,0)::integer as suitable_contacts,
 (select count(*)::integer from discovery_candidates c where c.organization_id=s.organization_id and c.search_id=s.id and c.status='pending') as saved_candidates,
 coalesce(o.won_leads,0)::integer as won_leads,coalesce(o.not_fit_leads,0)::integer as not_fit_leads
 from discovery_searches s left join lateral (
 select count(distinct j.payload->>'store_id') as completed_audits,
 count(distinct j.payload->>'store_id') filter(where exists(
 select 1 from contacts c where c.organization_id=s.organization_id and c.store_id::text=j.payload->>'store_id'
 and c.route ilike 'mailto:%' and split_part(substr(c.route,8),'@',1) !~* '^(hr|career|careers|jobs|recruitment|recruiting|talent)([._+-]|$)'
 and split_part(substr(c.route,8),'@',1) !~* 'wholesale|stockist|trade|b2b'
 and split_part(substr(c.route,8),'@',1) ~* 'support|service|help|returns|orders|customercare|customer[._-]care|^(hello|info|contact|enquiries|inquiries|business|office|admin|shop|sales)([._+-]|$)'
 )) as suitable_contacts,
 count(distinct j.payload->>'store_id') filter(where exists(
 select 1 from leads l where l.organization_id=s.organization_id and l.store_id::text=j.payload->>'store_id' and l.outcome='won'
 )) as won_leads,
 count(distinct j.payload->>'store_id') filter(where exists(
 select 1 from leads l where l.organization_id=s.organization_id and l.store_id::text=j.payload->>'store_id' and l.outcome='lost' and l.outcome_reason='Not a fit'
 )) as not_fit_leads
 from automation_jobs j where j.organization_id=s.organization_id and j.type='audit' and j.payload->>'search_id'=s.id::text and j.status='completed'
 and exists(select 1 from reports r where r.organization_id=s.organization_id and r.audit_id::text=j.payload->>'audit_id')
 ) o on true;
notify pgrst,'reload schema';
commit;
