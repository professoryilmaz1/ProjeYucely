create extension if not exists pgcrypto;

create table if not exists public.vovyyvov_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  city text,
  country text,
  skills text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vovyyvov_needs (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 200),
  description text,
  budget numeric(12,2) check (budget is null or budget >= 0),
  city text,
  status text not null default 'OPEN' check (status in ('OPEN','MATCHED','CLOSED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vovyyvov_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill text not null check (char_length(skill) between 1 and 120),
  hours_text text,
  minimum_amount numeric(12,2) check (minimum_amount is null or minimum_amount >= 0),
  city text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vovyyvov_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 2 and 200),
  description text,
  amount numeric(12,2) check (amount is null or amount >= 0),
  city text,
  remote boolean not null default false,
  status text not null default 'OPEN' check (status in ('OPEN','FILLED','CLOSED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vovyyvov_money_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_amount numeric(12,2) not null check (target_amount > 0),
  projected_amount numeric(12,2) not null default 0 check (projected_amount >= 0),
  status text not null default 'PLANNING' check (status in ('PLANNING','ACTIVE','ACHIEVED','CANCELLED')),
  selected_opportunity_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vovyyvov_needs_status_idx on public.vovyyvov_needs(status, created_at desc);
create index if not exists vovyyvov_availability_active_idx on public.vovyyvov_availability(active, created_at desc);
create index if not exists vovyyvov_opportunities_status_idx on public.vovyyvov_opportunities(status, created_at desc);
create index if not exists vovyyvov_money_missions_user_idx on public.vovyyvov_money_missions(user_id, created_at desc);

alter table public.vovyyvov_profiles enable row level security;
alter table public.vovyyvov_needs enable row level security;
alter table public.vovyyvov_availability enable row level security;
alter table public.vovyyvov_opportunities enable row level security;
alter table public.vovyyvov_money_missions enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vovyyvov_profiles to authenticated;
grant select, insert, update, delete on public.vovyyvov_needs to authenticated;
grant select, insert, update, delete on public.vovyyvov_availability to authenticated;
grant select, insert, update, delete on public.vovyyvov_opportunities to authenticated;
grant select, insert, update, delete on public.vovyyvov_money_missions to authenticated;

create policy "vovyyvov_profiles_select_own" on public.vovyyvov_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "vovyyvov_profiles_insert_own" on public.vovyyvov_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vovyyvov_profiles_update_own" on public.vovyyvov_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "vovyyvov_profiles_delete_own" on public.vovyyvov_profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "vovyyvov_needs_read_open_or_own" on public.vovyyvov_needs for select to authenticated using (status = 'OPEN' or (select auth.uid()) = requester_id);
create policy "vovyyvov_needs_insert_own" on public.vovyyvov_needs for insert to authenticated with check ((select auth.uid()) = requester_id);
create policy "vovyyvov_needs_update_own" on public.vovyyvov_needs for update to authenticated using ((select auth.uid()) = requester_id) with check ((select auth.uid()) = requester_id);
create policy "vovyyvov_needs_delete_own" on public.vovyyvov_needs for delete to authenticated using ((select auth.uid()) = requester_id);

create policy "vovyyvov_availability_read_active_or_own" on public.vovyyvov_availability for select to authenticated using (active = true or (select auth.uid()) = user_id);
create policy "vovyyvov_availability_insert_own" on public.vovyyvov_availability for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vovyyvov_availability_update_own" on public.vovyyvov_availability for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "vovyyvov_availability_delete_own" on public.vovyyvov_availability for delete to authenticated using ((select auth.uid()) = user_id);

create policy "vovyyvov_opportunities_read_open_or_own" on public.vovyyvov_opportunities for select to authenticated using (status = 'OPEN' or (select auth.uid()) = owner_id);
create policy "vovyyvov_opportunities_insert_own" on public.vovyyvov_opportunities for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "vovyyvov_opportunities_update_own" on public.vovyyvov_opportunities for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "vovyyvov_opportunities_delete_own" on public.vovyyvov_opportunities for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "vovyyvov_money_missions_select_own" on public.vovyyvov_money_missions for select to authenticated using ((select auth.uid()) = user_id);
create policy "vovyyvov_money_missions_insert_own" on public.vovyyvov_money_missions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vovyyvov_money_missions_update_own" on public.vovyyvov_money_missions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "vovyyvov_money_missions_delete_own" on public.vovyyvov_money_missions for delete to authenticated using ((select auth.uid()) = user_id);
