-- KREVUNO Global Opportunity Engine.
-- Extends the existing marketplace table so external/public opportunities,
-- hourly sync state, geocoding cache and personalized matches can coexist
-- with existing local KREVUNO opportunities.

alter table if exists public.vovyyvov_opportunities
  add column if not exists kind text not null default 'JOB',
  add column if not exists country text,
  add column if not exists company_name text,
  add column if not exists source_provider text,
  add column if not exists source_id text,
  add column if not exists source_url text,
  add column if not exists location_text text,
  add column if not exists currency text,
  add column if not exists employment_type text,
  add column if not exists salary_text text,
  add column if not exists skills text[] not null default '{}',
  add column if not exists tags text[] not null default '{}',
  add column if not exists classification jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists external boolean not null default false,
  add column if not exists public_visibility boolean not null default true,
  add column if not exists map_visibility boolean not null default false,
  add column if not exists dedupe_hash text,
  add column if not exists ingested_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists source_updated_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists search_radius_miles integer check (search_radius_miles between 5 and 500),
  add column if not exists duplicate_of uuid references public.vovyyvov_opportunities(id) on delete set null;

alter table if exists public.vovyyvov_opportunities
  drop constraint if exists vovyyvov_opportunities_status_check;

alter table if exists public.vovyyvov_opportunities
  add constraint vovyyvov_opportunities_status_check
  check (status in ('OPEN','FILLED','CLOSED','CANCELLED','EXPIRED'));

alter table if exists public.vovyyvov_opportunities
  drop constraint if exists vovyyvov_opportunities_kind_check;

alter table if exists public.vovyyvov_opportunities
  add constraint vovyyvov_opportunities_kind_check
  check (kind in ('JOB','GIG','HELP','SHIFT','CONTRACT','TASK','VOLUNTEER','OTHER'));

create unique index if not exists vovyyvov_opportunities_provider_source_uidx
  on public.vovyyvov_opportunities(source_provider, source_id)
  where source_provider is not null and source_id is not null;

create unique index if not exists vovyyvov_opportunities_external_dedupe_uidx
  on public.vovyyvov_opportunities(dedupe_hash)
  where dedupe_hash is not null and external = true;

create index if not exists vovyyvov_opportunities_public_idx
  on public.vovyyvov_opportunities(status, public_visibility, external, created_at desc);

create index if not exists vovyyvov_opportunities_geo_discovery_idx
  on public.vovyyvov_opportunities(country, city, remote, created_at desc);

create index if not exists vovyyvov_opportunities_expiration_idx
  on public.vovyyvov_opportunities(status, expires_at, last_seen_at desc);

create table if not exists public.vovyyvov_opportunity_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null check (char_length(trigger_source) between 2 and 40),
  providers text[] not null default '{}',
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  normalized_count integer not null default 0 check (normalized_count >= 0),
  upserted_count integer not null default 0 check (upserted_count >= 0),
  expired_count integer not null default 0 check (expired_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.vovyyvov_opportunity_geo_cache (
  location_key text primary key,
  query_text text not null,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  updated_at timestamptz not null default now()
);

create table if not exists public.vovyyvov_opportunity_matches (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.vovyyvov_opportunities(id) on delete cascade,
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  reasons text[] not null default '{}',
  components jsonb not null default '{}'::jsonb,
  matched_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, opportunity_id)
);

create index if not exists vovyyvov_opportunity_matches_user_idx
  on public.vovyyvov_opportunity_matches(user_id, score desc, matched_at desc);

alter table public.vovyyvov_opportunity_sync_runs enable row level security;
alter table public.vovyyvov_opportunity_geo_cache enable row level security;
alter table public.vovyyvov_opportunity_matches enable row level security;

grant select, insert, update, delete on public.vovyyvov_opportunity_matches to authenticated;

drop policy if exists "vovyyvov_opportunity_matches_select_own" on public.vovyyvov_opportunity_matches;
drop policy if exists "vovyyvov_opportunity_matches_insert_own" on public.vovyyvov_opportunity_matches;
drop policy if exists "vovyyvov_opportunity_matches_update_own" on public.vovyyvov_opportunity_matches;
drop policy if exists "vovyyvov_opportunity_matches_delete_own" on public.vovyyvov_opportunity_matches;

create policy "vovyyvov_opportunity_matches_select_own"
  on public.vovyyvov_opportunity_matches
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "vovyyvov_opportunity_matches_insert_own"
  on public.vovyyvov_opportunity_matches
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "vovyyvov_opportunity_matches_update_own"
  on public.vovyyvov_opportunity_matches
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vovyyvov_opportunity_matches_delete_own"
  on public.vovyyvov_opportunity_matches
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
