-- Update 95: a person's language (English / Español) is saved on their account, so the push notification the server sends
-- them is in their language too. The phone sets it whenever the language is changed and when it opens signed in. Safe to run more than once.

alter table public.people add column if not exists language text not null default 'en';
alter table public.people drop constraint if exists people_language_check;
alter table public.people add constraint people_language_check check (language in ('en', 'es'));

create or replace function public.set_my_language(p_language text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id();
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  if p_language not in ('en', 'es') then raise exception 'Unknown language.'; end if;
  update public.people set language = p_language where id = me and language is distinct from p_language;
end;
$$;
revoke all on function public.set_my_language(text) from public, anon;
grant execute on function public.set_my_language(text) to authenticated;
