-- supabase/migrations/0003_status_share.sql
-- Step 4.3: Partner-visible Status Share (emoji + short text, 1h / 3h / till tonight auto-expiry)

-- 1. Upsert caller's status with automatic timezone-aware expiry calculation
create or replace function public.upsert_my_status(
  p_emoji text,
  p_text text,
  p_duration_preset text,
  p_expires_at timestamptz default null
)
returns public.statuses
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  user_tz text := 'UTC';
  cleaned_emoji text := trim(coalesce(p_emoji, ''));
  cleaned_text text := trim(coalesce(p_text, ''));
  computed_expires timestamptz;
  result_row public.statuses;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if char_length(cleaned_emoji) < 1 or char_length(cleaned_emoji) > 8 then
    raise exception 'INVALID_STATUS_EMOJI';
  end if;

  if char_length(cleaned_text) < 1 or char_length(cleaned_text) > 40 then
    raise exception 'INVALID_STATUS_TEXT';
  end if;

  if p_duration_preset not in ('1h', '3h', 'tonight') then
    raise exception 'INVALID_STATUS_DURATION';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    raise exception 'NOT_PAIRED';
  end if;

  select coalesce(timezone, 'UTC') into user_tz
  from public.users
  where id = uid;

  if p_expires_at is not null and p_expires_at > now() then
    computed_expires := p_expires_at;
  elsif p_duration_preset = '1h' then
    computed_expires := now() + interval '1 hour';
  elsif p_duration_preset = '3h' then
    computed_expires := now() + interval '3 hours';
  else
    -- 'tonight': end of current local day (23:59:59) in the poster's timezone,
    -- or at least +30 minutes if set right before midnight
    computed_expires := greatest(
      now() + interval '30 minutes',
      ((date_trunc('day', now() at time zone user_tz) + interval '1 day' - interval '1 second') at time zone user_tz)
    );
  end if;

  insert into public.statuses (
    user_id,
    couple_id,
    emoji,
    text,
    duration_preset,
    expires_at,
    updated_at
  )
  values (
    uid,
    active_couple.id,
    cleaned_emoji,
    cleaned_text,
    p_duration_preset,
    computed_expires,
    now()
  )
  on conflict (user_id) do update
    set couple_id = excluded.couple_id,
        emoji = excluded.emoji,
        text = excluded.text,
        duration_preset = excluded.duration_preset,
        expires_at = excluded.expires_at,
        updated_at = now()
  returning * into result_row;

  return result_row;
end;
$$;

-- 2. Clear caller's active status immediately
create or replace function public.clear_my_status()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  delete from public.statuses where user_id = uid;
end;
$$;

-- 3. Fetch active (non-expired) statuses for both partners, pruning expired rows automatically
create or replace function public.get_couple_statuses()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  my_status public.statuses;
  partner_status public.statuses;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into active_couple
  from public.couples
  where state = 'active' and (user_a_id = uid or user_b_id = uid)
  limit 1;

  if not found then
    return jsonb_build_object('mine', null, 'partner', null);
  end if;

  -- Prune expired statuses for this couple
  delete from public.statuses
  where couple_id = active_couple.id and expires_at <= now();

  select * into my_status
  from public.statuses
  where couple_id = active_couple.id and user_id = uid and expires_at > now();

  select * into partner_status
  from public.statuses
  where couple_id = active_couple.id and user_id <> uid and expires_at > now()
  limit 1;

  return jsonb_build_object(
    'mine', case when my_status.user_id is not null then to_jsonb(my_status) else null end,
    'partner', case when partner_status.user_id is not null then to_jsonb(partner_status) else null end
  );
end;
$$;
