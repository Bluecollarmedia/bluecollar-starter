-- ============================================================================
-- Update 115 — run once in Supabase → SQL Editor, AFTER 114. NOT run yet; read it first. Safe to run again.
--
-- "Our Work": the portfolio the owner shows to visitors (an Instagram-style feed of projects with photos, videos and music).
-- ADDITIVE: new tables and functions only; nothing existing is altered, dropped or re-granted.
--   * portfolio_settings: the owner's master switch (default OFF) plus the profile text (handle, bio, website). Only the owner can turn it on
--     or off (set_portfolio_enabled); the owner or an admin can edit the profile text.
--   * portfolio_posts / portfolio_media: the posts, and the photos and videos in each one. portfolio_highlights / portfolio_highlight_posts:
--     the circles at the top (Patios, Turf...). Only the company's active owner or admin can read or change these tables.
--   * public_portfolio_config(): anyone may ask "is Our Work on?" (answers only {"enabled": true|false}).
--   * portfolio_stories: the 24-hour stories (a photo, a video, or a designed card that points to a post).
--   * public_portfolio(): anyone (signed in or not) may read the portfolio, but ONLY while the switch is on, and only posts marked visible.
--     It returns no customer names, no addresses and nothing that is not meant for the public.
-- The photos, videos and music files themselves live in the public media bucket (uploaded by the owner through the media function).
-- ============================================================================

create table if not exists public.portfolio_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  handle text not null default 'brightonlawn' check (char_length(handle) between 2 and 30),
  bio text not null default '' check (char_length(bio) <= 300),
  website text not null default '' check (char_length(website) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 600),
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'post' check (kind in ('post','video')),
  project_id uuid references public.projects(id) on delete set null,
  caption text not null default '' check (char_length(caption) <= 2200),
  town text not null default '' check (char_length(town) <= 80),
  taken_on text not null default '' check (char_length(taken_on) <= 30),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  show_in_grid boolean not null default true,
  visible boolean not null default true,
  posted_at timestamptz not null default now(),
  cover_url text,
  cover_thumb_url text,
  music_url text,
  music_title text,
  music_start_s numeric(8,2) check (music_start_s is null or music_start_s >= 0),
  music_end_s numeric(8,2) check (music_end_s is null or music_end_s > 0),
  music_fade boolean not null default true,
  keep_video_sound boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (music_url is null or (music_start_s is not null and music_end_s is not null and music_end_s > music_start_s))
);
create index if not exists idx_portfolio_posts_company on public.portfolio_posts(company_id, posted_at desc);

create table if not exists public.portfolio_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.portfolio_posts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('photo','video')),
  url text not null,
  storage_key text,
  thumb_url text,
  duration_s numeric(8,2) check (duration_s is null or (duration_s > 0 and duration_s <= 60)),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_portfolio_media_post on public.portfolio_media(post_id, position);

create table if not exists public.portfolio_highlights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 14),
  cover_url text,
  mode text not null default 'tag' check (mode in ('tag','manual')),
  tag text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_portfolio_highlights_company on public.portfolio_highlights(company_id, position);

create table if not exists public.portfolio_highlight_posts (
  highlight_id uuid not null references public.portfolio_highlights(id) on delete cascade,
  post_id uuid not null references public.portfolio_posts(id) on delete cascade,
  position int not null default 0,
  primary key (highlight_id, post_id)
);

-- Stories: short-lived items (24 hours) shown as a ring around the profile picture. Three kinds: a photo, a video (up to 60 seconds), or a
-- "share": a framed card for one of the posts, whose look the owner designs (design = background, frame, text); tapping it opens that post.
create table if not exists public.portfolio_stories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('photo','video','share')),
  media_url text,
  media_thumb_url text,
  duration_s numeric(8,2) check (duration_s is null or (duration_s > 0 and duration_s <= 60)),
  post_id uuid references public.portfolio_posts(id) on delete cascade,
  media_id uuid references public.portfolio_media(id) on delete set null,
  design jsonb not null default '{}'::jsonb,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check ((kind = 'share' and post_id is not null) or (kind in ('photo','video') and media_url is not null))
);
create index if not exists idx_portfolio_stories_company on public.portfolio_stories(company_id, created_at);

-- Who may manage the portfolio: the company's active owner or an active admin.
create or replace function public.portfolio_manager(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m
                  where m.company_id = cid and m.person_id = public.my_person_id()
                    and m.status = 'active' and m.role in ('owner','admin'))
$$;
revoke all on function public.portfolio_manager(uuid) from public, anon;
grant execute on function public.portfolio_manager(uuid) to authenticated;

alter table public.portfolio_settings enable row level security;
alter table public.portfolio_posts enable row level security;
alter table public.portfolio_media enable row level security;
alter table public.portfolio_highlights enable row level security;
alter table public.portfolio_highlight_posts enable row level security;
alter table public.portfolio_stories enable row level security;
revoke all on public.portfolio_settings, public.portfolio_posts, public.portfolio_media, public.portfolio_highlights, public.portfolio_highlight_posts, public.portfolio_stories from public, anon, authenticated;

grant select on public.portfolio_settings to authenticated;
grant insert (company_id, handle, bio, website, avatar_url, updated_by) on public.portfolio_settings to authenticated;
grant update (handle, bio, website, avatar_url, updated_by, updated_at) on public.portfolio_settings to authenticated;
grant select, insert, update, delete on public.portfolio_posts, public.portfolio_media, public.portfolio_highlights, public.portfolio_highlight_posts, public.portfolio_stories to authenticated;

drop policy if exists portfolio_settings_manage on public.portfolio_settings;
create policy portfolio_settings_manage on public.portfolio_settings for all to authenticated
  using (public.portfolio_manager(company_id)) with check (public.portfolio_manager(company_id));
drop policy if exists portfolio_posts_manage on public.portfolio_posts;
create policy portfolio_posts_manage on public.portfolio_posts for all to authenticated
  using (public.portfolio_manager(company_id)) with check (public.portfolio_manager(company_id));
drop policy if exists portfolio_media_manage on public.portfolio_media;
create policy portfolio_media_manage on public.portfolio_media for all to authenticated
  using (public.portfolio_manager(company_id)) with check (public.portfolio_manager(company_id));
drop policy if exists portfolio_highlights_manage on public.portfolio_highlights;
create policy portfolio_highlights_manage on public.portfolio_highlights for all to authenticated
  using (public.portfolio_manager(company_id)) with check (public.portfolio_manager(company_id));
drop policy if exists portfolio_highlight_posts_manage on public.portfolio_highlight_posts;
create policy portfolio_highlight_posts_manage on public.portfolio_highlight_posts for all to authenticated
  using (exists (select 1 from public.portfolio_highlights h where h.id = highlight_id and public.portfolio_manager(h.company_id)))
  with check (exists (select 1 from public.portfolio_highlights h where h.id = highlight_id and public.portfolio_manager(h.company_id)));

drop policy if exists portfolio_stories_manage on public.portfolio_stories;
create policy portfolio_stories_manage on public.portfolio_stories for all to authenticated
  using (public.portfolio_manager(company_id)) with check (public.portfolio_manager(company_id));

-- Is Our Work on? Anyone may ask; the answer is only {"enabled": true|false}.
create or replace function public.public_portfolio_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', coalesce((
    select bool_and(s.enabled)
      from public.portfolio_settings s
     where exists (select 1 from public.company_members m
                    where m.company_id = s.company_id and m.role = 'owner' and m.status = 'active')
  ), false))
$$;
revoke all on function public.public_portfolio_config() from public;
grant execute on function public.public_portfolio_config() to anon, authenticated;

-- The owner (and only the owner) turns Our Work on or off.
create or replace function public.set_portfolio_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
begin
  if p_enabled is null then raise exception 'Choose on or off.'; end if;
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid
    from public.company_members m
   where m.person_id = me and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  insert into public.portfolio_settings (company_id, enabled, updated_by, updated_at)
  values (cid, p_enabled, me, now())
  on conflict (company_id) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('enabled', p_enabled);
end;
$$;
revoke all on function public.set_portfolio_enabled(boolean) from public, anon;
grant execute on function public.set_portfolio_enabled(boolean) to authenticated;

-- What visitors see. Only while the switch is on; only posts marked visible; the newest 100.
create or replace function public.public_portfolio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cid uuid;
  prof jsonb;
  posts jsonb;
  hls jsonb;
  sts jsonb;
begin
  select s.company_id into cid
    from public.portfolio_settings s
   where s.enabled
     and exists (select 1 from public.company_members m where m.company_id = s.company_id and m.role = 'owner' and m.status = 'active')
   limit 1;
  if cid is null then return jsonb_build_object('enabled', false); end if;

  select jsonb_build_object('handle', s.handle, 'bio', s.bio, 'website', s.website, 'avatar_url', s.avatar_url) into prof
    from public.portfolio_settings s where s.company_id = cid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'kind', p.kind, 'caption', p.caption, 'town', p.town, 'taken_on', p.taken_on, 'tags', to_jsonb(p.tags),
      'show_in_grid', p.show_in_grid, 'posted_at', p.posted_at, 'cover_url', p.cover_url, 'cover_thumb_url', p.cover_thumb_url,
      'music_url', p.music_url, 'music_title', p.music_title, 'music_start_s', p.music_start_s, 'music_end_s', p.music_end_s,
      'music_fade', p.music_fade, 'keep_video_sound', p.keep_video_sound,
      'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'thumb_url', m.thumb_url,
                                                           'duration_s', m.duration_s, 'position', m.position) order by m.position)
                           from public.portfolio_media m where m.post_id = p.id), '[]'::jsonb)
    ) order by p.posted_at desc), '[]'::jsonb) into posts
    from (select * from public.portfolio_posts where company_id = cid and visible order by posted_at desc limit 100) p;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'name', h.name, 'cover_url', h.cover_url, 'mode', h.mode, 'tag', h.tag, 'position', h.position,
      'post_ids', coalesce((select jsonb_agg(hp.post_id order by hp.position) from public.portfolio_highlight_posts hp where hp.highlight_id = h.id), '[]'::jsonb)
    ) order by h.position), '[]'::jsonb) into hls
    from public.portfolio_highlights h where h.company_id = cid;

  -- Stories still within their 24 hours, oldest first. A shared card is included only while the post it points to is visible.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id, 'kind', st.kind, 'media_url', st.media_url, 'media_thumb_url', st.media_thumb_url, 'duration_s', st.duration_s,
      'post_id', st.post_id, 'media_id', st.media_id, 'design', st.design, 'created_at', st.created_at, 'expires_at', st.expires_at
    ) order by st.created_at), '[]'::jsonb) into sts
    from public.portfolio_stories st
   where st.company_id = cid and st.expires_at > now()
     and (st.kind <> 'share' or exists (select 1 from public.portfolio_posts pp where pp.id = st.post_id and pp.visible));

  return jsonb_build_object('enabled', true, 'profile', prof, 'posts', posts, 'highlights', hls, 'stories', sts);
end;
$$;
revoke all on function public.public_portfolio() from public;
grant execute on function public.public_portfolio() to anon, authenticated;

notify pgrst, 'reload schema';
