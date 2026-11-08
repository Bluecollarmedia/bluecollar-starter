-- ============================================================================
-- Update 119 — when ANYTHING with a stored file is deleted, its file is deleted from storage too. Run once in Supabase → SQL Editor,
-- AFTER 074 (the storage clean-up queue) and the tables below exist. Safe to run again. NOT run yet; read it first.
--
-- Until now the files of a deleted photo / attachment / report / document were removed only by the app, one screen at a time, and NOT at all
-- when a row went away with its parent (delete a project, a task, a route, a stop, a storm, a truck, a customer: the photos' rows went by
-- themselves, the files stayed in storage forever). Now the DATABASE does it, for every way a row can be deleted:
--   a trigger on each table that holds a file puts the file's key on the existing clean-up queue (storage_cleanup_queue); the
--   storage-cleanup function (already deployed) removes the files, retrying if storage is busy. The app asks it to run right after deletes.
-- It deletes only the key on the row that was deleted. A key already queued (or already gone) is not a problem: the queue skips repeats.
-- ============================================================================

-- A. One trigger function for every table with a file_key column.
create or replace function public._enqueue_deleted_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.file_key, '') <> '' and old.company_id is not null then
    insert into public.storage_cleanup_queue (company_id, source_table, file_key)
    values (old.company_id, tg_table_name, old.file_key)
    on conflict (file_key) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public._enqueue_deleted_file() from public, anon, authenticated;

-- B. Put it on every table that has both company_id and file_key (project photos, task attachments, maintenance photos, Snow visit photos,
--    Snow reference photos, truck documents, owner project photos, and any later table built the same way).
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r' and c.relname <> 'storage_cleanup_queue'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'file_key' and not a.attisdropped)
  loop
    execute format('drop trigger if exists zz_enqueue_deleted_file on public.%I', t.relname);
    execute format('create trigger zz_enqueue_deleted_file after delete on public.%I for each row execute function public._enqueue_deleted_file()', t.relname);
  end loop;
end $$;

-- C. Problem reports keep their photos inside the row (a list), so they get their own small trigger.
create or replace function public._enqueue_deleted_issue_files()
returns trigger language plpgsql security definer set search_path = public as $$
declare p jsonb;
begin
  if old.company_id is null or old.photos is null or jsonb_typeof(old.photos) <> 'array' then return old; end if;
  for p in select * from jsonb_array_elements(old.photos) loop
    if coalesce(p->>'key', '') <> '' and (p->>'key') !~ '^https?://' then
      insert into public.storage_cleanup_queue (company_id, source_table, file_key)
      values (old.company_id, 'property_issues', p->>'key')
      on conflict (file_key) do nothing;
    end if;
  end loop;
  return old;
end;
$$;
revoke all on function public._enqueue_deleted_issue_files() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.property_issues') is not null then
    drop trigger if exists zz_enqueue_deleted_issue_files on public.property_issues;
    create trigger zz_enqueue_deleted_issue_files after delete on public.property_issues for each row execute function public._enqueue_deleted_issue_files();
  end if;
end $$;

notify pgrst, 'reload schema';
