-- supabase/migrations/0002_daily_moments.sql
-- Step 4.2: Daily Moment private storage bucket, server-enforced reciprocal lock,
-- late calculation, caption editing, and streak advancement.

-- 1. Create private `moments` bucket (no public reads)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moments',
  'moments',
  false,
  5242880,
  array['image/jpeg', 'image/webp', 'image/png']
)
on conflict (id) do nothing;

-- Users can upload only into `{couple_id}/{prompt_date}/{auth.uid()}_*.jpg` when they belong to that couple
create policy moments_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] is not null
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and split_part(storage.filename(name), '_', 1) = auth.uid()::text
  );

create policy moments_storage_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'moments'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
    and split_part(storage.filename(name), '_', 1) = auth.uid()::text
  );

-- 2. Restrict direct SELECT on public.moments to the author's own row;
-- partner's photo paths are exposed ONLY through `get_today_moment_bundle` once caller has posted!
create policy moments_select_own on public.moments
  for select using (user_id = auth.uid());

-- 3. Ensure or fetch today's synchronized daily prompt for the caller's active couple
create or replace function public.ensure_today_prompt()
returns public.daily_prompts
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_couple public.couples;
  today_utc date := (now() at time zone 'UTC')::date;
  prompt_row public.daily_prompts;
  random_offset_seconds int;
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

  select * into prompt_row
  from public.daily_prompts
  where couple_id = active_couple.id and prompt_date = today_utc;

  if found then
    return prompt_row;
  end if;

  -- Pick a deterministic-once-inserted random second between 09:00 and 21:00 UTC
  random_offset_seconds := (9 * 3600) + floor(random() * (12 * 3600))::int;

  insert into public.daily_prompts (couple_id, prompt_date, trigger_at)
  values (
    active_couple.id,
    today_utc,
    (today_utc::timestamptz + make_interval(secs => random_offset_seconds))
  )
  on conflict (couple_id, prompt_date) do update
    set couple_id = excluded.couple_id
  returning * into prompt_row;

  return prompt_row;
end;
$$;

-- 4. Submit or retake (max 2 retakes during the 2-minute window) today's Moment
create or replace function public.submit_daily_moment(
  p_prompt_id uuid,
  p_back_photo_path text,
  p_front_photo_path text,
  p_back_blurhash text,
  p_caption text default null,
  p_captured_at timestamptz default now(),
  p_lat double precision default null,
  p_lng double precision default null
)
returns public.moments
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prompt_row public.daily_prompts;
  existing_moment public.moments;
  result_moment public.moments;
  computed_late int;
  next_retake smallint := 0;
  trimmed_caption text := nullif(trim(coalesce(p_caption, '')), '');
  both_posted boolean := false;
  streak_row public.streaks;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into prompt_row
  from public.daily_prompts
  where id = p_prompt_id;

  if not found or not public.is_couple_member(prompt_row.couple_id) then
    raise exception 'PROMPT_NOT_FOUND';
  end if;

  if now() < prompt_row.trigger_at then
    raise exception 'WINDOW_NOT_OPEN_YET';
  end if;

  if trimmed_caption is not null and char_length(trimmed_caption) > 100 then
    raise exception 'CAPTION_TOO_LONG';
  end if;

  computed_late := greatest(0, floor(extract(epoch from (coalesce(p_captured_at, now()) - prompt_row.trigger_at)))::int);

  select * into existing_moment
  from public.moments
  where prompt_id = p_prompt_id and user_id = uid
  for update;

  if found then
    if existing_moment.retake_count >= 2 then
      raise exception 'MAX_RETAKES_REACHED';
    end if;
    if computed_late > 120 then
      raise exception 'RETAKE_WINDOW_CLOSED';
    end if;
    next_retake := existing_moment.retake_count + 1;

    update public.moments
    set back_photo_path = p_back_photo_path,
        front_photo_path = p_front_photo_path,
        back_blurhash = p_back_blurhash,
        caption = trimmed_caption,
        captured_at = coalesce(p_captured_at, now()),
        posted_at = now(),
        late_by_seconds = computed_late,
        retake_count = next_retake,
        lat = p_lat,
        lng = p_lng
    where id = existing_moment.id
    returning * into result_moment;
  else
    insert into public.moments (
      couple_id,
      prompt_id,
      user_id,
      back_photo_path,
      front_photo_path,
      back_blurhash,
      caption,
      captured_at,
      posted_at,
      late_by_seconds,
      retake_count,
      lat,
      lng
    )
    values (
      prompt_row.couple_id,
      p_prompt_id,
      uid,
      p_back_photo_path,
      p_front_photo_path,
      p_back_blurhash,
      trimmed_caption,
      coalesce(p_captured_at, now()),
      now(),
      computed_late,
      0,
      p_lat,
      p_lng
    )
    returning * into result_moment;
  end if;

  -- Log moment_posted event for partner push + silent widget reload
  insert into public.couple_events (couple_id, actor_id, event_type, payload)
  values (
    prompt_row.couple_id,
    uid,
    'moment_posted',
    jsonb_build_object('prompt_id', p_prompt_id, 'is_late', result_moment.is_late, 'retake_count', result_moment.retake_count)
  );

  -- If user's location sharing mode is 'on_moment' and coords were supplied, snapshot them
  if p_lat is not null and p_lng is not null then
    update public.location_shares
    set lat = p_lat,
        lng = p_lng,
        location_updated_at = now()
    where user_id = uid and mode = 'on_moment';
  end if;

  -- Advance couple streak once BOTH partners have posted for prompt_date
  select (count(distinct user_id) = 2) into both_posted
  from public.moments
  where prompt_id = p_prompt_id;

  if both_posted then
    select * into streak_row
    from public.streaks
    where couple_id = prompt_row.couple_id
    for update;

    if not found then
      insert into public.streaks (couple_id, current_count, longest_count, last_completed_date, updated_at)
      values (prompt_row.couple_id, 1, 1, prompt_row.prompt_date, now());
    elsif streak_row.last_completed_date is distinct from prompt_row.prompt_date then
      if streak_row.last_completed_date = (prompt_row.prompt_date - 1) then
        streak_row.current_count := streak_row.current_count + 1;
      else
        streak_row.current_count := 1;
      end if;
      streak_row.longest_count := greatest(streak_row.longest_count, streak_row.current_count);
      update public.streaks
      set current_count = streak_row.current_count,
          longest_count = streak_row.longest_count,
          last_completed_date = prompt_row.prompt_date,
          updated_at = now()
      where couple_id = prompt_row.couple_id;
    end if;
  end if;

  return result_moment;
end;
$$;

-- 5. Edit caption on caller's own Moment for today's prompt
create or replace function public.update_moment_caption(
  p_moment_id uuid,
  p_caption text
)
returns public.moments
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  trimmed_caption text := nullif(trim(coalesce(p_caption, '')), '');
  updated_row public.moments;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if trimmed_caption is not null and char_length(trimmed_caption) > 100 then
    raise exception 'CAPTION_TOO_LONG';
  end if;

  update public.moments
  set caption = trimmed_caption
  where id = p_moment_id and user_id = uid
  returning * into updated_row;

  if not found then
    raise exception 'MOMENT_NOT_FOUND';
  end if;

  return updated_row;
end;
$$;

-- 6. Reciprocal server-gated feed bundle:
-- Returns partner's photo paths & caption ONLY if caller has also posted for today's prompt!
create or replace function public.get_today_moment_bundle()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prompt_row public.daily_prompts;
  my_moment public.moments;
  partner_moment public.moments;
  streak_row public.streaks;
  unlocked boolean := false;
begin
  prompt_row := public.ensure_today_prompt();

  select * into my_moment
  from public.moments
  where prompt_id = prompt_row.id and user_id = uid;

  select * into partner_moment
  from public.moments
  where prompt_id = prompt_row.id and user_id <> uid
  limit 1;

  select * into streak_row
  from public.streaks
  where couple_id = prompt_row.couple_id;

  unlocked := (my_moment.id is not null and partner_moment.id is not null);

  return jsonb_build_object(
    'prompt', to_jsonb(prompt_row),
    'streak', coalesce(to_jsonb(streak_row), jsonb_build_object('current_count', 0, 'longest_count', 0)),
    'mine', case when my_moment.id is not null then to_jsonb(my_moment) else null end,
    'partner', case
      when partner_moment.id is null then null
      when unlocked then jsonb_build_object(
        'id', partner_moment.id,
        'user_id', partner_moment.user_id,
        'locked', false,
        'back_photo_path', partner_moment.back_photo_path,
        'front_photo_path', partner_moment.front_photo_path,
        'back_blurhash', partner_moment.back_blurhash,
        'caption', partner_moment.caption,
        'captured_at', partner_moment.captured_at,
        'posted_at', partner_moment.posted_at,
        'late_by_seconds', partner_moment.late_by_seconds,
        'is_late', partner_moment.is_late,
        'retake_count', partner_moment.retake_count
      )
      else jsonb_build_object(
        'id', partner_moment.id,
        'user_id', partner_moment.user_id,
        'locked', true,
        'back_photo_path', null,
        'front_photo_path', null,
        'back_blurhash', partner_moment.back_blurhash,
        'caption', null,
        'captured_at', partner_moment.captured_at,
        'posted_at', partner_moment.posted_at,
        'late_by_seconds', partner_moment.late_by_seconds,
        'is_late', partner_moment.is_late,
        'retake_count', partner_moment.retake_count
      )
    end
  );
end;
$$;
