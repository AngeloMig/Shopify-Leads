begin;
-- Local businesses without a website (a builder with only a Facebook page).
-- Found through Google Places, whose terms allow keeping the place ID but not
-- the listing's name, address, phone or rating: those are fetched live when
-- someone views the lead. What is stored here is Scout's own research: the
-- search that found it, the website check and the social pages it turned up.
create table public.local_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  trade text not null check(char_length(trade) between 2 and 80),
  cities text[] not null check(cardinality(cities) between 1 and 10),
  country text not null check(country in ('US','GB','CA','AU')),
  per_city integer not null default 20 check(per_city between 1 and 20),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(organization_id,id)
);
create index local_searches_recent on public.local_searches(organization_id,created_at desc);

create table public.local_businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  place_id text not null check(char_length(place_id) between 10 and 300),
  search_id uuid,
  trade text not null,
  city text not null,
  country text not null check(country in ('US','GB','CA','AU')),
  -- no_site_found: the listing links no website and a web search found none
  -- site_found: a site that looks like theirs turned up (found_site)
  -- not_checked: no search provider was available for the check
  website_check text not null check(website_check in ('no_site_found','site_found','not_checked')),
  found_site text check(char_length(found_site)<=300),
  check_query text check(char_length(check_query)<=300),
  social_links jsonb not null default '[]' check(jsonb_typeof(social_links)='array'),
  stage text not null default 'new' check(stage in ('new','contacted','won','lost')),
  notes text not null default '' check(char_length(notes)<=4000),
  suppressed boolean not null default false,
  found_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,place_id),
  foreign key(organization_id,search_id) references public.local_searches(organization_id,id) on delete set null (search_id)
);
create index local_businesses_list on public.local_businesses(organization_id,website_check,found_at desc);

do $$ declare t text; begin
 foreach t in array array['local_searches','local_businesses'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(organization_id))',t);
   execute format('revoke all on table public.%I from anon,authenticated',t);
   execute format('grant select on public.%I to authenticated',t);
   execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Live listing lookups cost a Places request each, so they have their own
-- daily cap (app_settings.config.places_view_daily_budget, 300 by default),
-- counted apart from discovery and audit units.
alter table public.api_usage_daily add column places_view_units integer not null default 0;
create or replace function public.reserve_places_view(org uuid,budget integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare limits jsonb; n integer;
begin
 select config into limits from app_settings where organization_id=org;
 insert into api_usage_daily(organization_id,day,units) values(org,(now() at time zone 'UTC')::date,0) on conflict do nothing;
 update api_usage_daily set places_view_units=places_view_units+1
 where organization_id=org and day=(now() at time zone 'UTC')::date
 and places_view_units<coalesce((limits->>'places_view_daily_budget')::integer,budget)
 returning places_view_units into n;
 return n is not null;
end $$;
revoke execute on function public.reserve_places_view(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_places_view(uuid,integer) to service_role;
commit;
