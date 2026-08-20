-- KREVUNO Global Opportunity Engine
-- Extends vovyyvov_opportunities for external source ingestion,
-- AI classification, deduplication, expiration, and country/city/geo support.

-- Source column: 'local' for user-posted, named value for each API adapter
alter table public.vovyyvov_opportunities
  add column if not exists source text not null default 'local'
    check (source in ('local','remotive','arbeitnow','jobicy','remoteok')),
  add column if not exists external_id text,
  add column if not exists source_url text,
  add column if not exists country text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists kind text default 'EARN'
    check (kind in ('HELP','GIG','JOB','EARN')),
  add column if not exists expires_at timestamptz,
  add column if not exists ingested_at timestamptz,
  add column if not exists ai_labels text[] not null default '{}',
  add column if not exists salary_min numeric(12,2),
  add column if not exists salary_max numeric(12,2),
  add column if not exists company text;

-- Composite dedup index: same (source, external_id) is never duplicated
create unique index if not exists vovyyvov_opportunities_dedup_idx
  on public.vovyyvov_opportunities(source, external_id)
  where external_id is not null;

-- Index by source for fast filtering in the ingestion worker
create index if not exists vovyyvov_opportunities_source_idx
  on public.vovyyvov_opportunities(source, status, created_at desc);

-- Index for expiry sweeps
create index if not exists vovyyvov_opportunities_expires_idx
  on public.vovyyvov_opportunities(expires_at)
  where expires_at is not null;

-- Index for country-based lookup
create index if not exists vovyyvov_opportunities_country_idx
  on public.vovyyvov_opportunities(country, status)
  where country is not null;

-- Allow anonymous (non-authenticated) users to read OPEN external opportunities
-- so the map and earn list work for guests.
alter table public.vovyyvov_opportunities enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'vovyyvov_opportunities'
      and policyname = 'vovyyvov_opportunities_anon_read_external'
  ) then
    execute $p$
      create policy "vovyyvov_opportunities_anon_read_external"
        on public.vovyyvov_opportunities
        for select to anon
        using (status = 'OPEN' and source <> 'local')
    $p$;
  end if;
end $$;

-- Grant the service_role access needed by the ingestion worker
grant select, insert, update on public.vovyyvov_opportunities to service_role;
