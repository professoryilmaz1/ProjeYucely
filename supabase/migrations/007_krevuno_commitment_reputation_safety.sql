create table if not exists public.krevuno_engagements (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null references public.vovyyvov_needs(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  worker_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'WORKER_ACCEPTED' check (status in ('WORKER_ACCEPTED','CONFIRMED','COMPLETED','CANCELLED','DISPUTED')),
  agreed_pay numeric(12,2) check (agreed_pay is null or agreed_pay >= 0),
  currency text not null default 'USD',
  service_fee_rate numeric(6,5) not null default 0.07 check (service_fee_rate >= 0 and service_fee_rate <= 1),
  service_fee_amount numeric(12,2) not null default 0 check (service_fee_amount >= 0),
  fee_status text not null default 'NOT_DUE' check (fee_status in ('NOT_DUE','DUE','PAID','REFUNDED','WAIVED')),
  starts_at timestamptz,
  ends_at timestamptz,
  worker_accepted_at timestamptz not null default now(),
  requester_confirmed_at timestamptz,
  worker_completed_at timestamptz,
  requester_completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text check (cancel_reason is null or cancel_reason in ('EMERGENCY_MEDICAL','SAFETY_CONCERN','TERMS_CHANGED','TRANSPORT_WEATHER','OTHER')),
  cancel_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> worker_id)
);

create unique index if not exists krevuno_one_active_engagement_per_need
  on public.krevuno_engagements(need_id)
  where status in ('WORKER_ACCEPTED','CONFIRMED');
create index if not exists krevuno_engagement_requester_idx on public.krevuno_engagements(requester_id, created_at desc);
create index if not exists krevuno_engagement_worker_idx on public.krevuno_engagements(worker_id, created_at desc);

create table if not exists public.krevuno_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating_points bigint not null default 0 check (rating_points >= 0),
  rating_count integer not null default 0 check (rating_count >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),
  confirmed_no_shows integer not null default 0 check (confirmed_no_shows >= 0),
  suspended_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.krevuno_ratings (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.krevuno_engagements(id) on delete cascade,
  rater_id uuid not null references auth.users(id) on delete cascade,
  ratee_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score between 1 and 10),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (engagement_id, rater_id),
  check (rater_id <> ratee_id)
);
create index if not exists krevuno_ratings_ratee_idx on public.krevuno_ratings(ratee_id, created_at desc);

create table if not exists public.krevuno_no_show_reports (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.krevuno_engagements(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  accused_id uuid not null references auth.users(id) on delete cascade,
  reason_note text check (reason_note is null or char_length(reason_note) <= 1000),
  status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','REJECTED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (engagement_id, reporter_id),
  check (reporter_id <> accused_id)
);
create index if not exists krevuno_no_show_accused_idx on public.krevuno_no_show_reports(accused_id, status, created_at desc);

alter table public.krevuno_engagements enable row level security;
alter table public.krevuno_reputation enable row level security;
alter table public.krevuno_ratings enable row level security;
alter table public.krevuno_no_show_reports enable row level security;

drop policy if exists "krevuno_engagements_read_party" on public.krevuno_engagements;
create policy "krevuno_engagements_read_party" on public.krevuno_engagements
  for select to authenticated using ((select auth.uid()) in (requester_id, worker_id));

drop policy if exists "krevuno_reputation_read_own" on public.krevuno_reputation;
create policy "krevuno_reputation_read_own" on public.krevuno_reputation
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "krevuno_ratings_read_party" on public.krevuno_ratings;
create policy "krevuno_ratings_read_party" on public.krevuno_ratings
  for select to authenticated using ((select auth.uid()) in (rater_id, ratee_id));

drop policy if exists "krevuno_no_show_read_party" on public.krevuno_no_show_reports;
create policy "krevuno_no_show_read_party" on public.krevuno_no_show_reports
  for select to authenticated using ((select auth.uid()) in (reporter_id, accused_id));

grant select on public.krevuno_engagements, public.krevuno_reputation, public.krevuno_ratings, public.krevuno_no_show_reports to authenticated;

create or replace function public.krevuno_accept_need(p_need_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  n public.vovyyvov_needs%rowtype;
  rep public.krevuno_reputation%rowtype;
  e public.krevuno_engagements%rowtype;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into n from public.vovyyvov_needs where id = p_need_id for update;
  if not found then raise exception 'NEED_NOT_FOUND'; end if;
  if n.requester_id = u then raise exception 'CANNOT_ACCEPT_OWN_NEED'; end if;
  if n.status <> 'OPEN' then raise exception 'NEED_NOT_OPEN'; end if;
  if n.starts_at is not null and n.starts_at < now() - interval '15 minutes' then raise exception 'NEED_ALREADY_STARTED'; end if;

  insert into public.krevuno_reputation(user_id) values (u) on conflict (user_id) do nothing;
  select * into rep from public.krevuno_reputation where user_id = u;
  if rep.suspended_until is not null and rep.suspended_until > now() then
    raise exception 'ACCOUNT_TEMPORARILY_SUSPENDED_UNTIL_%', rep.suspended_until;
  end if;

  if exists (select 1 from public.krevuno_engagements where need_id = p_need_id and status in ('WORKER_ACCEPTED','CONFIRMED')) then
    raise exception 'NEED_ALREADY_HAS_ACTIVE_ENGAGEMENT';
  end if;

  insert into public.krevuno_engagements(
    need_id, requester_id, worker_id, agreed_pay, currency, starts_at, ends_at
  ) values (
    n.id, n.requester_id, u, n.budget, coalesce(n.currency,'USD'), n.starts_at, n.ends_at
  ) returning * into e;

  return jsonb_build_object(
    'ok', true,
    'engagement_id', e.id,
    'status', e.status,
    'message', 'Worker acceptance recorded. Commitment and employer service fee begin only after requester confirmation.'
  );
end;
$$;

create or replace function public.krevuno_confirm_engagement(p_engagement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  e public.krevuno_engagements%rowtype;
  rep public.krevuno_reputation%rowtype;
  fee numeric(12,2);
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into e from public.krevuno_engagements where id = p_engagement_id for update;
  if not found then raise exception 'ENGAGEMENT_NOT_FOUND'; end if;
  if e.requester_id <> u then raise exception 'REQUESTER_ONLY'; end if;
  if e.status <> 'WORKER_ACCEPTED' then raise exception 'ENGAGEMENT_NOT_AWAITING_CONFIRMATION'; end if;

  insert into public.krevuno_reputation(user_id) values (u) on conflict (user_id) do nothing;
  select * into rep from public.krevuno_reputation where user_id = u;
  if rep.suspended_until is not null and rep.suspended_until > now() then
    raise exception 'ACCOUNT_TEMPORARILY_SUSPENDED_UNTIL_%', rep.suspended_until;
  end if;

  fee := round(coalesce(e.agreed_pay,0) * 0.07, 2);
  update public.krevuno_engagements
     set status='CONFIRMED', requester_confirmed_at=now(), service_fee_amount=fee,
         fee_status=case when fee > 0 then 'DUE' else 'NOT_DUE' end, updated_at=now()
   where id=e.id;
  update public.vovyyvov_needs set status='MATCHED', updated_at=now() where id=e.need_id;

  return jsonb_build_object(
    'ok', true,
    'engagement_id', e.id,
    'status', 'CONFIRMED',
    'worker_marketplace_fee_rate', 0,
    'employer_service_fee_rate', 0.07,
    'employer_service_fee_amount', fee,
    'currency', e.currency,
    'fee_status', case when fee > 0 then 'DUE' else 'NOT_DUE' end
  );
end;
$$;

create or replace function public.krevuno_cancel_engagement(
  p_engagement_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  e public.krevuno_engagements%rowtype;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_reason not in ('EMERGENCY_MEDICAL','SAFETY_CONCERN','TERMS_CHANGED','TRANSPORT_WEATHER','OTHER') then
    raise exception 'INVALID_CANCELLATION_REASON';
  end if;
  if p_reason='OTHER' and coalesce(length(trim(p_note)),0) < 3 then raise exception 'OTHER_REASON_NOTE_REQUIRED'; end if;

  select * into e from public.krevuno_engagements where id=p_engagement_id for update;
  if not found then raise exception 'ENGAGEMENT_NOT_FOUND'; end if;
  if u not in (e.requester_id,e.worker_id) then raise exception 'NOT_ENGAGEMENT_PARTY'; end if;
  if e.status not in ('WORKER_ACCEPTED','CONFIRMED') then raise exception 'ENGAGEMENT_NOT_CANCELLABLE'; end if;

  update public.krevuno_engagements
     set status='CANCELLED', cancelled_at=now(), cancelled_by=u,
         cancel_reason=p_reason, cancel_note=nullif(trim(p_note),''), updated_at=now()
   where id=e.id;

  if u=e.requester_id then
    update public.vovyyvov_needs set status='CANCELLED', updated_at=now() where id=e.need_id;
  else
    update public.vovyyvov_needs set status='OPEN', updated_at=now() where id=e.need_id and status='MATCHED';
  end if;

  return jsonb_build_object('ok',true,'engagement_id',e.id,'status','CANCELLED','reason',p_reason);
end;
$$;

create or replace function public.krevuno_confirm_completion(p_engagement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  e public.krevuno_engagements%rowtype;
  done boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into e from public.krevuno_engagements where id=p_engagement_id for update;
  if not found then raise exception 'ENGAGEMENT_NOT_FOUND'; end if;
  if u not in (e.requester_id,e.worker_id) then raise exception 'NOT_ENGAGEMENT_PARTY'; end if;
  if e.status <> 'CONFIRMED' then raise exception 'ENGAGEMENT_NOT_CONFIRMED'; end if;

  if u=e.worker_id then
    update public.krevuno_engagements set worker_completed_at=coalesce(worker_completed_at,now()),updated_at=now() where id=e.id;
  else
    update public.krevuno_engagements set requester_completed_at=coalesce(requester_completed_at,now()),updated_at=now() where id=e.id;
  end if;

  select * into e from public.krevuno_engagements where id=p_engagement_id;
  done := e.worker_completed_at is not null and e.requester_completed_at is not null;
  if done then
    update public.krevuno_engagements set status='COMPLETED',updated_at=now() where id=e.id;
    update public.vovyyvov_needs set status='CLOSED',updated_at=now() where id=e.need_id;
    insert into public.krevuno_reputation(user_id) values (e.requester_id) on conflict (user_id) do nothing;
    insert into public.krevuno_reputation(user_id) values (e.worker_id) on conflict (user_id) do nothing;
    update public.krevuno_reputation r set completed_jobs=(select count(*) from public.krevuno_engagements x where x.status='COMPLETED' and r.user_id in (x.requester_id,x.worker_id)), updated_at=now() where r.user_id in (e.requester_id,e.worker_id);
  end if;

  return jsonb_build_object('ok',true,'engagement_id',e.id,'completed',done,'status',case when done then 'COMPLETED' else 'CONFIRMED' end);
end;
$$;

create or replace function public.krevuno_rate_engagement(
  p_engagement_id uuid,
  p_score integer,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  e public.krevuno_engagements%rowtype;
  target uuid;
  pts bigint;
  cnt integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_score < 1 or p_score > 10 then raise exception 'SCORE_MUST_BE_1_TO_10'; end if;
  if p_comment is not null and length(p_comment)>500 then raise exception 'COMMENT_TOO_LONG'; end if;

  select * into e from public.krevuno_engagements where id=p_engagement_id;
  if not found then raise exception 'ENGAGEMENT_NOT_FOUND'; end if;
  if e.status <> 'COMPLETED' then raise exception 'RATING_ONLY_AFTER_COMPLETED_WORK'; end if;
  if u=e.requester_id then target:=e.worker_id;
  elsif u=e.worker_id then target:=e.requester_id;
  else raise exception 'NOT_ENGAGEMENT_PARTY'; end if;

  insert into public.krevuno_ratings(engagement_id,rater_id,ratee_id,score,comment)
  values (e.id,u,target,p_score,nullif(trim(p_comment),''));

  insert into public.krevuno_reputation(user_id) values (target) on conflict (user_id) do nothing;
  select coalesce(sum(score),0),count(*) into pts,cnt from public.krevuno_ratings where ratee_id=target;
  update public.krevuno_reputation set rating_points=pts,rating_count=cnt,updated_at=now() where user_id=target;

  return jsonb_build_object('ok',true,'ratee_id',target,'rating_points',pts,'rating_count',cnt,'average',case when cnt>0 then round(pts::numeric/cnt,2) else null end);
end;
$$;

create or replace function public.krevuno_report_no_show(
  p_engagement_id uuid,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  e public.krevuno_engagements%rowtype;
  accused uuid;
  report_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into e from public.krevuno_engagements where id=p_engagement_id;
  if not found then raise exception 'ENGAGEMENT_NOT_FOUND'; end if;
  if e.status <> 'CONFIRMED' then raise exception 'NO_SHOW_ONLY_FOR_CONFIRMED_ENGAGEMENT'; end if;
  if u=e.requester_id then accused:=e.worker_id;
  elsif u=e.worker_id then accused:=e.requester_id;
  else raise exception 'NOT_ENGAGEMENT_PARTY'; end if;
  if now() < coalesce(e.starts_at,e.requester_confirmed_at) + interval '15 minutes' then raise exception 'TOO_EARLY_TO_REPORT_NO_SHOW'; end if;

  insert into public.krevuno_no_show_reports(engagement_id,reporter_id,accused_id,reason_note)
  values(e.id,u,accused,nullif(trim(p_reason_note),'')) returning id into report_id;
  update public.krevuno_engagements set status='DISPUTED',updated_at=now() where id=e.id;

  return jsonb_build_object('ok',true,'report_id',report_id,'status','PENDING','message','No-show reports require review before they affect reputation or suspension.');
end;
$$;

create or replace function public.krevuno_resolve_no_show(p_report_id uuid,p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.krevuno_no_show_reports%rowtype;
  strikes integer;
  until_ts timestamptz;
begin
  select * into r from public.krevuno_no_show_reports where id=p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'REPORT_ALREADY_RESOLVED'; end if;

  update public.krevuno_no_show_reports set status=case when p_confirm then 'CONFIRMED' else 'REJECTED' end,resolved_at=now() where id=r.id;
  if not p_confirm then
    return jsonb_build_object('ok',true,'report_id',r.id,'status','REJECTED');
  end if;

  insert into public.krevuno_reputation(user_id) values (r.accused_id) on conflict (user_id) do nothing;
  select count(*) into strikes from public.krevuno_no_show_reports where accused_id=r.accused_id and status='CONFIRMED' and resolved_at >= now()-interval '180 days';
  if strikes >= 5 then
    until_ts := now()+interval '14 days';
    update public.krevuno_reputation set confirmed_no_shows=strikes,suspended_until=greatest(coalesce(suspended_until,until_ts),until_ts),updated_at=now() where user_id=r.accused_id;
  else
    update public.krevuno_reputation set confirmed_no_shows=strikes,updated_at=now() where user_id=r.accused_id;
  end if;

  return jsonb_build_object('ok',true,'report_id',r.id,'status','CONFIRMED','confirmed_no_shows_180d',strikes,'suspended_until',case when strikes>=5 then until_ts else null end);
end;
$$;

create or replace function public.krevuno_public_reputation(p_user_id uuid)
returns table(rating_points bigint,rating_count integer,average_rating numeric,completed_jobs integer)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.rating_points,0),coalesce(r.rating_count,0),
         case when coalesce(r.rating_count,0)>0 then round(r.rating_points::numeric/r.rating_count,2) else null end,
         coalesce(r.completed_jobs,0)
  from (select 1) seed
  left join public.krevuno_reputation r on r.user_id=p_user_id;
$$;

revoke all on function public.krevuno_accept_need(uuid) from public;
revoke all on function public.krevuno_confirm_engagement(uuid) from public;
revoke all on function public.krevuno_cancel_engagement(uuid,text,text) from public;
revoke all on function public.krevuno_confirm_completion(uuid) from public;
revoke all on function public.krevuno_rate_engagement(uuid,integer,text) from public;
revoke all on function public.krevuno_report_no_show(uuid,text) from public;
revoke all on function public.krevuno_resolve_no_show(uuid,boolean) from public;
revoke all on function public.krevuno_public_reputation(uuid) from public;

grant execute on function public.krevuno_accept_need(uuid) to authenticated;
grant execute on function public.krevuno_confirm_engagement(uuid) to authenticated;
grant execute on function public.krevuno_cancel_engagement(uuid,text,text) to authenticated;
grant execute on function public.krevuno_confirm_completion(uuid) to authenticated;
grant execute on function public.krevuno_rate_engagement(uuid,integer,text) to authenticated;
grant execute on function public.krevuno_report_no_show(uuid,text) to authenticated;
grant execute on function public.krevuno_resolve_no_show(uuid,boolean) to service_role;
grant execute on function public.krevuno_public_reputation(uuid) to anon,authenticated;
