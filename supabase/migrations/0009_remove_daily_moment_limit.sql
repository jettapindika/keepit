-- 0009_remove_daily_moment_limit.sql
-- Removes the 5-posts-per-day database trigger limit so users can share unlimited Moments per day.

drop trigger if exists trg_enforce_daily_moments_quota on public.moments;
drop function if exists public.enforce_daily_moments_quota();
