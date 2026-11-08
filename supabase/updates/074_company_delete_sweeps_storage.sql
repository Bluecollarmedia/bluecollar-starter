-- ============================================================================
-- Update 74 — run once in Supabase → SQL Editor, AFTER update 68 (safe to run again). NOT run yet; read it before running.
--
-- Deleting a company now also deletes EVERYTHING stored for it, not just the files that a table row points at. Along with the
-- per-file list from update 68, the deletion queues whole storage folders:
--   {companyId}/        all of the company's photos, videos, documents (projects, maintenance, Snow, trucks, issues ...)
--   ids/{personId}/      ID photos of the people whose accounts are deleted with the company
--   avatars/{personId}/  their profile pictures
-- The storage-cleanup function empties these folders in both R2 buckets (and the Snow stand-in bucket) and retries until they are empty.
-- A folder is only marked done when it is really empty, so nothing is reported deleted while files remain.
-- ============================================================================
alter table public.storage_cleanup_queue add column if not exists kind text not null default 'file';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'storage_cleanup_kind_check') then
    alter table public.storage_cleanup_queue add constraint storage_cleanup_kind_check check (kind in ('file', 'prefix'));
  end if;
end $$;

drop function if exists public.storage_cleanup_claim(integer);
create or replace function public.storage_cleanup_claim(p_limit integer default 25)
returns table (id uuid, company_id uuid, kind text, file_key text, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select q.id from public.storage_cleanup_queue q
     where q.status = 'pending' and q.next_attempt_at <= now() and (q.locked_until is null or q.locked_until < now())
     order by q.next_attempt_at limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  )
  update public.storage_cleanup_queue q set locked_until = now() + interval '10 minutes', attempts = q.attempts + 1
    from due where q.id = due.id
  returning q.id, q.company_id, q.kind, q.file_key, q.attempts;
end;
$$;

-- p_more = a folder still has files left (the run deleted a batch): keep it pending, right away, without counting a failed try.
drop function if exists public.storage_cleanup_finish(uuid, boolean, text);
create or replace function public.storage_cleanup_finish(p_id uuid, p_ok boolean, p_error text default null, p_more boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare q public.storage_cleanup_queue;
begin
  select * into q from public.storage_cleanup_queue where id = p_id for update;
  if not found then raise exception 'No such cleanup item.'; end if;
  if p_ok then
    update public.storage_cleanup_queue set status = 'done', processed_at = now(), locked_until = null, last_error = null where id = p_id;
  elsif p_more then
    update public.storage_cleanup_queue set locked_until = null, next_attempt_at = now(), attempts = greatest(attempts - 1, 0) where id = p_id;
  elsif q.attempts >= 8 then
    update public.storage_cleanup_queue set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500) where id = p_id;
  else
    update public.storage_cleanup_queue set locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500),
      next_attempt_at = now() + least(power(2, q.attempts) * interval '1 minute', interval '6 hours') where id = p_id;
  end if;
end;
$$;

create or replace function public._enqueue_company_prefixes(p_company uuid, p_people uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer; pid uuid;
begin
  insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'company_folder', p_company::text || '/', 'prefix')
    on conflict (file_key) do nothing;
  get diagnostics c = row_count; n := n + c;
  foreach pid in array coalesce(p_people, '{}') loop
    insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'person_ids', 'ids/' || pid::text || '/', 'prefix') on conflict (file_key) do nothing;
    get diagnostics c = row_count; n := n + c;
    insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'person_avatars', 'avatars/' || pid::text || '/', 'prefix') on conflict (file_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end;
$$;
revoke all on function public._enqueue_company_prefixes(uuid, uuid[]) from public, anon, authenticated;

revoke all on function public.storage_cleanup_claim(integer), public.storage_cleanup_finish(uuid, boolean, text, boolean), public.storage_cleanup_status() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.storage_cleanup_claim(integer), public.storage_cleanup_finish(uuid, boolean, text, boolean), public.storage_cleanup_status() to service_role;
  end if;
end $$;

-- delete_my_company: same as update 68, plus the folder sweep above.
create or replace function public.delete_my_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
  prev jsonb;
  who text;
  gone_people uuid[];
  gone_users uuid[];
begin
  if pid is null then raise exception 'not signed in'; end if;

  select m.company_id into cid
    from public.company_members m
   where m.person_id = pid and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the company owner can delete the company.'; end if;

  select name into cname from public.companies where id = cid;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(cname, ''))) then
    raise exception 'Type the company name exactly to confirm.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.one_company'));

  prev := public.company_closure_preview();
  if (prev ->> 'on_the_clock')::int > 0 or (prev ->> 'timing_a_property')::int > 0 then
    raise exception 'Someone is still clocked in. Clock them out (Hours & Labor) before closing the company.';
  end if;
  if (prev ->> 'dispatched_storms')::int > 0 then
    raise exception 'A snow storm is still dispatched. End it before closing the company.';
  end if;

  -- Close every way back in first (if anything below fails, all of this is rolled back too).
  update public.team_codes set is_active = false where company_id = cid;
  update public.snow_signup_codes set is_active = false where company_id = cid;
  update public.join_requests set status = 'cancelled', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';
  update public.snow_access_requests set status = 'removed', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';

  select trim(first_name || ' ' || last_name) into who from public.people where id = pid;
  insert into public.company_closure_log (company_id, company_name, closed_by, closed_by_name, counts)
  values (cid, cname, pid, who, prev);

  -- The company's stored files (photos, documents) live outside the database. Their names are written to a cleanup list BEFORE the rows
  -- are deleted, in this same all-or-nothing step, so nothing is left unlisted. A separate job must delete the files from storage.
  perform public._enqueue_company_files(cid);

  -- Deleting a company deletes everything inside it, including the accounts of the people who belonged ONLY to it (owner included), so
  -- nobody is left with a login that opens onto "Finish setting up". Anyone who also belongs to (or has Snow access in) another company
  -- keeps their account. Decided now, before the memberships disappear.
  select coalesce(array_agg(distinct m.person_id), '{}') into gone_people
    from public.company_members m
   where m.company_id = cid
     and not exists (select 1 from public.company_members m2 where m2.person_id = m.person_id and m2.company_id <> cid)
     and not exists (select 1 from public.snow_staff s where s.person_id = m.person_id and s.company_id <> cid);

  -- Everything stored for this company and for the people whose accounts go with it (every file key starts with the company id;
  -- ID photos and avatars start with the person id). A background job empties these folders in storage, in both buckets.
  perform public._enqueue_company_prefixes(cid, gone_people);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  perform set_config('app.allow_company_delete', 'on', true);
  delete from public.companies where id = cid;
  perform set_config('app.allow_company_delete', 'off', true);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  if exists (select 1 from public.companies where id = cid) then
    raise exception 'The company could not be deleted.';
  end if;

  -- Same all-or-nothing step: remove those people and their logins. If any of this fails, the company is NOT deleted either.
  select coalesce(array_agg(user_id) filter (where user_id is not null), '{}') into gone_users from public.people where id = any(gone_people);
  delete from public.people where id = any(gone_people);
  delete from auth.users where id = any(gone_users);
  update public.company_closure_log
     set counts = coalesce(counts, '{}'::jsonb) || jsonb_build_object('accounts_deleted', coalesce(array_length(gone_people, 1), 0))
   where company_id = cid;
end;
$$;
revoke execute on function public.delete_my_company(text) from public, anon;
grant execute on function public.delete_my_company(text) to authenticated;

notify pgrst, 'reload schema';
