-- KREVUNO instant-post and nearby-map RPCs.
create or replace function public.krevuno_post_instant_need(
  p_title text,
  p_kind text default 'JOB',
  p_budget numeric default null,
  p_currency text default 'USD',
  p_starts_at timestamptz default null,
  p_duration_minutes integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_map_opt_in boolean default false,
  p_public_listing boolean default false,
  p_media_url text default null,
  p_media_type text default null,
  p_voice_url text default null
)
returns table(need_id uuid, opportunity_id uuid)
language plpgsql security invoker set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_need uuid; v_op uuid;
  v_title text:=left(trim(coalesce(p_title,'')),200);
  v_kind text:=upper(coalesce(nullif(trim(p_kind),''),'JOB'));
  v_currency text:=upper(left(coalesce(nullif(trim(p_currency),''),'USD'),3));
  v_duration integer:=case when p_duration_minutes is null then null else greatest(15,least(p_duration_minutes,43200)) end;
  v_ends timestamptz:=case when p_starts_at is not null and v_duration is not null then p_starts_at+make_interval(mins=>v_duration) else null end;
  v_category text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_title)<2 then raise exception 'TITLE_REQUIRED'; end if;
  if p_budget is not null and p_budget<0 then raise exception 'INVALID_BUDGET'; end if;
  if p_map_opt_in and (p_latitude is null or p_longitude is null) then raise exception 'LOCATION_REQUIRED_FOR_MAP'; end if;
  v_category:=case
    when lower(v_title)~'(babysit|baby|child|çocuk|bakıcı)' then 'CHILDCARE'
    when lower(v_title)~'(driver|drive|sürücü|şoför)' then 'DRIVING'
    when lower(v_title)~'(weld|kaynak)' then 'WELDING'
    when lower(v_title)~'(farm|field|tarla|bahçe|garden)' then 'FARM_GARDEN'
    when lower(v_title)~'(clean|temiz)' then 'CLEANING'
    when lower(v_title)~'(restaurant|waiter|server|garson|mutfak)' then 'HOSPITALITY'
    when lower(v_title)~'(move|moving|taşı)' then 'MOVING'
    when lower(v_title)~'(paint|boya)' then 'PAINTING'
    when lower(v_title)~'(warehouse|depo)' then 'WAREHOUSE'
    when lower(v_title)~'(construction|inşaat)' then 'CONSTRUCTION'
    else 'OTHER' end;
  insert into public.vovyyvov_needs(requester_id,kind,title,budget,status,latitude,longitude,search_radius_miles,starts_at,ends_at,duration_minutes,currency,category,urgent,map_opt_in,public_listing,media_url,media_type,voice_url)
  values(v_uid,v_kind,v_title,p_budget,'OPEN',p_latitude,p_longitude,50,p_starts_at,v_ends,v_duration,v_currency,v_category,(lower(v_title)~'(now|today|tonight|urgent|hemen|bugün|bu akşam)'),p_map_opt_in,p_public_listing,p_media_url,p_media_type,p_voice_url)
  returning id into v_need;
  insert into public.vovyyvov_opportunities(owner_id,title,description,amount,remote,status,kind,latitude,longitude,search_radius_miles,starts_at,ends_at,duration_minutes,currency,category,urgent,map_opt_in,public_listing,media_url,media_type,voice_url,source_need_id)
  values(v_uid,v_title,'Posted through KREVUNO Instant Match',p_budget,false,'OPEN',v_kind,p_latitude,p_longitude,50,p_starts_at,v_ends,v_duration,v_currency,v_category,(lower(v_title)~'(now|today|tonight|urgent|hemen|bugün|bu akşam)'),p_map_opt_in,p_public_listing,p_media_url,p_media_type,p_voice_url,v_need)
  returning id into v_op;
  return query select v_need,v_op;
end $$;
grant execute on function public.krevuno_post_instant_need(text,text,numeric,text,timestamptz,integer,double precision,double precision,boolean,boolean,text,text,text) to authenticated;

create or replace function public.krevuno_post_instant_availability(
  p_skill text,
  p_hours_text text default null,
  p_minimum_amount numeric default null,
  p_currency text default 'USD',
  p_available_from timestamptz default null,
  p_duration_minutes integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_map_opt_in boolean default false,
  p_available_now boolean default false,
  p_media_url text default null,
  p_media_type text default null,
  p_voice_url text default null
)
returns uuid language plpgsql security invoker set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_id uuid;
  v_skill text:=left(trim(coalesce(p_skill,'')),120);
  v_currency text:=upper(left(coalesce(nullif(trim(p_currency),''),'USD'),3));
  v_duration integer:=case when p_duration_minutes is null then null else greatest(15,least(p_duration_minutes,43200)) end;
  v_until timestamptz:=case when p_available_from is not null and v_duration is not null then p_available_from+make_interval(mins=>v_duration) else null end;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_skill)<1 then raise exception 'SKILL_REQUIRED'; end if;
  if p_minimum_amount is not null and p_minimum_amount<0 then raise exception 'INVALID_MINIMUM'; end if;
  if p_map_opt_in and (p_latitude is null or p_longitude is null) then raise exception 'LOCATION_REQUIRED_FOR_MAP'; end if;
  insert into public.vovyyvov_availability(user_id,skill,hours_text,minimum_amount,active,latitude,longitude,search_radius_miles,available_from,available_until,duration_minutes,currency,available_now,map_opt_in,media_url,media_type,voice_url)
  values(v_uid,v_skill,nullif(trim(coalesce(p_hours_text,'')),''),p_minimum_amount,true,p_latitude,p_longitude,50,p_available_from,v_until,v_duration,v_currency,p_available_now,p_map_opt_in,p_media_url,p_media_type,p_voice_url)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.krevuno_post_instant_availability(text,text,numeric,text,timestamptz,integer,double precision,double precision,boolean,boolean,text,text,text) to authenticated;

create or replace function public.krevuno_nearby_map(p_lat double precision,p_lng double precision,p_radius_miles integer default 50)
returns table(marker_type text,id uuid,title text,latitude double precision,longitude double precision,distance_miles double precision,amount numeric,currency text,time_label text,media_url text,media_type text,public_url text)
language sql stable security definer set search_path=public as $$
with p as (
  select greatest(1,least(coalesce(p_radius_miles,50),100))::double precision radius,p_lat::double precision lat,p_lng::double precision lng,greatest(0.15,abs(cos(radians(p_lat))))::double precision lon_factor
), c as (
  select 'NEED'::text marker_type,n.id,n.title,n.latitude::double precision lat,n.longitude::double precision lng,n.budget amount,n.currency,coalesce(to_char(n.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI "UTC"'),case when n.duration_minutes is not null then n.duration_minutes::text||' min' else '' end) time_label,n.media_url,n.media_type,case when n.public_listing then '/jobs/'||n.id::text else null end public_url
  from public.vovyyvov_needs n,p where n.status='OPEN' and n.map_opt_in=true and n.latitude is not null and n.longitude is not null and n.latitude::double precision between p.lat-(p.radius/69.0) and p.lat+(p.radius/69.0) and n.longitude::double precision between p.lng-(p.radius/(69.0*p.lon_factor)) and p.lng+(p.radius/(69.0*p.lon_factor))
  union all
  select 'WORKER',a.id,a.skill,a.latitude::double precision,a.longitude::double precision,a.minimum_amount,a.currency,coalesce(nullif(a.hours_text,''),case when a.available_now then 'Available now' else '' end),a.media_url,a.media_type,null::text
  from public.vovyyvov_availability a,p where a.active=true and a.map_opt_in=true and a.latitude is not null and a.longitude is not null and a.latitude::double precision between p.lat-(p.radius/69.0) and p.lat+(p.radius/69.0) and a.longitude::double precision between p.lng-(p.radius/(69.0*p.lon_factor)) and p.lng+(p.radius/(69.0*p.lon_factor))
  union all
  select 'NEED',o.id,o.title,o.latitude::double precision,o.longitude::double precision,o.amount,o.currency,coalesce(to_char(o.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI "UTC"'),case when o.duration_minutes is not null then o.duration_minutes::text||' min' else '' end),o.media_url,o.media_type,case when o.public_listing then '/jobs/'||o.id::text else null end
  from public.vovyyvov_opportunities o,p where o.status='OPEN' and o.map_opt_in=true and o.source_need_id is null and o.latitude is not null and o.longitude is not null and o.latitude::double precision between p.lat-(p.radius/69.0) and p.lat+(p.radius/69.0) and o.longitude::double precision between p.lng-(p.radius/(69.0*p.lon_factor)) and p.lng+(p.radius/(69.0*p.lon_factor))
), d as (
  select c.*,3958.7613*2*asin(sqrt(power(sin(radians((c.lat-p.lat)/2)),2)+cos(radians(p.lat))*cos(radians(c.lat))*power(sin(radians((c.lng-p.lng)/2)),2))) dist from c cross join p
)
select marker_type,id,title,round(lat::numeric,2)::double precision,round(lng::numeric,2)::double precision,round(dist::numeric,1)::double precision,amount,currency,time_label,media_url,media_type,public_url from d,p where dist<=p.radius order by dist asc limit 500;
$$;
grant execute on function public.krevuno_nearby_map(double precision,double precision,integer) to anon,authenticated;

create or replace function public.krevuno_public_job(p_id uuid)
returns table(id uuid,title text,description text,amount numeric,currency text,city text,starts_at timestamptz,ends_at timestamptz,duration_minutes integer,date_posted timestamptz,valid_through timestamptz,media_url text,media_type text)
language sql stable security definer set search_path=public as $$
  select n.id,n.title,('Short-term opportunity posted on KREVUNO'||case when n.city is not null then ' in '||n.city else '' end||'.')::text,n.budget,n.currency,n.city,n.starts_at,n.ends_at,n.duration_minutes,n.created_at,coalesce(n.ends_at,n.created_at+interval '30 days'),n.media_url,n.media_type
  from public.vovyyvov_needs n where n.id=p_id and n.status='OPEN' and n.public_listing=true
  union all
  select o.id,o.title,('Short-term opportunity posted on KREVUNO'||case when o.city is not null then ' in '||o.city else '' end||'.')::text,o.amount,o.currency,o.city,o.starts_at,o.ends_at,o.duration_minutes,o.created_at,coalesce(o.ends_at,o.created_at+interval '30 days'),o.media_url,o.media_type
  from public.vovyyvov_opportunities o where o.id=p_id and o.status='OPEN' and o.public_listing=true and o.source_need_id is null
  limit 1;
$$;
grant execute on function public.krevuno_public_job(uuid) to anon,authenticated;
