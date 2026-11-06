-- supabase/migrations/0001_initial_schema.sql
-- KeepIt: Couple-only BeReal-style schema, constraints, RLS, and atomic pairing RPCs

create extension if not exists "pgcrypto";

create type public.location_mode as enum ('live', 'on_moment', 'ghost');
create type public.couple_state as enum ('pending', 'active');

-- 1. USERS
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_path text,
  timezone text not null default 'UTC',
  push_token text,
  created_at timestamptz not null default now()
);

-- 2. COUPLES (strictly 2 users when active, max 1 couple per user)
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid references public.users(id) on delete cascade,
  invite_code char(6) unique not null check (invite_code ~ '^[A-Z2-9]{6}$'),
  invite_expires_at timestamptz not null default (now() + interval '24 hours'),
  state public.couple_state not null default 'pending',
  paired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint distinct_partners check (user_b_id is null or user_a_id <> user_b_id),
  constraint active_requires_two check (state = 'pending' or user_b_id is not null)
);

create unique index idx_unique_user_a on public.couples(user_a_id);
create unique index idx_unique_user_b on public.couples(user_b_id) where user_b_id is not null;

-- Prevent a user who is user_b in one couple from creating another couple as user_a (and vice versa)
create or replace function public.enforce_single_couple_membership()
returns trigger language plpgsql security definer as $$
begin
  if exists (
    select 1 from public.couples c
    where c.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (
        c.user_a_id = new.user_a_id
        or c.user_b_id = new.user_a_id
        or (new.user_b_id is not null and (c.user_a_id = new.user_b_id or c.user_b_id = new.user_b_id))
      )
  ) then
    raise exception 'USER_ALREADY_IN_COUPLE';
  end if;
  return new;
end;
$$;

create trigger trg_single_couple_membership
before insert or update on public.couples
for each row execute function public.enforce_single_couple_membership();

-- 3. DAILY PROMPTS
create table public.daily_prompts (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  prompt_date date not null,
  trigger_at timestamptz not null,
  notified_at timestamptz,
  unique (couple_id, prompt_date)
);

-- 4. MOMENTS
create table public.moments (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  prompt_id uuid not null references public.daily_prompts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  back_photo_path text not null,
  front_photo_path text not null,
  back_blurhash text not null,
  collage_photo_path text,
  caption text check (caption is null or char_length(caption) <= 100),
  captured_at timestamptz not null,
  posted_at timestamptz not null default now(),
  late_by_seconds int not null default 0 check (late_by_seconds >= 0),
  is_late boolean generated always as (late_by_seconds > 120) stored,
  retake_count smallint not null default 0 check (retake_count between 0 and 2),
  lat double precision,
  lng double precision,
  unique (prompt_id, user_id)
);

-- 5. STATUSES
create table public.statuses (
  user_id uuid primary key references public.users(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  text text not null check (char_length(trim(text)) between 1 and 40),
  duration_preset text not null check (duration_preset in ('1h', '3h', 'tonight')),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 6. LOCATION SHARES & EVENTS
create table public.location_shares (
  user_id uuid primary key references public.users(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  mode public.location_mode not null default 'ghost',
  lat double precision,
  lng double precision,
  accuracy_m real,
  location_updated_at timestamptz,
  mode_changed_at timestamptz not null default now()
);

create table public.couple_events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  event_type text not null check (event_type in ('location_mode_changed', 'nudge', 'moment_posted')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. STREAKS
create table public.streaks (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  current_count int not null default 0 check (current_count >= 0),
  longest_count int not null default 0 check (longest_count >= 0),
  last_completed_date date,
  updated_at timestamptz not null default now()
);

-- PRIVACY TRIGGER: Clear coords in ghost mode & log every mode transition
create or replace function public.enforce_location_privacy()
returns trigger language plpgsql security definer as $$
begin
  if new.mode = 'ghost' then
    new.lat := null;
    new.lng := null;
    new.accuracy_m := null;
  end if;

  if tg_op = 'UPDATE' and old.mode is distinct from new.mode then
    new.mode_changed_at := now();
    insert into public.couple_events (couple_id, actor_id, event_type, payload)
    values (
      new.couple_id,
      new.user_id,
      'location_mode_changed',
      jsonb_build_object('previous_mode', old.mode, 'new_mode', new.mode)
    );
  end if;
  return new;
end;
$$;

create trigger trg_location_privacy
before update on public.location_shares
for each row execute function public.enforce_location_privacy();

-- ============================================================================
-- PAIRING & INVITE CODE RPCs (Atomic, concurrency-safe)
-- ============================================================================

create or replace function public.generate_invite_code()
returns char(6) language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text := '';
  i int;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = candidate);
  end loop;
  return candidate::char(6);
end;
$$;

-- Create or fetch the caller's pending invite couple row (or active couple if already paired)
create or replace function public.create_or_refresh_invite(force_refresh boolean default false)
returns public.couples
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  existing_couple public.couples;
  fresh_code char(6);
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into existing_couple
  from public.couples
  where user_a_id = uid or user_b_id = uid
  limit 1;

  if found then
    if existing_couple.state = 'active' then
      return existing_couple;
    end if;

    if force_refresh or existing_couple.invite_expires_at <= now() then
      fresh_code := public.generate_invite_code();
      update public.couples
      set invite_code = fresh_code,
          invite_expires_at = now() + interval '24 hours'
      where id = existing_couple.id
      returning * into existing_couple;
    end if;

    return existing_couple;
  end if;

  fresh_code := public.generate_invite_code();
  insert into public.couples (user_a_id, invite_code, invite_expires_at, state)
  values (uid, fresh_code, now() + interval '24 hours', 'pending')
  returning * into existing_couple;

  return existing_couple;
end;
$$;

-- Join a partner's 6-character invite code atomically
create or replace function public.redeem_invite_code(raw_code text)
returns public.couples
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cleaned text := upper(regexp_replace(coalesce(raw_code, ''), '[^A-Za-z0-9]', '', 'g'));
  target_couple public.couples;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if length(cleaned) <> 6 then
    raise exception 'INVALID_CODE_FORMAT';
  end if;

  -- Check if caller is already in an active couple
  if exists (
    select 1 from public.couples
    where state = 'active' and (user_a_id = uid or user_b_id = uid)
  ) then
    raise exception 'ALREADY_PAIRED';
  end if;

  select * into target_couple
  from public.couples
  where invite_code = cleaned::char(6)
  for update;

  if not found then
    raise exception 'CODE_NOT_FOUND';
  end if;

  if target_couple.user_a_id = uid then
    raise exception 'SELF_INVITE_FORBIDDEN';
  end if;

  if target_couple.state = 'active' or target_couple.user_b_id is not null then
    raise exception 'COUPLE_FULL';
  end if;

  if target_couple.invite_expires_at <= now() then
    raise exception 'CODE_EXPIRED';
  end if;

  -- Remove any unused pending invite the joining user created for themselves first
  delete from public.couples
  where user_a_id = uid and state = 'pending';

  -- Activate the couple
  update public.couples
  set user_b_id = uid,
      state = 'active',
      paired_at = now()
  where id = target_couple.id
  returning * into target_couple;

  -- Initialize streak and Ghost-by-default location_shares for both partners
  insert into public.streaks (couple_id, current_count, longest_count)
  values (target_couple.id, 0, 0)
  on conflict (couple_id) do nothing;

  insert into public.location_shares (user_id, couple_id, mode)
  values
    (target_couple.user_a_id, target_couple.id, 'ghost'),
    (target_couple.user_b_id, target_couple.id, 'ghost')
  on conflict (user_id) do nothing;

  return target_couple;
end;
$$;

-- Unpair & wipe shared couple rows immediately
create or replace function public.unpair_current_couple()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  delete from public.couples
  where user_a_id = uid or user_b_id = uid;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

create or replace function public.is_couple_member(target_couple uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.couples
    where id = target_couple
      and (user_a_id = auth.uid() or user_b_id = auth.uid())
  );
$$;

alter table public.users enable row level security;
alter table public.couples enable row level security;
alter table public.daily_prompts enable row level security;
alter table public.moments enable row level security;
alter table public.statuses enable row level security;
alter table public.location_shares enable row level security;
alter table public.couple_events enable row level security;
alter table public.streaks enable row level security;

-- Users can read/write themselves and read their paired partner
create policy users_select_self_or_partner on public.users
  for select using (
    id = auth.uid() or exists (
      select 1 from public.couples c
      where (c.user_a_id = auth.uid() and c.user_b_id = users.id)
         or (c.user_b_id = auth.uid() and c.user_a_id = users.id)
    )
  );

create policy users_insert_self on public.users
  for insert with check (id = auth.uid());

create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Couples readable only by its members; mutations go through security-definer RPCs
create policy couples_select_member on public.couples
  for select using (user_a_id = auth.uid() or user_b_id = auth.uid());

create policy prompts_select_member on public.daily_prompts
  for select using (public.is_couple_member(couple_id));

create policy statuses_select_member on public.statuses
  for select using (public.is_couple_member(couple_id));

create policy statuses_upsert_self on public.statuses
  for all using (user_id = auth.uid() and public.is_couple_member(couple_id))
  with check (user_id = auth.uid() and public.is_couple_member(couple_id));

create policy locations_select_member on public.location_shares
  for select using (public.is_couple_member(couple_id));

create policy locations_update_self on public.location_shares
  for update using (user_id = auth.uid() and public.is_couple_member(couple_id))
  with check (user_id = auth.uid() and public.is_couple_member(couple_id));

create policy events_select_member on public.couple_events
  for select using (public.is_couple_member(couple_id));

create policy events_insert_member on public.couple_events
  for insert with check (actor_id = auth.uid() and public.is_couple_member(couple_id));

create policy streaks_select_member on public.streaks
  for select using (public.is_couple_member(couple_id));

-- Realtime publication for instant pairing, statuses, moments, and location mode alerts
alter publication supabase_realtime add table public.couples;
alter publication supabase_realtime add table public.statuses;
alter publication supabase_realtime add table public.moments;
alter publication supabase_realtime add table public.location_shares;
alter publication supabase_realtime add table public.couple_events;
