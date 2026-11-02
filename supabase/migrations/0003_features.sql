-- Tokisla — migration 0003: TikTok-style feature batch (2026-10-29)
-- Apply AFTER 0001_init.sql and 0002_rls.sql, in the SQL Editor.
-- Adds: video filters, drafts, video replies to comments, duets, polls,
-- comment likes + pinning, and stories (24 hours, human-moderated first).
-- Watch history already exists (0001/0002).

-- ------------------------------------------------------------ videos: new fields
alter table public.videos add column if not exists filter text not null default 'normal'
  check (filter in ('normal', 'warm', 'cool', 'mono', 'vivid'));
alter table public.videos add column if not exists poll jsonb;
alter table public.videos add column if not exists duet_of uuid
  references public.videos(id) on delete set null;
alter table public.videos add column if not exists reply_comment_id uuid
  references public.comments(id) on delete set null;
alter table public.videos add column if not exists reply_video_id uuid
  references public.videos(id) on delete set null;

-- ------------------------------------------------------------ drafts
-- A draft is a 5th moderation status: visible to nobody but its owner and
-- never in any feed or queue until the owner publishes it (status -> pending).
alter table public.videos drop constraint if exists videos_moderation_status_check;
alter table public.videos add constraint videos_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected', 'needs_review', 'draft'));

-- The guard trigger (0001) freezes moderation_status for non-moderators.
-- It is replaced here with the same rules PLUS one narrow bypass: a
-- transaction-local flag that only the publish_draft() RPC below sets,
-- after it has verified ownership itself.
create or replace function public.guard_video_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.allow_status_change', true), '') = 'on' then
    if new.moderation_status = 'approved' and old.moderation_status <> 'approved' then
      new.published_at = coalesce(new.published_at, now());
    end if;
    return new;
  end if;
  if not public.is_moderator() then
    new.moderation_status := old.moderation_status;
    new.rejection_reason := old.rejection_reason;
    new.published_at := old.published_at;
  end if;
  if new.moderation_status = 'approved' and old.moderation_status <> 'approved' then
    new.published_at = coalesce(new.published_at, now());
  end if;
  return new;
end; $$;

create or replace function public.publish_draft(p_video_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.videos
                 where id = p_video_id and creator_id = auth.uid()
                   and moderation_status = 'draft') then
    raise exception 'Draft not found.';
  end if;
  perform set_config('app.allow_status_change', 'on', true);
  update public.videos set moderation_status = 'pending' where id = p_video_id;
end; $$;

-- ------------------------------------------------------------ comment likes + pinning
alter table public.comments add column if not exists is_pinned boolean not null default false;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_likes enable row level security;
create policy comment_likes_select on public.comment_likes for select using (true);
create policy comment_likes_insert on public.comment_likes for insert
  with check (user_id = auth.uid());
create policy comment_likes_delete on public.comment_likes for delete
  using (user_id = auth.uid());

-- Only the video's creator may pin, and only one pin per video. Done via an
-- RPC because the comments UPDATE policy belongs to the comment's author.
create or replace function public.set_comment_pin(p_comment_id uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select video_id into v_id from public.comments where id = p_comment_id;
  if v_id is null then raise exception 'Comment not found.'; end if;
  if not exists (select 1 from public.videos where id = v_id and creator_id = auth.uid()) then
    raise exception 'Only the video creator can pin a comment.';
  end if;
  if p_pinned then
    update public.comments set is_pinned = false where video_id = v_id and is_pinned;
  end if;
  update public.comments set is_pinned = p_pinned where id = p_comment_id;
end; $$;

-- ------------------------------------------------------------ polls
create table if not exists public.poll_votes (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice int not null check (choice in (0, 1)),
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);
alter table public.poll_votes enable row level security;
create policy poll_votes_select on public.poll_votes for select using (true);
create policy poll_votes_insert on public.poll_votes for insert
  with check (user_id = auth.uid());
create policy poll_votes_update on public.poll_votes for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy poll_votes_delete on public.poll_votes for delete
  using (user_id = auth.uid());

-- ------------------------------------------------------------ stories (24h, moderated)
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  storage_path text not null,
  caption text not null default '' check (char_length(caption) <= 200),
  duration_seconds numeric(6, 2),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.stories enable row level security;
create policy stories_select on public.stories for select
  using (
    (moderation_status = 'approved' and created_at > now() - interval '24 hours')
    or user_id = auth.uid()
    or public.is_moderator()
  );
create policy stories_insert on public.stories for insert
  with check (user_id = auth.uid() and moderation_status = 'pending');
create policy stories_update on public.stories for update
  using (user_id = auth.uid() or public.is_moderator())
  with check (user_id = auth.uid() or public.is_moderator());
create policy stories_delete on public.stories for delete
  using (user_id = auth.uid() or public.is_moderator());

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
alter table public.story_views enable row level security;
create policy story_views_own on public.story_views for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Story media lives in its own private bucket. Uploads are direct from the
-- app into the owner's folder (same pattern as avatars); reads follow the
-- story row: approved story media is readable, owners read their own.
insert into storage.buckets (id, name, public) values ('stories', 'stories', false)
on conflict (id) do nothing;

create or replace function public.object_story_approved(obj_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stories
    where storage_path = obj_name and moderation_status = 'approved'
  )
$$;

create policy storage_stories_read on storage.objects for select
  using (
    bucket_id = 'stories'
    and (public.object_story_approved(name)
         or (storage.foldername(name))[1] = auth.uid()::text
         or public.is_moderator())
  );
create policy storage_stories_write on storage.objects for insert
  with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_stories_delete on storage.objects for delete
  using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------ feed view: carry the new fields
create or replace view public.public_videos as
select v.id, v.creator_id, v.caption, v.storage_provider, v.storage_path,
       v.thumbnail_path, v.duration_seconds, v.view_count, v.like_count, v.comment_count,
       v.published_at, v.created_at,
       v.filter, v.poll, v.duet_of, v.reply_comment_id, v.reply_video_id,
       p.username, p.display_name, p.avatar_url, p.verified
from public.videos v
join public.profiles p on p.id = v.creator_id
where v.moderation_status = 'approved'
  and v.visibility = 'public'
  and p.is_suspended = false
  and (p.private_account = false
       or v.creator_id = auth.uid()
       or exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = v.creator_id));

grant select on public.comment_likes, public.poll_votes, public.stories, public.story_views
  to authenticated;
