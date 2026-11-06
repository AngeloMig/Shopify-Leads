begin;
-- A local search can now cover several trades and several countries, and
-- cities are optional: with none, each country is searched as a whole.
alter table public.local_searches
 add column trades text[] not null default '{}' check(cardinality(trades) between 0 and 10),
 add column countries text[] not null default '{}' check(countries <@ array['US','GB','CA','AU']::text[]),
 alter column trade drop not null,
 alter column country drop not null,
 drop constraint local_searches_cities_check,
 add constraint local_searches_cities_check check(cardinality(cities)<=10);
update public.local_searches set trades=array[trade] where trade is not null and trades='{}';
update public.local_searches set countries=array[country] where country is not null and countries='{}';
commit;
