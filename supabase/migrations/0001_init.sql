-- Tokisla — initial schema (Stage 3)
-- Rules enforced HERE, not only in the app:
--   * videos.duration_seconds can never exceed 20.5 (CHECK constraint)
--   * a video is public only when moderation_status = 'approved'
--   * ordinary users can never set moderation_status themselves (trigger)
--   * duplicate likes/follows/saves are impossible (composite PKs)
--   * RLS is enabled on every table; the service-role key is never in the app.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'moderator'), false)
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- profile is created by an Edge Function / trigger on signup (service role).
-- Users may edit their own text fields but NEVER their role or suspension:
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.is_suspended := old.is_suspended;
  end if;
  return new;
end; $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------- categories
create table public.categories (
  id int generated always as identity primary key,
  name text not null,
  slug text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.categories (name, slug, sort_order) values
  ('Islamic Knowledge', 'islamic-knowledge', 1),
  ('Quran and Recitation', 'quran-recitation', 2),
  ('Hadith and Sunnah', 'hadith-sunnah', 3),
  ('Duas and Daily Reminders', 'duas-reminders', 4),
  ('Islamic History and Seerah', 'islamic-history-seerah', 5),
  ('Islamic Motivation', 'islamic-motivation', 6),
  ('Halal Funny Videos', 'halal-funny', 7),
  ('Clean Comedy', 'clean-comedy', 8),
  ('Educational Videos', 'educational', 9),
  ('Science and General Knowledge', 'science-gk', 10),
  ('Life Lessons and Sabaq', 'life-lessons', 11),
  ('Motivational Stories', 'motivational-stories', 12),
  ('Personal Development', 'personal-development', 13),
  ('Good Manners and Character', 'manners-character', 14),
  ('Family and Society', 'family-society', 15),
  ('Positive Entertainment', 'positive-entertainment', 16),
  ('Language Learning', 'language-learning', 17),
  ('Technology and Digital Skills', 'technology-skills', 18),
  ('Halal Business and Entrepreneurship', 'halal-business', 19),
  ('Health and Positive Lifestyle', 'health-lifestyle', 20);

-- ---------------------------------------------------------------- videos
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 300),
  storage_provider text not null default 'supabase',
  storage_path text not null,
  thumbnail_path text,
  duration_seconds numeric(6,2) not null check (duration_seconds > 0 and duration_seconds <= 20.5),
  size_bytes bigint check (size_bytes is null or size_bytes <= 26214400), -- 25 MB hard ceiling; app cap is stricter (config)
  visibility text not null default 'public' check (visibility in ('public', 'followers', 'private')),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected', 'needs_review')),
  rejection_reason text,
  published_at timestamptz,
  like_count int not null default 0,
  comment_count int not null default 0,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index videos_feed_idx on public.videos (moderation_status, visibility, created_at desc);
create index videos_creator_idx on public.videos (creator_id, created_at desc);
create trigger videos_touch before update on public.videos
  for each row execute function public.touch_updated_at();

-- Only moderators/admins may change moderation fields:
create or replace function public.guard_video_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
create trigger videos_guard_mod before update on public.videos
  for each row execute function public.guard_video_moderation();

create table public.video_categories (
  video_id uuid not null references public.videos(id) on delete cascade,
  category_id int not null references public.categories(id) on delete cascade,
  primary key (video_id, category_id)
);

-- ---------------------------------------------------------------- social graph
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table public.video_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_video_idx on public.comments (video_id, created_at);
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

create table public.saved_videos (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('follow', 'like', 'comment', 'moderation', 'system', 'share', 'mention')),
  actor_id uuid references public.profiles(id) on delete set null,
  video_id uuid references public.videos(id) on delete set null,
  comment_id uuid references public.comments(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- moderation
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('video', 'comment', 'user')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at);

create table public.moderation_reviews (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  reviewer_id uuid references public.profiles(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected', 'needs_review')),
  reason text,
  created_at timestamptz not null default now()
);

create table public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  category_ids int[] not null default '{}',
  notify_likes boolean not null default true,
  notify_comments boolean not null default true,
  notify_follows boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger prefs_touch before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- counters
create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set like_count = like_count + 1 where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update public.videos set like_count = greatest(like_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
create trigger likes_bump after insert or delete on public.video_likes
  for each row execute function public.bump_like_count();

create or replace function public.bump_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set comment_count = comment_count + 1 where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update public.videos set comment_count = greatest(comment_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
create trigger comments_bump after insert or delete on public.comments
  for each row execute function public.bump_comment_count();

-- ---------------------------------------------------------------- public views
-- The ONLY video surface the app reads for feeds: approved + public + creator not suspended.
create or replace view public.public_videos as
select v.id, v.creator_id, v.caption, v.storage_provider, v.storage_path,
       v.thumbnail_path, v.duration_seconds, v.like_count, v.comment_count,
       v.published_at, v.created_at,
       p.username, p.display_name, p.avatar_url
from public.videos v
join public.profiles p on p.id = v.creator_id
where v.moderation_status = 'approved'
  and v.visibility = 'public'
  and p.is_suspended = false;

create or replace view public.public_profiles as
select id, username, display_name, bio, avatar_url, created_at
from public.profiles where is_suspended = false;

-- View counting (called by the app when a video becomes the active slide)
create or replace function public.increment_video_view(p_video_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.videos set view_count = view_count + 1
  where id = p_video_id and moderation_status = 'approved';
$$;


-- ------------------------------------------------------- settings & history
-- Added with the Settings & privacy build-out (private accounts, Allow
-- permissions, watch history + account history for the Activity center).
alter table public.profiles add column if not exists private_account boolean not null default false;
alter table public.user_preferences add column if not exists allow_comment text not null default 'everyone';
alter table public.user_preferences add column if not exists allow_mention text not null default 'everyone';
alter table public.user_preferences add column if not exists allow_like text not null default 'everyone';
alter table public.user_preferences add column if not exists allow_download text not null default 'everyone';
alter table public.user_preferences add column if not exists view_follow_list text not null default 'everyone';

create table if not exists public.watch_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  watched_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create table if not exists public.account_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- The public surface, final form: adds view_count and the private-account
-- rule (a private creator's videos are visible only to the creator and
-- their followers).
create or replace view public.public_videos as
select v.id, v.creator_id, v.caption, v.storage_provider, v.storage_path,
       v.thumbnail_path, v.duration_seconds, v.view_count, v.like_count, v.comment_count,
       v.published_at, v.created_at,
       p.username, p.display_name, p.avatar_url
from public.videos v
join public.profiles p on p.id = v.creator_id
where v.moderation_status = 'approved'
  and v.visibility = 'public'
  and p.is_suspended = false
  and (p.private_account = false
       or v.creator_id = auth.uid()
       or exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = v.creator_id));

alter table public.profiles add column if not exists website text not null default '';
create or replace view public.public_profiles as
select id, username, display_name, bio, avatar_url, website, created_at
from public.profiles where is_suspended = false;

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null default '',
  category text not null default 'Creator',
  note text not null default '',
  payment_method text not null default 'JazzCash',
  payment_tid text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at);
