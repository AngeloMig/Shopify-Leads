begin;
-- Local businesses without a website (a builder with only a Facebook page).
-- Found through Geoapify's Places API, which serves OpenStreetMap data under
-- the ODbL: it may be stored with attribution ("Powered by Geoapify",
-- "© OpenStreetMap contributors"), so a lead keeps its listing details.
-- Scout adds its own research: the website check and social pages found.
create table public.local_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  trade text not null check(char_length(trade) between 2 and 40),
  cities text[] not null check(cardinality(cities) between 1 and 10),
  country text not null check(country in ('US','GB','CA','AU')),
  per_city integer not null default 20 check(per_city between 1 and 50),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(organization_id,id)
);
create index local_searches_recent on public.local_searches(organization_id,created_at desc);

create table public.local_businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  source text not null default 'geoapify' check(source in ('geoapify')),
  place_id text not null check(char_length(place_id) between 8 and 500),
  search_id uuid,
  trade text not null,
  city text not null,
  country text not null check(country in ('US','GB','CA','AU')),
  name text not null check(char_length(name) between 1 and 300),
  address text check(char_length(address)<=500),
  phone text check(char_length(phone)<=100),
  email text check(char_length(email)<=200),
  opening_hours text check(char_length(opening_hours)<=500),
  lat double precision,
  lon double precision,
  osm_url text check(char_length(osm_url)<=300),
  -- no_site_found: the listing has no website and a web search found none
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
  unique(organization_id,source,place_id),
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
commit;
