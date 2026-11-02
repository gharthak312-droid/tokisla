# Tokisla

Islamic-friendly short-video social media app for Android — full-screen vertical feed, max **20-second** videos, deep emerald + white + subtle gold branding, human-moderated publishing (no video goes public unapproved), 20 content categories.

**Stack:** Flutter (Android) + Supabase (Postgres, Auth, Storage, Edge Functions) + separate admin web dashboard. Free-tier first; video provider is abstracted so storage can move (e.g. Cloudflare R2/Stream) when the app grows.

**Status:** Stage 1 — architecture + setup. See `docs/ARCHITECTURE.md`. Backend connections (Supabase project, GitHub, Play Console) are done at handover time from the owner's accounts; the app runs in a clearly-labelled demo mode until `lib/config.dart` is filled.

**Rules baked in:** no service-role key in the app, RLS on every table, 20s limit enforced in the app AND in the database (check constraint + edge-function metadata verification), no fake data in the public feed, no built-in music library (platform policy).
