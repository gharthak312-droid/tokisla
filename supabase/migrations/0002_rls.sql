-- Tokisla — Row Level Security (Stage 3)
-- Principle: default deny. Every table has RLS on; each policy below is the
-- ONLY way in. Moderation powers come from profiles.role via is_moderator()
-- (checked server-side in the database), never from a client-side flag.

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.videos enable row level security;
alter table public.video_categories enable row level security;
alter table public.follows enable row level security;
alter table public.video_likes enable row level security;
alter table public.comments enable row level security;
alter table public.saved_videos enable row level security;
alter table public.blocked_users enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_reviews enable row level security;
alter table public.moderation_events enable row level security;
alter table public.admin_actions enable row level security;
alter table public.user_preferences enable row level security;

-- profiles: read own full row + moderators read all; the app reads other
-- users through the public_profiles view (no email/role exposure).
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_moderator());
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- (inserts happen via the signup Edge Function with the service role.)

-- categories: everyone reads active ones; only admins write.
create policy categories_select on public.categories for select
  using (is_active or public.is_admin());
create policy categories_admin_write on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

-- videos: public sees approved+public; creators see all of their own;
-- moderators see everything. Inserts must be own + pending. Updates by the
-- creator cannot touch moderation fields (guard trigger enforces it too).
create policy videos_select on public.videos for select
  using (
    (moderation_status = 'approved' and visibility = 'public')
    or creator_id = auth.uid()
    or public.is_moderator()
  );
create policy videos_insert on public.videos for insert
  with check (creator_id = auth.uid() and moderation_status = 'pending');
create policy videos_update on public.videos for update
  using (creator_id = auth.uid() or public.is_moderator())
  with check (creator_id = auth.uid() or public.is_moderator());
create policy videos_delete on public.videos for delete
  using (creator_id = auth.uid() or public.is_moderator());

create policy video_categories_select on public.video_categories for select
  using (exists (select 1 from public.videos v where v.id = video_id
                 and (v.moderation_status = 'approved' or v.creator_id = auth.uid()
                      or public.is_moderator())));
create policy video_categories_write on public.video_categories for all
  using (exists (select 1 from public.videos v where v.id = video_id and v.creator_id = auth.uid()))
  with check (exists (select 1 from public.videos v where v.id = video_id and v.creator_id = auth.uid()));

-- follows / likes / saves / blocks: strictly own rows.
create policy follows_all on public.follows for all
  using (follower_id = auth.uid()) with check (follower_id = auth.uid());
create policy follows_read_counts on public.follows for select
  using (true); -- follower/following lists are public counts on profiles

create policy likes_all on public.video_likes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy likes_read on public.video_likes for select using (true);

create policy saves_all on public.saved_videos for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy blocks_all on public.blocked_users for all
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- comments: visible ones are public; users write/delete only their own;
-- moderators may hide/remove.
create policy comments_select on public.comments for select
  using (moderation_status = 'visible' or user_id = auth.uid() or public.is_moderator());
create policy comments_insert on public.comments for insert
  with check (user_id = auth.uid() and moderation_status = 'visible');
create policy comments_update on public.comments for update
  using (user_id = auth.uid() or public.is_moderator())
  with check (user_id = auth.uid() or public.is_moderator());
create policy comments_delete on public.comments for delete
  using (user_id = auth.uid() or public.is_moderator());

-- notifications: read/update own only. Inserts are made by triggers/Edge
-- Functions using the service role (no user insert policy on purpose).
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete
  using (user_id = auth.uid());

-- reports: users file and see their own; moderators manage the queue.
create policy reports_insert on public.reports for insert
  with check (reporter_id = auth.uid());
create policy reports_select on public.reports for select
  using (reporter_id = auth.uid() or public.is_moderator());
create policy reports_update on public.reports for update
  using (public.is_moderator()) with check (public.is_moderator());

-- moderation internals: moderators/admins only.
create policy mod_reviews_all on public.moderation_reviews for all
  using (public.is_moderator()) with check (public.is_moderator());
create policy mod_events_all on public.moderation_events for all
  using (public.is_moderator()) with check (public.is_moderator());
create policy admin_actions_all on public.admin_actions for all
  using (public.is_admin()) with check (public.is_admin());

-- preferences: own row only.
create policy prefs_all on public.user_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Views are readable by everyone (they already filter to public data).
grant select on public.public_videos, public.public_profiles to anon, authenticated;

-- ---------------------------------------------------------------- storage
-- Buckets are private. Uploads go through signed URLs minted by the
-- `create-upload` Edge Function (service role), so there is deliberately
-- NO direct insert policy for users on the videos bucket. Reads of a video
-- object are allowed only when its video row is approved (or it is yours).
insert into storage.buckets (id, name, public) values
  ('videos', 'videos', false),
  ('avatars', 'avatars', false),
  ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;

create or replace function public.object_video_approved(obj_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos
    where storage_path = obj_name and moderation_status = 'approved'
  )
$$;

create policy storage_videos_read on storage.objects for select
  using (
    bucket_id in ('videos', 'thumbnails')
    and (public.object_video_approved(name)
         or exists (select 1 from public.videos v
                    where v.storage_path = name and v.creator_id = auth.uid())
         or public.is_moderator())
  );
create policy storage_avatars_read on storage.objects for select
  using (bucket_id = 'avatars');
create policy storage_avatars_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_avatars_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- watch history + account events: strictly private to the owner.
alter table public.watch_history enable row level security;
alter table public.account_events enable row level security;
create policy watch_history_own on public.watch_history for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy account_events_select on public.account_events for select
  using (user_id = auth.uid());
create policy account_events_insert on public.account_events for insert
  with check (user_id = auth.uid());

alter table public.verification_requests enable row level security;
create policy verify_insert on public.verification_requests for insert
  with check (user_id = auth.uid() and status = 'pending');
create policy verify_select on public.verification_requests for select
  using (user_id = auth.uid() or public.is_moderator());
create policy verify_update on public.verification_requests for update
  using (public.is_moderator()) with check (public.is_moderator());

alter table public.messages enable row level security;
create policy messages_insert on public.messages for insert
  with check (sender_id = auth.uid());
create policy messages_select on public.messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy messages_update on public.messages for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
