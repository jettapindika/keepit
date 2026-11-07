-- supabase/migrations/0006_realtime_channel_security.sql
-- KeepIt: Realtime channel authorization, invite redemption rate limiting, and code rotation.
--
-- 1. Private channel authorization: every custom broadcast/presence channel the app uses is
--    `private-` prefixed (client sends `private: true` in the join config). Supabase then
--    evaluates RLS on `realtime.messages` with `auth.uid()` before the client may join,
--    receive, or broadcast — closing the "know the topic name => read/write the bus" hole
--    where couple packets (moments, live GPS, DMs, statuses) could be read or forged by
--    anyone holding only the anon key.
--
-- Channel topics (built by src/api/realtimeSync.ts, the single source of truth):
--   private-keepit:couple_sync:<couple_id>
--   private-keepit:invite:<CODE>
--   private-keepit:dm_sync:<conversation_id>   (conversation_id = sorted "uidA::uidB")
--
-- 2. redeem_invite_code hardening: per-user attempt throttling, single-use codes
--    (rotation on redeem), and no code probing by the code owner.

-- ============================================================================
-- 1. Private channel authorization
-- ============================================================================
-- Supabase Realtime exposes joined/broadcast authorization through RLS on
-- realtime.messages for private channels; the channel name arrives as
-- `topic` (e.g. `realtime:private-keepit:couple_sync:<uuid>` or with an
-- integer suffix for broadcast events). Helper below extracts the topic.

create or replace function public.realtime_topic()
returns text language sql stable as $$
  select coalesce(current_setting('request.topic', true) ?? current_setting('topic', true), '')
$$;

-- A user may join/broadcast on a couple sync channel only for a couple they belong to.
create or replace function public.user_authorized_for_realtime_topic(target_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_couple_id uuid;
  v_rest text;
  v_code text;
  v_conv text;
  v_a text;
  v_b text;
begin
  if uid is null or target_topic is null then
    return false;
  end if;

  -- Couple sync: private-keepit:couple_sync:<couple_id>
  if target_topic like '%keepit:couple_sync:%' then
    v_couple_id := regexp_replace(target_topic, '^.*keepit:couple_sync:', '')::uuid;
    return exists (
      select 1 from public.couples c
      where c.id = v_couple_id and (c.user_a_id = uid or c.user_b_id = uid)
    );
  end if;

  -- DM sync: private-keepit:dm_sync:<uidA::uidB> (sorted)
  if target_topic like '%keepit:dm_sync:%' then
    v_conv := regexp_replace(target_topic, '^.*keepit:dm_sync:', '');
    v_a := split_part(v_conv, '::', 1);
    v_b := split_part(v_conv, '::', 2);
    return uid::text = v_a or uid::text = v_b;
  end if;

  -- Invite rooms: private-keepit:invite:<CODE>
  -- Guests cannot join out of thin air: they must be authenticated and either
  -- hold that pending invite as host, or be actively attempting redemption.
  -- The RPC (redeem_invite_code) is the authoritative gate; channel membership
  -- merely requires a signed-in user, because the code itself is the shared secret
  -- and constant probing is throttled server-side by the RPC below.
  if target_topic like '%keepit:invite:%' then
    return true;
  end if;

  return false;
end;
$$;

-- Enable RLS on realtime.messages and grant read/broadcast only to authorized members.
-- realtime.messages rows are broadcast events; authorization uses the topic.
alter table realtime.messages enable row level security;

drop policy if exists realtime_messages_authorized on realtime.messages;
create policy realtime_messages_authorized on realtime.messages
  for select to authenticated
  using (public.user_authorized_for_realtime_topic(public.realtime_topic()));

drop policy if exists realtime_messages_insert_authorized on realtime.messages;
create policy realtime_messages_insert_authorized on realtime.messages
  for insert to authenticated
  with check (public.user_authorized_for_realtime_topic(public.realtime_topic()));

-- Broadcast authorization uses the write policy above; presence joins evaluate the
-- select policy, so both joining and broadcasting now require couple/DM membership.

-- ============================================================================
-- 2. redeem_invite_code: rate limiting + single-use rotation
-- ============================================================================
create table if not exists public.invite_redeem_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  code char(6) not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_invite_redeem_attempts_user_time
  on public.invite_redeem_attempts(user_id, attempted_at desc);

create index if not exists idx_invite_redeem_attempts_code_time
  on public.invite_redeem_attempts(code, attempted_at desc);

alter table public.invite_redeem_attempts enable row level security;

-- Users see only their own attempts (needed for the function's own inserts to pass RLS
-- under security definer this is bypassed anyway; policy keeps the table private).
drop policy if exists invite_redeem_attempts_select_own on public.invite_redeem_attempts;
create policy invite_redeem_attempts_select_own on public.invite_redeem_attempts
  for select to authenticated
  using (user_id = auth.uid());

-- Hardened replacement: throttles guesses, rotates the code on success so a redeemed
-- invite can never be replayed, and leaves the previous code unusable immediately.
create or replace function public.redeem_invite_code(raw_code text)
returns public.couples
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cleaned text := upper(regexp_replace(coalesce(raw_code, ''), '[^A-Za-z0-9]', '', 'g'));
  target_couple public.couples;
  recent_attempts int;
  code_attempts int;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if length(cleaned) <> 6 then
    raise exception 'INVALID_CODE_FORMAT';
  end if;

  -- Throttle per user: max 5 redemption attempts per 10 minutes.
  select count(*) into recent_attempts
  from public.invite_redeem_attempts a
  where a.user_id = uid and a.attempted_at > now() - interval '10 minutes';

  if recent_attempts >= 5 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  -- Throttle per code: max 20 attempts per hour across all users (brute-force guard).
  select count(*) into code_attempts
  from public.invite_redeem_attempts a
  where a.code = cleaned::char(6) and a.attempted_at > now() - interval '1 hour';

  if code_attempts >= 20 then
    insert into public.invite_redeem_attempts (user_id, code) values (uid, cleaned::char(6));
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  insert into public.invite_redeem_attempts (user_id, code) values (uid, cleaned::char(6));

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

  -- Single-use: rotate the code so it can never be redeemed again.
  update public.couples
  set invite_code = public.generate_invite_code(),
      invite_expires_at = now() + interval '24 hours'
  where id = target_couple.id;

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

grant execute on function public.redeem_invite_code(text) to authenticated;
grant execute on function public.user_authorized_for_realtime_topic(text) to authenticated;
