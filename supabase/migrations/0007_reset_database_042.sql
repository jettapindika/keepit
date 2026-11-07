-- supabase/migrations/0007_reset_database_042.sql
-- Clean database reset for KeepIt v0.4.2 release:
-- Truncates all application tables and removes stale storage objects so the
-- database starts completely clean for 0.4.2.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'direct_messages') then
    truncate table public.direct_messages cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'friendships') then
    truncate table public.friendships cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'couple_events') then
    truncate table public.couple_events cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'location_shares') then
    truncate table public.location_shares cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'statuses') then
    truncate table public.statuses cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'moments') then
    truncate table public.moments cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'daily_prompts') then
    truncate table public.daily_prompts cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'streaks') then
    truncate table public.streaks cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'couples') then
    truncate table public.couples cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    truncate table public.users cascade;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    delete from storage.objects where bucket_id = 'moments';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    delete from auth.users;
  end if;
end;
$$;
