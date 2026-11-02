# Tokisla — Setup Guide (connection phase)

Tokisla is **complete and demo-tested**. This guide is only for connecting it to the owner's real accounts. Do not rebuild or redesign anything — follow the steps.

**Stack:** vanilla HTML/CSS/JS (PWA) + Supabase. No build tools, no Flutter. Files: `index.html` (user app), `admin.html` (moderation dashboard), `app.js`, `store.js`, `config.js`, `styles.css`, `supabase/` (migrations + edge functions).

## Step 1 — GitHub
1. Create a new **private** repository named `tokisla`.
2. Upload all files from this package (keep the folder structure).
3. Settings → Pages → deploy from `main` branch, root folder. The app and admin panel are then live at `https://<user>.github.io/tokisla/` and `.../admin.html`.
   (Or host the same files on any static host — nothing is GitHub-specific.)

## Step 2 — Supabase project
1. Create a free Supabase project (note the project URL + anon key + service-role key; the service-role key goes ONLY into Edge Function secrets, never into any file here).
2. SQL Editor → run, in order: `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_rls.sql`, then `supabase/migrations/0003_features.sql` (video filters, drafts, duets, video replies to comments, polls, comment likes + pinning, stories).
   - First live run: if a statement errors, fix only that statement and re-run the rest — the schema is plain Postgres; do not redesign tables.
3. Storage: the migrations already create the private buckets `videos`, `thumbnails`, `avatars` (0002) and `stories` (0003) with their policies.
4. Auth → Providers → Email: enable email/password. For the owner's testing, "Confirm email" may be turned OFF temporarily; turn it ON before public launch.

## Step 3 — Edge Functions
Deploy both functions (Supabase CLI or dashboard):
- `supabase/functions/create-upload` — mints signed upload URLs, re-checks the 20-second rule server-side, creates every video as `pending`. It also validates the optional feature fields (filter, poll, duet source, video-reply target) and accepts `is_draft` (drafts are owner-only until the owner publishes them, which the app does through the `publish_draft` RPC from migration 0003).
- `supabase/functions/delete-account` — in-app account deletion (Play Store requirement).
Both automatically receive `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from the platform environment.

## Step 4 — Make the owner an admin
1. Open the app, sign up with the owner's email (this creates the profile).
2. In Supabase SQL Editor run (replace the email):
   `update public.profiles set role='admin' where id = (select id from auth.users where email = 'OWNER_EMAIL');`
3. Sign in at `admin.html` with that account. Admin powers come from this database role + RLS — there is no hardcoded password in live mode. (The `admin@tokisla.app / admin123` account exists ONLY in demo mode.)

## Step 5 — Connect the app
Edit `config.js` — set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (anon key only). Commit. The DEMO badge disappears and the app is live.

## Step 6 — Live test checklist (do all of these)
1. Sign up a test user → pick categories → feed loads.
2. Upload a 10s video → it must appear in `admin.html` queue, NOT in the feed.
3. Approve it in admin → it appears in the feed; reject another with a reason → creator sees the reason under "My videos".
4. Try uploading a 25s video → refused by the app AND by the edge function.
5. Second test user: like, comment, follow, save, report — check the admin Reports tab and the creator's notifications.
6. RLS probe: as a normal user, confirm you cannot see pending/rejected videos and cannot change your own `role` in `profiles`.
7. Direct messages: user A messages user B from B's profile → the conversation appears in B's Alerts → Messages with an unread count; opening it clears the count.
8. Blue tick: a user applies from Settings and privacy → "Apply for blue tick" (Rs 300/month, JazzCash/Easypaisa TID) → the application appears in the admin Users tab → Approve → the blue tick shows next to their name.

## Step 7 — Play Store (Android app from the same code)
The web code is wrapped with **Capacitor** (no rewrite):
1. `npm i @capacitor/core @capacitor/cli` in a copy of the project, `npx cap init Tokisla com.chairmanwadood.tokisla`, point `webDir` at the project files, `npx cap add android`.
2. Build the AAB in Android Studio or via GitHub Actions (JDK 17 + Android SDK — the same pattern as the Chigaroo workflow).
3. Release signing keystore: create ONCE, the owner keeps the file + passwords forever (losing it = losing the app listing).
4. Play Console: listing, content rating (social app), Data Safety (email, user videos, comments collected; moderation described), target audience, account-deletion URL pointing to the in-app deletion (Settings → Delete my account) — Google requires the deletion path to exist.
5. Test on a closed track first.

## Honest limits (read before launch)
- **Supabase free tier:** 1 GB storage, ~5 GB egress/month. At 3–8 MB per video that is a few hundred stored videos and a few thousand views/month — MVP/testing scale only. The schema has `videos.storage_provider` and the app reads paths through one layer, so moving files to Cloudflare R2 (10 GB free, no egress fees) later is a configuration change, not a rewrite.
- **Moderation v1 is human review** (this dashboard). There is no automatic music detection — admins listen before approving. Automated audio classification is imperfect even when paid; do not promise it to users.
- **Server-side probing:** upload duration/size are client-probed, re-checked in `create-upload`, and capped by database constraints. For public launch at scale, add a probing worker (ffprobe) that verifies stored files and auto-flags mismatches into `moderation_events`.
- Free Supabase projects pause after ~7 days of inactivity; add a keep-awake ping (same GitHub Actions pattern as the owner's other projects) if the app sits idle.
