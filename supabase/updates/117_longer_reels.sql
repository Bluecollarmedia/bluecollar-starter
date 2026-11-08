-- ============================================================================
-- Update 117 — reels and post videos may be up to 3 minutes (was 60 seconds). Run once in Supabase → SQL Editor, AFTER 115. Safe to run again.
-- NOT run yet. Story videos keep their 60-second limit.
-- ============================================================================
alter table public.portfolio_media drop constraint if exists portfolio_media_duration_s_check;
alter table public.portfolio_media add constraint portfolio_media_duration_s_check check (duration_s is null or (duration_s > 0 and duration_s <= 180));
