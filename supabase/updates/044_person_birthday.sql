-- 044: optional birthday on a person's profile.
-- Needs: nothing new (people table from schema.sql). Safe to run twice. Run any time after the base schema.
-- Who can read it: the same people who can already read that person (people_select policy).
-- Who can change it: only the person themself (people_update policy: id = my_person_id()).
-- The app works without this update: the Birthday field just says it is not available yet.
alter table public.people add column if not exists birthday date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_birthday_range') then
    alter table public.people add constraint people_birthday_range
      check (birthday is null or birthday >= date '1900-01-01');
  end if;
end $$;
