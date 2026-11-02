-- Explicit privileges for fresh projects, including projects without automatic Data API grants.
-- RLS remains enabled; clients can read only rows visible through membership policies.
grant usage on schema public to authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['users','organizations','organization_members','discovery_sources','discovery_queries','discovered_stores','business_activity_evidence','store_technology_evidence','historical_snapshots','audit_runs','audit_pages','audit_metrics','audit_findings','audit_screenshots','ai_recommendations','lead_scores','contacts','contact_permission_reviews','suppression_list','leads','lead_activities','reports','automation_jobs','app_settings','api_usage_daily'] loop
  execute format('revoke all on table public.%I from anon,authenticated',t);
  execute format('grant select on table public.%I to authenticated',t);
  execute format('grant select,insert,update,delete on table public.%I to service_role',t);
 end loop;
end $$;
