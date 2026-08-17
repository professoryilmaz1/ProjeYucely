-- Additive KREVUNO instant matching fields. Existing tables and RLS remain intact.
alter table if exists public.vovyyvov_needs
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists category text,
  add column if not exists urgent boolean not null default false,
  add column if not exists map_opt_in boolean not null default false,
  add column if not exists public_listing boolean not null default false,
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists voice_url text;

alter table if exists public.vovyyvov_availability
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists available_now boolean not null default false,
  add column if not exists map_opt_in boolean not null default false,
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists voice_url text;

alter table if exists public.vovyyvov_opportunities
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists category text,
  add column if not exists urgent boolean not null default false,
  add column if not exists map_opt_in boolean not null default false,
  add column if not exists public_listing boolean not null default false,
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists voice_url text,
  add column if not exists source_need_id uuid references public.vovyyvov_needs(id) on delete set null;

create unique index if not exists vovyyvov_opportunities_source_need_uq on public.vovyyvov_opportunities(source_need_id) where source_need_id is not null;
create index if not exists krevuno_needs_live_geo_idx on public.vovyyvov_needs(status,map_opt_in,latitude,longitude,created_at desc) where status='OPEN' and map_opt_in=true and latitude is not null and longitude is not null;
create index if not exists krevuno_availability_live_geo_idx on public.vovyyvov_availability(active,map_opt_in,latitude,longitude,created_at desc) where active=true and map_opt_in=true and latitude is not null and longitude is not null;
create index if not exists krevuno_opportunities_live_geo_idx on public.vovyyvov_opportunities(status,map_opt_in,latitude,longitude,created_at desc) where status='OPEN' and map_opt_in=true and latitude is not null and longitude is not null;
