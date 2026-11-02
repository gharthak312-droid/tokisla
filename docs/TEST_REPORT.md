# Tokisla — Test Report (2026-10-28, demo mode)

All tests run locally against the exact shipped files. Live Supabase mode is implemented against the shipped migrations but is first exercised at connection time (SETUP_GUIDE Step 6 checklist).

## Store functional tests — `tests/store.test.mjs` — 53/53 passed
- 20 categories seeded; public feed contains ONLY approved+public videos.
- Auth: username rules, duplicates (username/email) rejected, wrong password rejected, session handling.
- Preferences round-trip; follow/unfollow + self-follow refused; following-feed filtering.
- Likes: toggle on/off, counts exact, no duplicates; saves round-trip.
- Comments: add/list/delete-own; deleting another user's comment refused.
- Upload gate: 25s video refused by the store; valid upload lands `pending`; pending video absent from feed, present in My Videos and admin queue; approve → appears in feed; reject with reason → stays out, reason visible to creator.
- Reports reach the admin queue; blocking a creator hides their videos from the feed; notifications generated for creator (like/comment/follow/moderation).
- Admin helpers: demo admin seeded (demo only), user suspend/restore, decisions log, category add/toggle (21st category), queue seeded with 2 waiting submissions.

## App smoke tests — `tests/app.smoke.mjs` (jsdom) — 17/17 passed
- Boot shows demo badge + auth; signup → onboarding (20 chips) → app shell.
- Feed renders 6 demo slides with playable video elements, usernames, category chips.
- Like toggles; comments sheet opens and a posted comment appears.
- Create view: 20 category options; Publish disabled until file + policy confirmation; My Videos renders.
- Profile renders with stats.

## Admin smoke tests — `tests/admin.smoke.mjs` (jsdom) — 15/15 passed
- Login gate; unknown/non-admin account refused with error; demo admin signs in.
- Dashboard stat cards; queue shows both seeded submissions with player + metadata.
- Approve removes the item from the queue and writes the decisions log; reject (reason "Contains music") clears the queue and shows the empty state.
- Categories tab lists 20; Users tab lists accounts.

## Static/structural checks
- `node --check` clean for app.js and store.js.
- SQL migrations are plain Postgres (no local Postgres in this environment — first live execution happens in SETUP_GUIDE Step 2, with the fix-forward note there).
- 8 demo video clips generated locally (ffmpeg), silent, durations 8–18s, matching the seeded rows; thumbnails extracted per clip.

## Not tested (by design, belongs to the connection phase)
- Real Supabase project (auth email flows, storage signed uploads, edge functions) — Step 6 checklist.
- Real-device playback/performance and the Capacitor/Play Store build — Step 7.

## Addendum — 2026-10-28 (owner feedback round)
Owner asked for three changes after trying the demo:
1. **Guest-first opening** — the app now opens straight into the video feed (TikTok-style). No account wall first. Login is asked only when the visitor taps Like/Comment/Save/Create/Alerts, opens the Following tab, or chooses Log in on the guest Profile page. Logging out / deleting an account returns to the guest feed, not the login screen.
2. **Mobile portrait preview** — on phones the app is full-screen as before; on a desktop/tablet browser the same app now presents inside a centered 412px portrait phone frame so the preview always looks like the mobile app people will actually use.
3. **Professional icons** — every emoji icon was replaced with an original SVG icon set (home, compass, search, bell, profile, + create, heart, comment, share, bookmark, more, verified badge, settings and menu icons) drawn in the same clean style as major short-video apps. The demo seed caption and the admin queue were cleaned of emojis too.
Re-tested the same day: store 53/53, app smoke 22/22 (new guest-first + SVG + no-emoji assertions), admin smoke 15/15 — **90 automated checks passed**. The regenerated single-file demos were re-verified in jsdom (guest feed first, 6 slides, embedded video data URIs, 5 SVG nav icons, 5 SVG rail icons, zero emoji in UI text).

## Addendum — 2026-10-28 (owner videos + test APK v1.1)
- Owner sent 10 of his own videos and asked for them in the app, keeping the existing demo set (20 videos total). All 10 were normalized to the Tokisla rule/format: max 20s (one 20.7s clip trimmed to exactly 20.0s), max 540px wide, H.264/AAC, faststart; thumbnails generated. They live in `assets/user/` and are seeded as approved videos of a new verified creator @chairman.wadood. Two extra generated clips (demo-9/10) bring the catalogue to **20 videos: 18 in the For You feed + 2 waiting in the admin moderation queue**. Several owner clips appear to be reposted third-party/TikTok-watermarked material and may contain music; they are included in this private phone-test build at the owner's direction — the public launch still applies the no-music / own-content moderation rule.
- Test suites re-run after the seed change: store 53/53, app smoke 22/22, admin smoke 15/15 (**90 passed**, feed-count assertions updated 6 → 18).
- **Tokisla test APK v1.1** (WebView shell, `com.chairmanwadood.tokisla`, versionCode 2 / versionName 1.1, portrait, minSdk 24) built at ~/workspace/tokisla.apk (10,527,007 bytes) and fully verified locally: apksigner v2+v3 OK, zipalign OK, zip integrity OK, all 10 owner videos + classes.dex + web app inside. The first 285 KB test APK was reported by the owner as showing the same "problem parsing the package" error seen earlier with Chigaroo; that build also verified clean here, so the working cause remains a truncated/interrupted download on the owner's connection (the Chigaroo saga resolved exactly this way: smaller file + fresh direct link installed). Delivery therefore uses a fresh direct link plus clear download instructions.

## Addendum — 2026-10-28 (owner change batch 2)
Owner's in-app review produced five changes (all applied; APK to be rebuilt only when he says "apk bhejo", per his workflow):
1. **Login popup close button** — an ✕ at the top corner of the login/signup card returns straight to the guest feed.
2. **Step-by-step Back** — Android/browser Back now closes an open sheet first, then returns from any tab to the video feed, and only exits the app from the feed (single-sentinel history pattern in the web app; the WebView shell already maps Back to web history).
3. **Likes on the profile, TikTok-style** — profile stats gained a **Likes** total (likes received), the profile grid gained a **Liked tab** (videos you liked), and demo seed data now carries starter likes so counts are alive and keep growing with real likes.
4. **Views instead of seconds** — profile grid badges now show a play icon + **view count** (e.g. 1.2k) instead of duration; views are counted once per session when a slide becomes active (demo store + a `view_count` column and `increment_video_view` SQL function for live mode).
5. **Share sheet, TikTok-style** — Share opens a sheet with a **Send to friends** row (tap a friend → they get a notification), **Download video** (in the APK this saves to Downloads/Tokisla via a native bridge added to MainActivity; browsers use a normal download), **Copy link**, and **More apps** (system share sheet). SQL notifications type check gained 'share'.
6. **Signup goes straight to the profile** — the categories/onboarding screen no longer appears after creating an account (TikTok-style landing on your new profile).
7. **Save button fills gold** — a saved video's bookmark bubble now fills fully gold instead of just tinting the glyph.
Tests after the batch: store 59/59, app smoke 35/35, admin smoke 15/15 — **109 automated checks passed**. (One feed assertion was updated: with starter likes, For You now ranks by likes, so the first slide is the most-liked video rather than a fixed one.)


### Change batch 3 addendum — TikTok rail + logo + Locked + Settings gear (2026-10-28)
- Rail icons restyled TikTok-fashion: filled comment bubble with three dots, bold
  curved share arrow, solid bookmark; SAVE moved above SHARE in the rail.
- New logo (owner request): black rounded square, gold video frame, emerald play
  triangle; full lockup (mark + "tokisla." wordmark, assets/branding/logo-lockup.png)
  on the splash; launcher icon regenerated; generator kept at
  assets/branding/generate_logo.py.
- Profile: 4th tab LOCKED — the owner's private ("Only me") videos only, lock badge
  on each cell, "In review"/"Rejected" state badge; store.myPrivateVideos (demo+live).
- Settings moved to a gear button at the top-right of the own profile; the sheet is
  titled "Settings and privacy".
- Suites: store 61/61, app smoke 40/40, admin smoke 15/15 = 116 checks passed.


### Change batch 4 addendum — Settings & privacy build-out + Friends (2026-10-28)
Owner dictated a full TikTok-style Settings & privacy, all shipped together:
- Settings sheet (gear, top-right of own profile): Tokisla Studio · Analytics
  (totals, most-popular video, per-video views/likes/comments, Trending on
  Tokisla), Activity center (Watch / Comment / Search / Account history),
  Account details sheet (email, member since, status, private state),
  Share profile (copy link / system share), Display (Light/Dark theme,
  persisted; dark restyles the light surfaces, feed stays black), Language
  (English / Urdu — main chrome + RTL layout, persisted).
- Privacy: Private account toggle (public videos hidden from non-followers in
  feed/search/profiles; SQL view enforces the same rule with auth.uid()),
  Allow section — who can comment / mention you / like your videos /
  download your videos / view your follow lists (Everyone / Followers /
  No one; follow lists: Everyone / Only me), enforced in the demo store
  (comment + like guards, mention-notification suppression, download row
  gating in the share sheet, follow-list sheet gating) and at app level in
  the live store. Blocked accounts renamed + shows block date. Log out is a
  full-width button at the very bottom of the sheet.
- Followers/Following stats on profiles are tappable and open the user list
  (respecting the owner's follow-list privacy setting).
- Bottom nav gained a Friends tab next to Home (find-friends suggestions +
  videos from people you follow; guests get a login prompt).
- Terms of Service and Privacy Policy rewritten in full; Guidelines kept.
- Store gained profileStats (was referenced by the app but missing — the
  comment/download follower checks silently no-oped without it; now real),
  histories (myWatchHistory/myComments/myEvents/logEvent), creatorStats,
  trending, accountDetails, setPrivateAccount, getAllowPrefs/setAllowPref,
  followList. SQL: watch_history + account_events tables with owner-only
  RLS, profiles.private_account, user_preferences allow_* columns,
  notifications type 'mention', public_videos view gains view_count + the
  private-account rule. LS_KEY unchanged (v3): prefs/histories default in.
- Suites: store 77/77, app smoke 56/56 (run twice, stable), admin 15/15
  = 148 checks passed.


### Change batch 5 addendum — sky-blue pluses + full profile editing (2026-10-28)
- All plus marks are now sky blue (#38BDF8): the bottom-nav Create button,
  the feed rail follow badge, and the new profile-photo plus badge.
- Own profile photo carries a + badge (bottom-right of the avatar); tapping
  it opens Edit profile. A pencil EDIT icon also sits at the top-left of the
  own profile (gear stays top-right), same destination.
- Edit profile is now complete in one form: username/handle (validated
  3-24 chars, uniqueness enforced in demo store and via the DB unique index
  in live mode, friendly "taken" error), display name, bio, LINK (new
  profiles.website column; shown under the name/bio on the profile with a
  link icon, scheme-normalised), and avatar URL. Save errors (e.g. taken
  handle) toast without closing the form.
- Suites: store 81/81, app smoke 61/61, admin 15/15 = 157 checks passed.


### Change batch 6 addendum — blue tick applications + profile header (2026-10-28)
- Blue tick is now a paid subscription: Settings & privacy gained "Apply for
  blue tick — Rs 300/month". The sheet shows the price card, a form (full
  name, category, JazzCash/Easypaisa, Transaction ID, note) and an honest
  instruction to pay the admin-shared number first. Applications land as
  PENDING; the user sees an "under review" status; the admin dashboard's
  Users tab lists applications with Approve/Reject — approval switches
  profiles.verified on and notifies the user. Duplicate pending applications
  and re-applying while verified are blocked. SQL: verification_requests
  table + owner/moderator RLS. The verified badge colour changed gold -> sky
  blue everywhere.
- Profile header is TikTok-ordered now: display NAME big and bold (with the
  badge beside it), @handle small and muted underneath.
- Suites: store 86/86, app smoke 65/65, admin 15/15 = 166 checks passed.


### Change batch 7 addendum — long-press share popup (2026-10-28)
- Long-pressing a feed video (~550 ms, movement cancels, vibrates briefly)
  opens the same bottom share popup as the Share button: friends row plus
  big icon actions for Download, Copy link and More apps, each with its
  logo. The tap that follows a long press is swallowed so it cannot also
  pause the video or fire a double-tap like; context menu suppressed.
- Suites: app smoke 67/67 (2 new long-press checks), store 86/86,
  admin 15/15 = 168 checks passed.


### Change batch 8 addendum — creator name on the video (2026-10-28)
- The caption line on every feed video now shows the creator's display
  NAME (bold, with blue tick when verified) instead of the @handle;
  tapping it opens that creator's profile (the avatar already did).
  display_name was already carried by both the demo store and the
  public_videos view, so this is a template change only.
- Suites: app smoke 68/68, store 86/86, admin 15/15 = 169 checks passed.


### Change batches 9+10 addendum — bottom nav, categories, messages (2026-10-28)
- Batch 9: bottom nav is now Home / Friends / + (centre) / Alerts /
  Profile — the Discover button is gone from the bar. Discover opens from
  the Home search icon and now carries a "Discover" title with the
  Categories list on it. The category pill no longer prints on home-feed
  videos.
- Batch 10: direct messages. Alerts gains a Messages entry on top (chat
  icon + unread badge). The inbox lists everyone who messaged you and
  everyone you messaged (last message, time, unread count), plus a
  "People you follow" starter list; any profile has a Message button.
  Thread view with bubbles, sticky composer, read-marking; blocked users
  cannot message (demo guard). New accounts get a welcome message from
  @chairman.wadood in demo mode. SQL: messages table + pair index +
  sender/recipient RLS.
- Suites: store 122/122, app smoke 94/94, admin 18/18 = 234 checks passed. (Feature batch 0003 — hashtags/mentions, comment likes + pin, polls, drafts, video replies, duets, filters, watermarked downloads, stories — added 2026-10-29 on top of the earlier 184.)
  A full audit of every dictated change (batches 2-10) was re-verified
  against the code after these batches.
