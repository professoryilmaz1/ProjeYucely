-- VOVYYVOV opt-in geographic search support.
-- Location is optional; clients only send coordinates after explicit user choice/permission.

alter table if exists public.vovyyvov_needs
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists search_radius_miles integer check (search_radius_miles between 5 and 500);

alter table if exists public.vovyyvov_availability
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists search_radius_miles integer check (search_radius_miles between 5 and 500);

alter table if exists public.vovyyvov_opportunities
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table if exists public.vovyyvov_money_missions
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists search_radius_miles integer check (search_radius_miles between 5 and 500);

create index if not exists vovyyvov_needs_location_idx on public.vovyyvov_needs(latitude, longitude) where latitude is not null and longitude is not null;
create index if not exists vovyyvov_availability_location_idx on public.vovyyvov_availability(latitude, longitude) where latitude is not null and longitude is not null;
create index if not exists vovyyvov_opportunities_location_idx on public.vovyyvov_opportunities(latitude, longitude) where latitude is not null and longitude is not null;
