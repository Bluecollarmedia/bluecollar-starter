-- ============================================================================
-- Update 59 — run once in Supabase → SQL Editor (safe to run again).
--
-- A maintenance service can now be "a set number of visits this season" (for example 6 basin cuts between July 19 and
-- October 19). The app spreads the visits evenly across the contract and saves the exact dates (the owner can change any of
-- them, or type the dates himself). The service is due on the next saved date it has not done yet.
--  • maintenance_service_rules.scheduled_dates: the saved visit dates.
--  • frequency 'fixed_dates' is now allowed, and needs at least one date.
-- Nothing existing changes: weekly, every 2 weeks, every N days, once in a date range and as needed work as before.
-- ============================================================================

alter table public.maintenance_service_rules add column if not exists scheduled_dates date[];

alter table public.maintenance_service_rules drop constraint if exists maintenance_service_rules_frequency_check;
alter table public.maintenance_service_rules add constraint maintenance_service_rules_frequency_check
  check (frequency in ('weekly', 'biweekly', 'every_n_days', 'seasonal_window', 'as_needed', 'fixed_dates'));

alter table public.maintenance_service_rules drop constraint if exists maintenance_service_rules_fixed_dates_check;
alter table public.maintenance_service_rules add constraint maintenance_service_rules_fixed_dates_check
  check (frequency <> 'fixed_dates' or (scheduled_dates is not null and cardinality(scheduled_dates) between 1 and 365));
