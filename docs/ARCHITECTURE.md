# Tokisla — Architecture (Stage 1)

## Environment inspection (2026-10-28, this build machine)
- Node 24, Git 2.43, Temurin JDK 17.0.21, Android SDK platforms 34/35 + build-tools — all present (Android release builds proven here with the Chigaroo game APK).
- Flutter SDK: installed for this project (stable channel).
- No GitHub repo and no Supabase project are connected on this account — by the owner's standing model, account connections happen on his second account at handover. Everything is therefore built **dual-mode**: a clearly-labelled demo mode (local sample data, fully testable flows) and a live mode activated only by filling `config.js` (Supabase URL + anon key). Nothing is ever faked as "connected".

## Selected stack — OWNER DECISION 2026-10-28: GitHub + Supabase only, NO Flutter
- **Vanilla HTML/CSS/JS mobile web app (PWA)** — the owner's standing stack, exactly like his other four projects: no build tools, no framework. Files go on GitHub (Pages) as-is; the phone experience is an installable PWA (manifest + service worker, full-screen, home-screen icon).
- **Play Store path:** the same web code is wrapped with **Capacitor** (instructions + a GitHub Actions build in the handover package) to produce the Android app — the owner never installs a native toolchain.
- Honest trade-off (told to the owner): a web feed is close to, but not quite, native-app smoothness; in return the whole project stays inside his GitHub + Supabase-only rule and everything remains editable without special tools.
- Demo/live duality (his house pattern): empty `config.js` keys = clearly-labelled DEMO mode with local sample data so every flow is testable; filled keys = live Supabase mode.
- **Supabase** — Postgres + Auth (email/password) + Storage + Edge Functions; RLS everywhere; service-role key only inside Edge Functions, never in the app.
- **Admin dashboard** — separate static web app (same pattern as the owner's other projects) talking to Supabase with an admin-role check server-side (profiles.role = 'admin' + RLS), never a client-side flag alone.

## Video approach (honest free-tier engineering)
- Upload flow: app validates duration (≤ 20.0s) and size (config cap, default 15 MB) → requests a **signed upload URL** from an Edge Function → uploads to the `videos` bucket → Edge Function verifies metadata server-side (duration/size from the stored object + client probe; strict server-side media probing is a documented upgrade step) → row created with `moderation_status='pending'`.
- The database enforces the rules too: `videos.duration_seconds` has a CHECK constraint `<= 20.5`, and the public feed view only exposes `moderation_status='approved'` + `visibility='public'`.
- Playback: progressive MP4 (H.264) over HTTPS from Supabase Storage public URLs for approved videos only; feed preloads ±1 video, paginates by cursor, disposes controllers.
- **Limits (stated plainly):** Supabase free tier = 1 GB storage, 5 GB egress/month. At ~3–8 MB per 20s video that is roughly 150–300 stored videos and only a few thousand full views/month. This is an MVP/test scale, NOT a growth scale.
- **Growth path (designed-in):** all video access goes through a small provider layer in `app.js` + a `videos.storage_provider` column, so moving files to Cloudflare R2 (10 GB free, zero egress fees) or Cloudflare Stream/Mux later changes configuration, not the app.

## Moderation (v1 — no fake AI claims)
- Default: **every video is `pending` until a human admin approves it.** Nothing auto-publishes.
- Automated assists (honest scope): caption/hashtag blocklist filter, file-type/duration verification, user reports, repeat-offender flags in the admin queue.
- Audio/music: there is **no in-app music library** and no music upload track by design (platform policy). Automated music detection is imperfect and paid APIs are out of the zero budget — flagged videos and user reports go to the human queue, where the admin listens before approving. AI audio classification is a documented future integration, never claimed as working now.

## Data model (Stage 3 implements this)
profiles, categories (seeded 20, admin-editable), videos, video_categories, follows, video_likes, comments, saved_videos, notifications, reports, blocked_users, moderation_reviews, moderation_events, user_preferences — UUID PKs, FKs, unique constraints against duplicate likes/follows, timestamps, indexes on feed queries, RLS on every table.

## Stages
1. Repo + architecture + Flutter setup (this document).
2. Design system: emerald/white/gold theme, logo + launcher icon + splash, reusable components, all main screens.
3. Supabase migrations + RLS + seed categories; RLS verified with unauthorized-access tests.
4. App core: auth, onboarding + category pick, For You/Following feeds, upload (20s), likes, comments, follows, saves, search/discover, notifications, profiles, reports/blocks.
5. Video pipeline hardening: signed uploads, thumbnails, metadata verification edge function.
6. Moderation queue + admin dashboard (approve/reject with reasons, appeals, category manager, user actions, audit log).
7. QA: flow tests incl. >20s rejection, rejected-video exclusion, RLS probes; demo-mode end-to-end test.
8. Release prep: release APK/AAB build here, Play Store listing pack, SETUP_GUIDE.md + MESSAGE_FOR_SECOND_ACCOUNT.md handover package.
