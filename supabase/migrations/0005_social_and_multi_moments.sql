-- supabase/migrations/0005_social_and_multi_moments.sql
-- Additive schema migration for:
-- 1) Social Profiles (username, bio, pronouns, mood_song, banner_color, website, friend_code, is_private, dump_mode)
-- 2) Multiple Daily Moments (up to 5 per user per day, video support, filters, location_label, music, overlays, tags, Snap Once)
-- 3) Friends Circle (friendships table + RLS + lookup RPCs)
-- 4) Moment Comments & Emoji Reactions (persistent tables + JSONB sync + deletion)
-- 5) Direct Messages & Conversations (partner + friends DMs + Snap Once 15s server enforcement)

-- ============================================================================
-- 1. EXTEND public.users FOR SOCIAL PROFILES & PRIVACY
-- ============================================================================
alter table public.users
  add column if not exists username text,
  add column if not exists bio text not null default 'Keeping daily Moments alive ✨',
  add column if not exists pronouns text not null default '',
  add column if not exists mood_song text not null default 'Sunset Lover · Petit Biscuit',
  add column if not exists banner_color text not null default '#D95D39',
  add column if not exists banner_path text,
  add column if not exists website text not null default '',
  add column if not exists friend_code text,
  add column if not exists is_private boolean not null default false,
  add column if not exists dump_mode boolean not null default false;

create unique index if not exists idx_users_username_lower
  on public.users (lower(username))
  where username is not null and char_length(trim(username)) > 0;

create unique index if not exists idx_users_friend_code_upper
  on public.users (upper(friend_code))
  where friend_code is not null and char_length(trim(friend_code)) > 0;

-- Allow authenticated users to search public/discoverable user profiles by username or friend_code
drop policy if exists users_select_discoverable on public.users;
create policy users_select_discoverable on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or not is_private
    or exists (
      select 1 from public.couples c
      where (c.user_a_id = auth.uid() and c.user_b_id = users.id)
         or (c.user_b_id = auth.uid() and c.user_a_id = users.id)
    )
  );

-- ============================================================================
-- 2. FRIENDS CIRCLE TABLE & RLS
-- ============================================================================
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  friend_id uuid not null references public.users(id) on delete cascade,
  relationship text not null default 'friend' check (relationship in ('partner', 'bestie', 'friend')),
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (user_id <> friend_id),
  unique (user_id, friend_id)
);

create index if not exists idx_friendships_user_id on public.friendships(user_id);
create index if not exists idx_friendships_friend_id on public.friendships(friend_id);

alter table public.friendships enable row level security;

drop policy if exists friendships_select_involved on public.friendships;
create policy friendships_select_involved on public.friendships
  for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own on public.friendships
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists friendships_update_own on public.friendships;
create policy friendships_update_own on public.friendships
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own on public.friendships
  for delete to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

create or replace function public.is_approved_viewer(target_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    target_user_id = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = target_user_id and u.is_private = false
    )
    or exists (
      select 1 from public.couples c
      where c.state = 'active'
        and ((c.user_a_id = auth.uid() and c.user_b_id = target_user_id)
          or (c.user_b_id = auth.uid() and c.user_a_id = target_user_id))
    )
    or exists (
      select 1 from public.friendships f
      where f.user_id = target_user_id
        and f.friend_id = auth.uid()
    );
$$;

-- ============================================================================
-- 3. EXTEND public.moments FOR UP TO 5 DAILY POSTS, VIDEO, OVERLAYS & SNAP ONCE
-- ============================================================================
alter table public.moments
  drop constraint if exists moments_prompt_id_user_id_key;

alter table public.moments
  drop constraint if exists moments_caption_check;

alter table public.moments
  add constraint moments_caption_check check (caption is null or char_length(caption) <= 160);

alter table public.moments
  alter column couple_id drop not null,
  alter column prompt_id drop not null;

alter table public.moments
  add column if not exists author_name text,
  add column if not exists author_username text,
  add column if not exists author_avatar text,
  add column if not exists daily_index smallint not null default 1 check (daily_index between 1 and 5),
  add column if not exists local_date date not null default ((now() at time zone 'UTC')::date),
  add column if not exists media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  add column if not exists video_uri text,
  add column if not exists video_duration_seconds smallint,
  add column if not exists filter_preset text not null default 'normal',
  add column if not exists location_label text,
  add column if not exists music_track jsonb,
  add column if not exists tagged_users jsonb not null default '[]'::jsonb,
  add column if not exists overlays jsonb not null default '[]'::jsonb,
  add column if not exists visibility text not null default 'everyone' check (visibility in ('partner', 'friends', 'everyone')),
  add column if not exists snap_once boolean not null default false,
  add column if not exists snap_duration_seconds smallint not null default 15 check (snap_duration_seconds between 5 and 60),
  add column if not exists viewed_by_user_ids jsonb not null default '[]'::jsonb,
  add column if not exists snap_opened_at_by_user jsonb not null default '{}'::jsonb,
  add column if not exists comments jsonb not null default '[]'::jsonb,
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists watermark_tag text not null default '#KeepIt';

create index if not exists idx_moments_user_local_date on public.moments(user_id, local_date);
create index if not exists idx_moments_couple_posted on public.moments(couple_id, posted_at desc);

-- Enforce max 5 posts per user per local calendar day at the database level
create or replace function public.enforce_daily_moments_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  daily_cnt int;
begin
  if tg_op = 'INSERT' then
    select count(*) into daily_cnt
    from public.moments
    where user_id = new.user_id
      and local_date = coalesce(new.local_date, (new.captured_at at time zone 'UTC')::date);

    if daily_cnt >= 5 then
      raise exception 'DAILY_MOMENT_LIMIT_REACHED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_daily_moments_quota on public.moments;
create trigger trg_enforce_daily_moments_quota
before insert on public.moments
for each row execute function public.enforce_daily_moments_quota();

-- Update storage bucket to allow video/mp4 and video/quicktime up to 15 MB
update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png', 'video/mp4', 'video/quicktime']
where id = 'moments';

-- RLS Policies on public.moments for owner, partner, and approved friends
drop policy if exists moments_insert_own on public.moments;
create policy moments_insert_own on public.moments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists moments_update_own_or_social on public.moments;
create policy moments_update_own_or_social on public.moments
  for update to authenticated
  using (
    user_id = auth.uid()
    or (couple_id is not null and public.is_couple_member(couple_id))
    or public.is_approved_viewer(user_id)
  );

drop policy if exists moments_delete_own on public.moments;
create policy moments_delete_own on public.moments
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists moments_select_authorized on public.moments;
create policy moments_select_authorized on public.moments
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      -- Never return a Snap Once post that has already been expired for this viewer
      not (
        snap_once = true
        and user_id <> auth.uid()
        and (
          viewed_by_user_ids ? (auth.uid()::text)
          or (
            (snap_opened_at_by_user ->> (auth.uid()::text)) is not null
            and ((snap_opened_at_by_user ->> (auth.uid()::text))::timestamptz + make_interval(secs => snap_duration_seconds)) <= now()
          )
        )
      )
      and (
        (couple_id is not null and public.is_couple_member(couple_id) and visibility in ('partner', 'everyone'))
        or (visibility in ('friends', 'everyone') and public.is_approved_viewer(user_id))
      )
    )
  );

-- ============================================================================
-- 4. DIRECT MESSAGES TABLE & SNAP ONCE EXPIRATION ENFORCEMENT
-- ============================================================================
create table if not exists public.direct_messages (
  id text primary key,
  conversation_id text not null,
  sender_id uuid not null references public.users(id) on delete cascade,
  sender_name text not null,
  recipient_id uuid not null references public.users(id) on delete cascade,
  text text not null default '',
  media_uri text,
  reply_moment_id uuid references public.moments(id) on delete set null,
  reply_moment_preview text,
  snap_once boolean not null default false,
  snap_opened_at timestamptz,
  viewed_by_user_ids jsonb not null default '[]'::jsonb,
  viewed_at timestamptz,
  reactions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dm_conversation_created
  on public.direct_messages(conversation_id, created_at asc);

alter table public.direct_messages enable row level security;

drop policy if exists dm_select_participants on public.direct_messages;
create policy dm_select_participants on public.direct_messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists dm_insert_sender on public.direct_messages;
create policy dm_insert_sender on public.direct_messages
  for insert to authenticated
  with check (sender_id = auth.uid());

drop policy if exists dm_update_participants on public.direct_messages;
create policy dm_update_participants on public.direct_messages
  for update to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Server-side trigger: scrub DM text & media_uri when a Snap Once message is marked viewed by recipient
create or replace function public.scrub_expired_snap_dm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.snap_once = true and new.viewed_by_user_ids ? (new.recipient_id::text) then
    new.text := '';
    new.media_uri := null;
    new.viewed_at := coalesce(new.viewed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_scrub_expired_snap_dm on public.direct_messages;
create trigger trg_scrub_expired_snap_dm
before update on public.direct_messages
for each row execute function public.scrub_expired_snap_dm();

alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.direct_messages;
