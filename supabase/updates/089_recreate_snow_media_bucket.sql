-- ============================================================================
-- Update 89 — run once in Supabase → SQL Editor (safe to run again). NOT run yet.
--
-- THE reason no Snow photo ever uploaded: the private "snow-media" storage bucket is missing on the live project
-- (every upload answered "Bucket not found"). Update 22 created it originally; it was deleted somewhere along the way,
-- most likely during the storage cleanup on Oct 20. The permission rules on storage.objects survived — only the bucket
-- row is gone. This puts it back, exactly as update 22 made it. Owner reference photos and worker stop photos cannot
-- work until this is run.
-- ============================================================================

-- If this errors with something like "must be owner of table buckets" (newer Supabase projects refuse bucket changes from the
-- SQL editor), create it by hand instead: Storage -> New bucket -> name it exactly  snow-media  -> keep "Public bucket" OFF.
-- The select at the end should then list it.

insert into storage.buckets (id, name, public)
values ('snow-media', 'snow-media', false)
on conflict (id) do update set public = false;

-- Says what exists afterwards, so the result is visible in the editor.
select id, public from storage.buckets order by id;
