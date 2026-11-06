-- supabase/migrations/0004_map_and_extras.sql
-- Step 4.5 & 4.6: Consent-first Map & Location, Nudge/Poke, Timeline/Memories,
-- Monthly Memory Recap, Together Collage, and Delete Account & All Data.

-- 1. Fetch caller & partner location shares + recent privacy-mode change events
create or replace function public.get_couple_locations()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  mine_row public.location_shares;
  partner_row public.location_shares;
  events_json jsonb;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    return jsonb_build_object('mine', null, 'partner', null, 'events', '[]'::jsonb);
  end if;

  -- Ensure rows exist (Ghost mode by default)
  insert into public.location_shares (user_id, couple_id, mode)
  values
    (active_couple.user_a_id, active_couple.id, 'ghost'),
    (active_couple.user_b_id, active_couple.id, 'ghost')
  on conflict (user_id) do nothing;

  select * into mine_row
  from public.location_shares
  where couple_id = active_couple.id and user_id = uid;

  select * into partner_row
  from public.location_shares
  where couple_id = active_couple.id and user_id <> uid
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
  into events_json
  from (
    select id, actor_id, event_type, payload, created_at
    from public.couple_events
    where couple_id = active_couple.id
      and event_type = 'location_mode_changed'
    order by created_at desc
    limit 12
  ) e;

  return jsonb_build_object(
    'mine', to_jsonb(mine_row),
    'partner', case
      when partner_row.user_id is null then null
      when partner_row.mode = 'ghost' then jsonb_build_object(
        'user_id', partner_row.user_id,
        'couple_id', partner_row.couple_id,
        'mode', 'ghost',
        'lat', null,
        'lng', null,
        'accuracy_m', null,
        'location_updated_at', null,
        'mode_changed_at', partner_row.mode_changed_at
      )
      else to_jsonb(partner_row)
    end,
    'events', events_json
  );
end;
$$;

-- 2. Update caller's location sharing mode & coordinates (trg_location_privacy logs mode changes automatically)
create or replace function public.update_my_location_share(
  p_mode public.location_mode,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m real default null
)
returns public.location_shares
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  latest_moment public.moments;
  next_lat double precision := p_lat;
  next_lng double precision := p_lng;
  result_row public.location_shares;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    raise exception 'NOT_PAIRED';
  end if;

  insert into public.location_shares (user_id, couple_id, mode)
  values (uid, active_couple.id, 'ghost')
  on conflict (user_id) do nothing;

  if p_mode = 'ghost' then
    next_lat := null;
    next_lng := null;
  elsif p_mode = 'on_moment' and (next_lat is null or next_lng is null) then
    select * into latest_moment
    from public.moments
    where couple_id = active_couple.id and user_id = uid and lat is not null and lng is not null
    order by posted_at desc
    limit 1;

    if found then
      next_lat := latest_moment.lat;
      next_lng := latest_moment.lng;
    end if;
  end if;

  update public.location_shares
  set mode = p_mode,
      lat = next_lat,
      lng = next_lng,
      accuracy_m = case when p_mode = 'ghost' then null else p_accuracy_m end,
      location_updated_at = case when next_lat is not null and next_lng is not null then now() else location_updated_at end
  where user_id = uid
  returning * into result_row;

  return result_row;
end;
$$;

-- 3. Send a lightweight couple Nudge/Poke (rate-limited to 1 every 30s per sender)
create or replace function public.send_partner_nudge(p_note text default null)
returns public.couple_events
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  last_nudge_at timestamptz;
  cleaned_note text := nullif(trim(coalesce(p_note, '')), '');
  event_row public.couple_events;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    raise exception 'NOT_PAIRED';
  end if;

  select max(created_at) into last_nudge_at
  from public.couple_events
  where couple_id = active_couple.id
    and actor_id = uid
    and event_type = 'nudge';

  if last_nudge_at is not null and last_nudge_at > (now() - interval '30 seconds') then
    raise exception 'NUDGE_COOLDOWN';
  end if;

  insert into public.couple_events (couple_id, actor_id, event_type, payload)
  values (
    active_couple.id,
    uid,
    'nudge',
    jsonb_build_object('note', coalesce(left(cleaned_note, 40), 'Thinking of you'))
  )
  returning * into event_row;

  return event_row;
end;
$$;

-- 4. Fetch Monthly Memories Archive (past days + completed today) for Calendar & Monthly Recap
create or replace function public.get_month_memories(p_year int, p_month int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  start_date date := make_date(p_year, p_month, 1);
  end_date date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  today_utc date := (now() at time zone 'UTC')::date;
  days_json jsonb;
  streak_row public.streaks;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    return jsonb_build_object('days', '[]'::jsonb, 'streak', null);
  end if;

  select * into streak_row
  from public.streaks
  where couple_id = active_couple.id;

  -- Past days are unlocked; today's partner Moment is included only if caller also posted today
  select coalesce(jsonb_agg(day_obj order by prompt_date desc), '[]'::jsonb)
  into days_json
  from (
    select
      dp.prompt_date,
      jsonb_build_object(
        'prompt_id', dp.id,
        'prompt_date', dp.prompt_date,
        'mine', (
          select to_jsonb(m1)
          from public.moments m1
          where m1.prompt_id = dp.id and m1.user_id = uid
          limit 1
        ),
        'partner', (
          select case
            when dp.prompt_date < today_utc or exists (
              select 1 from public.moments m_self
              where m_self.prompt_id = dp.id and m_self.user_id = uid
            ) then to_jsonb(m2)
            else null
          end
          from public.moments m2
          where m2.prompt_id = dp.id and m2.user_id <> uid
          limit 1
        )
      ) as day_obj
    from public.daily_prompts dp
    where dp.couple_id = active_couple.id
      and dp.prompt_date between start_date and end_date
      and exists (select 1 from public.moments m_any where m_any.prompt_id = dp.id)
  ) sub;

  return jsonb_build_object(
    'days', days_json,
    'streak', coalesce(to_jsonb(streak_row), jsonb_build_object('current_count', 0, 'longest_count', 0))
  );
end;
$$;

-- 5. Delete caller's public.users + couple rows (Edge Function delete-couple-or-user also deletes Storage + auth.users)
create or replace function public.delete_my_account_data()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  delete from public.couples where user_a_id = uid or user_b_id = uid;
  delete from public.users where id = uid;
end;
$$;
