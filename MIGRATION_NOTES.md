# Tokisla — Client Migration Notes (Supabase → Appwrite)

Client-side migration only. Nothing here deploys or creates anything in
Appwrite. The live setup truth is `APPWRITE_SETUP.md` + `schema.json` in
this folder — if anything in this file disagrees with those two, they win.
`docs/` keeps the historical Supabase record byte-identical; do not edit it
to say "Appwrite".

## 0. What this folder is

A copy of `tokisla-app/` (read-only source) with the live data layer
rewritten for Appwrite Cloud, excluding the old `supabase/` directory
(migrations + Deno edge functions — not shipped) and `tests/` (owned by
another worker). `functions/` in this folder is owned by the functions
worker; the client worker did not write there.

Endpoint: `https://cloud.appwrite.io/v1` · Project ID:
`6ae910e6000dad2f34b4` (public identifier, safe to embed) · Database ID:
`tokisla` · Buckets: `media`, `avatars` · Team: `admins`.

## 1. SDK version + loading choice

- **Version: Appwrite Web SDK `29.2.0`**, IIFE build
  `dist/iife/sdk.js`, vendored as `vendor/appwrite-sdk.js` (637,776 bytes,
  md5 `85d05634ff57db10a2c9a5e2eca1604b` — pristine jsDelivr download,
  unmodified; do not hand-edit it).
- **Loading: vendored local file**, plain classic `<script>` after
  `config.js`, before `store.js`, in both `index.html` and `admin.html`.
  No ESM, no bundler, no floating version. The service worker caches it
  (see §5). Verified 2026-11-03 by evaluating the downloaded build in
  Node 24: `window.Appwrite` exposes `Client`, `Account`, `TablesDB`,
  `Storage`, `Functions`, `Teams`, `Query`, `Permission`, `Role`, `ID`.
  The npm registry `appwrite@latest` metadata also resolves to `29.2.0`,
  and the current Appwrite docs (Rows / TablesDB pages, crawled
  2026-11-02/03) use the TablesDB vocabulary — 29.2.0 is the right major
  for Appwrite Cloud. The deprecated legacy `Databases` service is
  present in the build but is never used.
- **Verified SDK facts that differ from the earlier plan** (the plan's
  §3.6 said `Query.*` returns objects): in 29.2.0 `Query.*` returns
  **JSON strings** (e.g. `{"method":"equal","attribute":"creator_id",
  "values":["abc"]}`), verified by live evaluation. The store passes
  `Query.*` results verbatim into `queries` arrays and never parses or
  interpolates them. Also verified by stubbing `Client.call`:
  `listRows` object form hits `/tablesdb/{db}/tables/{table}/rows`,
  `total: true` is passed through, `createRow`/`updateRow`/`deleteRow`/
  `upsertRow` shapes, `account.create` /
  `createEmailPasswordSession` / `createRecovery` object forms,
  `deleteSession({ sessionId: "current" })` → `DELETE
  /account/sessions/current` (the `"current"` alias works at path
  level), `storage.getFileView` returns a URL string synchronously, and
  `Functions.createExecution` sends `body` exactly as given — so the
  store always sends the body as a **JSON string** and parses
  `responseBody` back. Function execution responses are therefore the
  functions worker's contract to honour: return JSON in the response
  body; an `{ error }` payload or a failed execution surfaces as a
  thrown `Error` in the store.

## 2. File-by-file changes

| File | Change |
|---|---|
| `config.js` | Rewritten, Appwrite only. Fields: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `MAX_VIDEO_SECONDS: 20`, `MAX_VIDEO_MB: 15`, `APP_NAME: "Tokisla"`. No secret key exists in this file — API keys live only as Function variables server-side. The shipped values point at the live project (see §3). |
| `store.js` | Demo factory (localStorage, seed, demo admin) **byte-identical** — only the header comment and the `CFG`/`DEMO` lines changed above it. The live factory (`makeLiveStore`, all 85 methods, same names/order/signatures) was reimplemented against Appwrite (see §4). No string `supabase` remains anywhere in the file, including comments. The file stays DOM-free and loadable in Node. |
| `app.js` | Only two spots changed: client construction (now builds an Appwrite `Client` + `Account`/`TablesDB`/`Storage`/`Functions` services bundle and passes it to `createStore`) and the forgot-password branch (now `Account.createRecovery`, see §6). Every other line is untouched. |
| `admin.html` | Only two spots changed: the SDK `<script>` tag and the same client-construction block as `app.js`. Markup, copy, and the role-mirror login gate are untouched (the gate is a UI gate only; real authority is Team `admins` — spec §3). |
| `index.html` | Only the SDK `<script>` tag changed (line 220). Markup/copy untouched. |
| `sw.js` | Cache name `tokisla-shell-v1` → `tokisla-shell-v2`; `./vendor/appwrite-sdk.js` added to the shell list; the hostname bypass is now an exact-host comparison `url.hostname === "cloud.appwrite.io"` (the worker has no access to `config.js`, so the endpoint host is compared literally). `.mp4` + non-GET bypasses unchanged; offline/demo behaviour unchanged. |
| `manifest.webmanifest` | No change. |
| `styles.css`, `assets/`, `docs/`, `README.md`, `MESSAGE_FOR_SECOND_ACCOUNT.md`, `SETUP_GUIDE.md`, `.gitignore`, `android-test-wrapper/`, empty `admin/` | Copied byte-identical. `SETUP_GUIDE.md` (the old Supabase runbook) is copied as history alongside the other historical docs; delete it only on an explicit order. `docs/` is the historical record — read `APPWRITE_SETUP.md` for the live truth. |
| `vendor/appwrite-sdk.js` | New file (see §1). |
| `MIGRATION_NOTES.md` | This file. |
| `APPWRITE_SETUP.md`, `schema.json` | Preserved byte-identical (md5-verified before and after). |

## 3. Demo / live detection

`DEMO = !CFG.APPWRITE_PROJECT_ID` in `store.js` (empty project ID =
demo mode). `app.js`/`admin.html` read `window.TokislaStore.DEMO` as
before and only build an Appwrite client when live. The shipped
`config.js` carries the real endpoint + project ID, so the shipped app
boots in live mode; clearing `APPWRITE_PROJECT_ID` restores demo mode.
Test harnesses that set their own `TOKISLA_CONFIG` (as
`tests/store.test.mjs` does) are unaffected. Note for the verifier:
smoke harnesses that evaluate the shipped `config.js` as-is will now
boot live instead of demo unless they override `TOKISLA_CONFIG` first.

## 4. How the live store works now

- **Services are injected.** `createStore(storage, backendClient)`
  accepts a services bundle `{ client?, account, tables, storage,
  functions, Query, Permission, Role, ID }` (what `app.js`/`admin.html`
  build), a raw Appwrite `Client` (services are constructed from the
  `window.Appwrite` namespace), or nothing (every call throws a clear
  "client not provided" error instead of crashing at load). When the
  SDK namespace is absent (Node test harness), minimal fallbacks
  matching the verified 29.2.0 string shapes are used for
  `Query`/`Permission`/`Role`/`ID` only.
- **TablesDB everywhere.** `listRows`/`createRow`/`updateRow`/
  `deleteRow`/`getRow`/`upsertRow` with object-form calls and explicit
  `Query.limit(...)` on every list (Appwrite defaults to 25 rows; the
  old PostgREST default was effectively 1000). Count queries use
  `listRows({ total: true, queries: [Query.limit(1), ...] })` and read
  `total`. No `Query.select` column pruning is used (column lists are
  picked in JS instead — avoids unverified `$id`-in-select semantics);
  `ttl` caching is never set. `maybeSingle` → "first row or null";
  missing-row `getRow` (404) → null in gate contexts.
- **Row normalisation at the boundary.** `$id → id`, `$createdAt →
  created_at`, `$updatedAt → updated_at`; `$permissions`/`$databaseId`/
  `$tableId`/`$sequence` dropped. The frozen UI never sees a `$id`.
- **Public videos (spec §6.2).** Base query on `videos`
  (`moderation_status = approved` + `visibility = public`, ordered by
  `published_at` desc with a client-side `$createdAt` fallback sort),
  client join to `public_profiles` (username/display_name/avatar_url/
  verified merged on), then post-filters in spec order: drop creators
  with no `public_profiles` document (suspended), private-account rule
  (viewer must follow the creator; guests see none), blocked rule.
  Feed over-fetches to 50 and slices to 30. The following feed queries
  `follows` first and returns `[]` without touching `videos` when the
  list is empty. `profileVideos(userId, me)` now honours its second
  argument (the old live code ignored it).
- **Polls.** Decomposed attributes `poll_question`/`poll_option_a`/
  `poll_option_b` are synthesised back into `v.poll = { question,
  options: [a, b] }` on every video row, so the frozen poll UI is
  unchanged. `poll_state` is computed from `poll_votes` as before.
- **Categories (spec J4).** The database join key is the category
  **slug** (`video_categories.category_id`, `user_preferences.
  category_ids`). The seed slugs in `APPWRITE_SETUP.md` §9 differ from
  the regex slugs derived from names in the shared `CATEGORIES`
  constant for 11 of 20 categories (e.g. seed `halal-funny` vs UI
  `halal-funny-videos`, seed `quran-recitation` vs UI
  `quran-and-recitation`). The live store therefore translates through
  an explicit `SPEC_CATEGORY_SLUGS` table (sort_order 1–20) in both
  directions: numeric UI ids ↔ seed slugs. `setPreferences`/
  `getPreferences` and video `category_ids` (feed + admin queue) go
  through it; admin-added categories fall back to the regex slug.
  `adminAddCategory` keeps the old regex slug generation; its document
  ID is the slug (truncated to 36 chars, the Appwrite ID cap — the
  full slug stays in the `slug` attribute).
- **Playback URLs.** `storage_path`/`thumbnail_path` holding an
  Appwrite file ID are translated to plain `storage.getFileView` URLs
  (spec §7 — no signed/expiring URLs; file permissions are the
  security). Data URLs, http(s) URLs, relative asset paths, and the
  demo placeholders pass through untouched. The raw file ID is kept
  alongside as `storage_file_id` / `thumbnail_file_id`.
- **Auth.** `signUp` = `account.create` → `createEmailPasswordSession`
  → `api` `create-profile` (never a direct profile insert; the
  function forces `role="user"` and validates the username). Returns a
  normalised `{ id, email, name }` object. `logIn` = session +
  `currentUser()` (profile row). `logOut` = `deleteSession("current")`,
  idempotent (errors swallowed). `currentUser` returns `null` on any
  failure, preserving guest-first boot.
- **Functions (`Functions.createExecution`, JSON-string bodies).**
  `api` actions used: `create-profile`, `increment-view`,
  `publish-draft`, `set-comment-pin`, `moderate-video`,
  `moderate-story`, `moderate-comment`, `decide-verification`,
  `decide-report`, `suspend-user`/`unsuspend-user`, `delete-video`,
  `notify` (fallback), `file-report` (fallback), `check-allow-prefs`.
  `create-upload` and `delete-account` are called as their own
  functions. **Parameter contract assumed by this client** (the
  functions worker must honour it — see §7): every `api` call sends
  `{ action, ...params }` with params named
  `{ username, display_name }`, `{ video_id }`, `{ comment_id, pinned }`,
  `{ video_id, decision, reason }`, `{ story_id, decision }`,
  `{ comment_id, decision }`, `{ request_id, decision }`,
  `{ report_id, status }`, `{ user_id }` (suspend/unsuspend/check),
  `{ video_id }` (delete-video), `{ user_id, type, actor_id, video_id,
  comment_id }` (notify), `{ target_type, target_id, reason }`
  (file-report). `create-upload` receives the old metadata fields
  (`caption`, `category_ids` as UI numbers, `visibility`,
  `duration_seconds`, `size_bytes`, `filter`, `poll`, `duet_of`,
  `reply_comment_id`, `is_draft`, `filename`, `content_type`) plus
  `file_id` and `thumbnail_file_id` when the store uploaded the files
  first (see §7). `delete-account` is called with body `{}`.
- **Permissions on every create** follow the spec §5 templates
  (videos: none client-side; follows/likes: `any` read + owner delete;
  saves/blocks/preferences/watch-history: owner-only; comments:
  visible template; messages: sender + recipient read, recipient
  update; notifications/reports: addressee/reporter + team grants
  with the §5.10/§5.11 fallback below; stories: owner + team;
  verification requests: applicant + team).
- **Counters are never written by the client.** Like/comment counts
  are recomputed by the `events` function; view counts go through
  `increment-view`. `recordView` stays best-effort and now uses
  query-then-update/create for `watch_history` (409 = row exists,
  update it) per spec §5.16 — no deterministic composite document IDs
  are invented (spec global rule), except `user_preferences` whose
  document ID is the user ID, and `profiles`/`public_profiles` whose
  document ID is the Auth user ID.
- **Upserts.** `user_preferences` uses `upsertRow` with the user-ID
  row ID. `watch_history`, `poll_votes`, `story_views` use
  query-then-create/update with 409 handling.
- **Bulk updates.** Appwrite has no update-by-query: `markThreadRead`
  and `markNotificationsRead` list matching rows (cap 100) and update
  each one; failures are swallowed per row, as the old bulk updates
  ignored errors.
- **Search.** `Query.search` (full-text, word-based) on `username` and
  `caption`. This is NOT the old case-insensitive substring `ilike`:
  partial-username and mid-word substring matches may no longer hit.
  Hashtag search keeps the JS exact-hashtag filter for precision;
  recall depends on the full-text index returning the row. See §7.
- **Self-guards.** `toggleFollow`, `toggleBlock`, and `sendMessage`
  reject self-targets client-side (the old database CHECKs did this;
  Appwrite has no equivalent server check).
- **Admin methods.** Moderation/suspension/verification/report
  decisions, draft publishing, comment pinning, and draft deletion all
  go through `api` actions; the client never writes `moderation_status`,
  `verified`, `is_suspended`, `role`, `published_at`, or counters.
  `adminQueue` rows now also carry the joined `username` (the UI fell
  back to `creator_id` before) and numeric `category_ids`.
- **Stories.** Uploads go to the `media` bucket first (owner + team
  file permissions), then a `stories` row is created with the file ID
  as `storage_path`. `storiesFeed` uses the 24-hour `$createdAt`
  window, profile joins, seen flags, and view URLs (no per-row signed
  URLs, no N+1 network calls). No avatar upload was added: `avatar_url`
  stays a URL/data-URL string in the profile row, exactly as before.

## 5. Known caveats (carried from the spec — verify live)

1. **Cross-user grants need live verification (spec R5 / §10 item 4).**
   Whether a client can attach another user's (or the team's) read
   permission at creation time must be tested with real accounts for
   notifications, reports, and messages. Notifications and reports
   already fall back to the `api` `notify` / `file-report` actions when
   the direct create fails; messages fall back to the `api`
   `send-message` action on a permission error (store `sendMessage`),
   so a rejected grant is retried server-side before any send error
   surfaces.
   Verification requests, comments, and stories also carry team
   grants in their templates with no fallback specified.
2. **File-permission flips happen in functions.** Approval, rejection,
   suspension, and unsuspension only take effect for playback when the
   `api` moderation/suspend actions flip the matching `media` file
   permissions in the same call (spec §7.1). A video document flipped
   client-side (residual risk R2) stays unplayable by design.
3. **Counters and public profiles are eventually consistent** (spec
   R6). `like_count`/`comment_count` arrive via the `events` function
   seconds after the write; `public_profiles` syncs on profile
   create/update/delete. The UI must tolerate brief staleness; the
   client never writes counters or public-profile fields to "fix" it.
4. **Profile tampering residual (spec R1).** A user can technically
   write `role`/`verified`/`is_suspended` on their own `profiles`
   document via a direct API call (no per-attribute permissions).
   Nothing trusts those fields (authority is Team `admins`; the sync
   never copies them into `public_profiles`), but the tampered row
   itself will look privileged to its owner/team readers.
5. **Followers-visibility videos** stay unreadable to followers
   through direct queries, faithfully mirroring the old SQL view
   (spec G4). Serving them is a new feature decision, not smuggled in
   here. Story 24-hour expiry is query-only (spec R3): expired
   approved stories remain readable by direct document ID.
6. **`avatar_url` size.** The schema caps `avatar_url` at 2048 chars,
   but the app stores shrunken data URLs there (potentially longer).
   Oversized avatars will fail the profile update server-side; no
   client workaround was added (frozen UI).

## 6. Gaps the verifier / functions worker must close

- **Live video upload end-to-end (code path closed; live run still
  pending — see the §12 checklist).** The spec's inverted
  `create-upload` flow requires the file bytes to be uploaded to the
  `media` bucket *before* the function call, and the upload UI
  (`app.js` `doSubmit`) DOES hand the store the `File` object — the
  live branch passes `file: uploadFile` plus `filename` /
  `content_type` into `submitVideo`. The store uploads the file
  first, then calls `create-upload`, which validates and creates
  the row; the store returns `{ video, upload_url: null }` (there
  is no PUT-able `upload_url` in the Appwrite contract), so the
  `upload_url` PUT guard in `doSubmit` never fires. Thumbnail data
  URLs are likewise uploaded as thumbnail files (`thumbnailFileId`
  sent) on this path. No live Appwrite run has verified this path
  yet; the first live upload must still be exercised under the
  §12 checklist — do not claim live verification until then.
- **Password recovery has no confirm screen** (pre-existing gap, plan
  §6.10). `createRecovery` links back to the app shell itself
  (`origin + pathname`, an allow-listed platform hostname). No code
  consumes the recovery `userId`/`secret` yet; building the confirm
  handler needs a separate work order touching `app.js` boot.
- **Email verification** is not gated in the client: signup throws
  the old "Check your email…" message only if session creation fails
  with a verification error. Whether verification is required at all
  is a project setting (spec §1) — confirm before launch.
- **`api` response shapes** are parsed tolerantly (nested `prefs` /
  direct fields; `decide-verification` re-fetches the request row),
  but the exact JSON the functions worker returns for each action was
  not available to this worker. The §4 parameter contract above is the
  alignment point; the verifier must run each action once against the
  real functions.
- **`Query.equal` with an array** is treated as IN/any-of (verified
  serialisation only). `$id` as a query attribute (used for IN lists
  and `people`'s `notEqual`) has a per-call fallback (individual
  `getRow` fetches) in the profile-join and duet-enrichment paths, but
  other IN lists rely on it directly — the first live run must
  exercise `feed`, `savedVideos`, `likedVideos`, and `people`.
- **List limits.** Every list carries an explicit limit (300 for
  conversations/thread, 100 for unbounded lists, the old explicit
  limits elsewhere). The current Appwrite pagination docs state no
  hard per-request limit, but large pages degrade performance; the
  100-row cap on unbounded lists (likes/saves/follows histories) is a
  deliberate trade-off to record, not a proven server cap.

## 7. Deviations from the spec / plan (spec wins where they disagreed)

- **DEMO rule:** plan §2.1/§3.1 proposed `!CFG.APPWRITE_ENDPOINT`;
  this build uses `!CFG.APPWRITE_PROJECT_ID` per the work order (empty
  project ID = demo). One rule, in `store.js` only.
- **Upsert IDs:** plan §6.5 proposed deterministic composite row IDs
  (`<userId>_<videoId>`); the spec forbids invented composite IDs and
  prescribes auto IDs + unique indexes + 409 handling. Spec followed.
- **Counters:** plan §6.6 floated client-side `incrementRowColumn`;
  the spec forbids client counter writes. Not used anywhere.
- **Upload flow:** plan §6.8 recommended "function creates the row,
  then the store uploads via Storage and returns `upload_url: null`".
  That assumed the store receives the file bytes, which the frozen UI
  does not provide (see §6). The spec's file-first flow is implemented
  when a file is supplied; otherwise the function response passes
  through. Neither half-measure was silently shipped as "working".
- **Category slugs:** the spec seed slugs and the UI regex slugs
  disagree (see §4). Resolved with the explicit translation table;
  neither side was silently "fixed".
- **Config fields:** the plan proposed extra `APPWRITE_DATABASE_ID` /
  table / bucket / function keys in `config.js`; the work order fixed
  five fields. Database/collection/bucket/function IDs are constants
  in `store.js` (the database ID is a code constant per spec §8).
- **Search:** the plan left `ilike` replacement undecided; this build
  uses `Query.search` (full-text indexes exist in the spec for
  `username` and `caption`) and records the substring-recall caveat
  above rather than inventing client-side scanning.
- **Query return shape:** the plan stated `Query.*` returns objects;
  live evaluation proves JSON strings. Code follows the evaluated
  behaviour.
- **`deleteSession("current")`:** the plan marked it unverified; the
  29.2.0 SDK sends `DELETE /account/sessions/current`, so it is used.
- **Vendored-file comment:** the work order allowed a version comment
  at the top of the vendored file; the file was left byte-pristine
  (hash in §1) and the version is recorded here and on the script-tag
  lines instead, per the plan's "do not edit the vendored file".

## 8. Verification done by this worker (no browser, no test suite)

- `node --check` clean: `store.js`, `app.js`, `config.js`, `sw.js`.
- Vendored SDK evaluated in Node: all required services present;
  `Query`/`Role`/`Permission`/`ID` string shapes, `listRows`/
  `createRow`/`updateRow`/`deleteRow`/`upsertRow`,
  `Account`/`Storage`/`Functions` call shapes verified against a
  stubbed `Client.call`.
- Mock-backed live-mode check in Node (throwaway harness, not shipped):
  demo feed still returns the 10 seeded videos; live `currentUser`,
  feed post-filters (suspended-missing / private-followed / blocked),
  view-URL translation, category slug translation, `usernameAvailable`,
  `toggleLike` (permissions + `check-allow-prefs` call), `recordView`
  (`increment-view` + watch-history upsert), `thread` (`Query.or/and`),
  `submitVideo` file-first path, preferences numeric↔slug round-trip,
  `socialCounts` totals, `search`, and `signUp` (`create-profile`) all
  passed against an in-memory mock. This proves wiring and shapes, not
  live Appwrite behaviour — the verifier's live checklist (spec §12)
  still has to run against the real project.
- `diff -rq` vs source: only `index.html`, `admin.html`, `app.js`,
  `config.js`, `store.js`, `sw.js` differ (plus the new `vendor/` file
  and this note); `styles.css`, `assets/`, `docs/`,
  `android-test-wrapper/`, historical docs, and `manifest.webmanifest`
  are byte-identical; `supabase/` and `tests/` are absent as ordered;
  the demo factory region of `store.js` is byte-identical and all 85
  live method names match the source in order.
- `APPWRITE_SETUP.md` / `schema.json` md5 unchanged.

## 9. Addendum — direct publish, no categories in the upload flow, location, sounds library (2026-11-03)

Owner orders, applied by the backend worker to `functions/`,
`schema.json`, `APPWRITE_SETUP.md`, and `tests/` only. The client
files (`index.html`, `app.js`, `store.js`, `admin.html`,
`styles.css`) were edited in parallel by a second worker and are not
described here except where the backend contract meets them. The
original notes above (§0–§8) are unchanged; if anything here
disagrees with `APPWRITE_SETUP.md` + `schema.json`, those two win.

### 9.1 Decisions

- **Live status value: `"approved"`.** New non-draft uploads are
  created with `moderation_status: "approved"` and `published_at`
  set — the exact status the existing feed query already uses
  (`moderation_status = "approved"` + `visibility = "public"`).
  No new status string was invented. `publish-draft` flips drafts
  to `"approved"` directly. `moderate-video` remains for ADMIN
  POST-moderation only (remove/hide with `rejected`, flag with
  `needs_review`, restore with `approved`); it never gates a new
  post. Stories are unchanged: they still go
  `pending` → `approved`/`rejected` via `moderate-story`.
- **No categories in the upload/post flow.** `category_ids` was
  removed from the `create-upload` contract and all category
  validation was removed from the functions. A sent `category_ids`
  value is silently ignored (not a 400). The `categories`
  collection + seed stay in `schema.json` / `APPWRITE_SETUP.md`
  for the Discover page, and `video_categories` rows are retained
  for legacy/Discover reads; `create-upload` creates no new ones
  and `delete-account` still cleans legacy rows. Nothing crashes
  when a video carries no categories.
- **`videos.location` (optional string, max 256 chars).** Free-text
  place name, trimmed, sliced to 256, null when empty/absent.
  Existing visibility/comment/duet fields were reused; nothing
  was duplicated.
- **Sounds library — built, catalog-driven.** The 2026-11-03
  ~22:41 update superseded the earlier "original audio only"
  instruction. Tabs: Sound Effects, Naat, Taqreer, Islamic (other
  Islamic audio). Original audio stays the default. No music
  anywhere, in any tab, function, or catalog entry. A NEW
  collection, `sounds`, was added (see §9.2) because the client
  implementation strictly requires structured metadata storage
  for owner-added sounds — the contingency named in the sounds
  decision. Admin-added audio files live in the existing `media`
  bucket. Demo-mode admin-added sounds persist locally,
  client-side. The per-video choice is stored on the video row
  (`sound_id` / `sound_title` / `sound_category`, opaque, not
  FK-validated). No Function writes the catalog.
- **Honest content constraint.** No naat/taqreer audio exists in
  the workspace; no copyrighted audio was bundled or invented.
  The built-in catalog is an empty array; Naat/Taqreer tabs ship
  with honest empty states until the owner adds audio he owns or
  has rights to. Sound Effects may be seeded ONLY with verified
  CC0/public-domain effects, license noted in the `sounds` row's
  `source` — no such seed is verified or recorded as of this
  addendum.
- **Template rename.** The §5.3 document-permission template
  `beforeApproval` was renamed `notLive` (same permissions, new
  name fits direct publish: it now covers drafts, rejected, and
  non-public rows, not a pre-approval state).

### 9.2 File-by-file changes

- `functions/create-upload/index.js` — header rewritten for
  direct publish; category slug/numeric resolution and the
  `video_categories` creation loop removed; `category_ids`
  ignored; `pendingVideoPermissions`/`pendingFilePermissions`
  replaced by `videoPermissions(creatorId, {publicRead})` /
  `filePermissions(...)`; non-draft rows get `"approved"` +
  `published_at`, drafts `"draft"` + null; document + file
  permissions use the live template for approved+public rows;
  `location` parsing added (trim/slice 256); sound fields added
  (`sound_id` ≤ 64, `sound_title` ≤ 80, `sound_category` one of
  the 4 slugs else null, never fails the upload, never
  FK-validated); `moderation_events` `uploaded` details include
  the status. Duration ≤ 20.5s, size ≤ 25 MiB, filter/poll/
  duet/reply handling unchanged. `node --check` clean.
- `functions/api/index.js` — `actionPublishDraft` rewritten
  (draft → `approved` + `published_at` + permissions flipped on
  the document and its files + `moderation_events` row
  `event_type: "published"`); `actionModerateVideo` annotated as
  post-moderation only (logic unchanged); view counting,
  `flipCreatorFiles`, and story statuses unchanged.
  `node --check` clean.
- `functions/events/index.js`, `functions/delete-account/index.js`
  — reviewed, no change needed (no category/sound/pending-video
  logic; `delete-account` still cleans legacy `video_categories`
  rows).
- `functions/README.md` — `publish-draft` / `moderate-video`
  action rows, `create-upload` contract table (no `category_ids`,
  `location` + sound rows added, extras-ignored row), behaviour
  paragraph, §12 reference, and disagreement #10 rewritten for
  direct publish + the sounds collection.
- `schema.json` — valid JSON; counts now **25 collections, 130
  attributes, 40 indexes** (was 24/121/39). `videos` gains
  `location` (string 256, optional), `sound_id` (string 64),
  `sound_title` (string 80), `sound_category` (enum, 4 slugs);
  `moderation_status` / `published_at` notes rewritten;
  template renamed `beforeApproval` → `notLive`. NEW collection
  `sounds` (25th): `title` string 80 required; `category` enum
  (4 slugs) required; `duration_seconds` double optional;
  `storage_path` string 512 required; `source` string 120
  optional; 1 index `category_idx` on `category`; document
  security ON; collection create `create("users")`, other
  collection permissions none; document template read
  `read("any")`, update/delete `team:admins`. `media` bucket
  holds sounds audio; extensions `mp3, m4a, wav, ogg` added;
  `soundFile` permission template added. `soundsLibrary` object,
  J13, and the G5 count note updated; residual risk R7 added.
- `APPWRITE_SETUP.md` — section numbering preserved (§7.3 added
  as a subsection; no renumbering). Updated: intro callout;
  §0/§4/§5 collection counts (25); §5.2/§5.4/§5.15
  Discover-only category notes; §5.3 `location` + `sound_*`
  rows and status/published notes; NEW §5.24 `sounds`; §6.1
  heading (ordinal dropped — `public_profiles` is no longer the
  24th collection); §6.2 feed-unchanged note; §7.1 bucket holds,
  audio extensions, file-permission table; §7.3 sounds-library
  subsection (collection-backed); §8.1 function table rows;
  §8.3 flow steps + constraint ownership (location, sound
  fields, extras ignored); §8.4 legacy note; §9 seed note; §10
  enforcement map (new location / category-removed / sounds
  rows); §11 J11/J12/J13, R2 rewrite, NEW R7, open questions
  (a)/(b)/(c); §12 checklist fully rewritten (direct publish,
  20s/size, drafts, location, post-moderation, stories still
  gated, file privacy, role tamper, grants/counters, verification/
  suspension, signup/delete/categories/sounds, budgets).
- `tests/store.test.mjs` — `category_ids` removed from all
  `submitVideo` calls; "Upload + moderation gate" rewritten as
  direct publish (upload → `approved` + in feed immediately +
  `published_at`; 20.5s accepted, 21s rejected; post-moderation
  remove/restore via `adminDecide`; location round-trip present
  and absent + over-long cap; sound fields round-trip; original
  audio = null sound fields); drafts save + publish live;
  private video asserted in own grid / out of others' grids;
  final queue assertion is empty (0) with `pending` 0; sounds
  library checks (empty catalog, non-admin add throws,
  admin add/remove with license note). Preferences/`CATEGORIES`/
  admin-categories/stories/poll/duet/reply expectations
  untouched.
- `tests/admin.smoke.mjs` — seeds rewritten (no `category_ids`;
  location + sound fields on the flagged item; one report filed);
  queue assertions now cover the post-moderation queue only
  (2 flagged items, location/sound rows shown); reject-then-
  approve flows; reports tab (mark reviewed); sounds tab honest
  empty state. Header note flags the stale-pending-queue
  assumption it replaces.
- `tests/app.smoke.mjs` — only the stale `uploadCategory`
  20-options assertion deleted; Discover categories-tab check
  (in `admin.smoke.mjs`) untouched.
- `tests/functions.contract.mjs` — NEW (plain Node, no deps):
  schema counts/attributes, `sounds` collection shape, media
  audio extensions, create-upload source contract (caps,
  `"approved"` + `published_at`, location/sound storage, no
  `pending`, no `category_ids` outside comments), api
  publish-draft/moderate-video/story statuses, zero `supabase`
  and zero functional `category_ids` in all four function files.

### 9.3 Verification (offline/static only)

- `node tests/store.test.mjs` → **140 passed, 0 failed**
  (baseline before this change: 115 passed, 7 failed — the 7
  were exactly the stale pending-queue expectations).
- `node tests/functions.contract.mjs` → **45 passed, 0 failed**.
- `node --check` clean on all four function files and all four
  test files. `schema.json` parses (`python3 -m json.tool`).
- Grep: `supabase` in `functions/*.js` = 0; `category_ids` in
  `functions/*.js` = 2 hits, both explanatory comments, zero
  functional use. `supabase` provenance wording remains in
  `APPWRITE_SETUP.md` / `schema.json` / `MIGRATION_NOTES.md` as
  historical source references, not live code.
- Smoke tests (`app.smoke.mjs`, `admin.smoke.mjs`) need `jsdom`,
  which is not installed in this tree (`tests/package.json`
  lists it, no `node_modules` present). They were run from a
  throwaway `/tmp` copy of this folder with `jsdom` installed
  there (the tree was not polluted): `app.smoke.mjs` →
  **97 passed, 0 failed**; `admin.smoke.mjs` → **23 passed,
  0 failed**. Two harness-only fixes were needed, both inside
  `tests/`: the harnesses force demo mode in memory (clearing
  the project ID between the `config.js` and `store.js` loads,
  since `config.js` now ships the real project ID), and
  `app.smoke.mjs`'s create-view assertions were updated to the
  current 4-screen create wizard (camera → edit → post, with
  `editSoundBtn` / filter chips / trim / Drafts) — the old
  `#publishBtn` / `#filterChips` / `#pollToggle` elements no
  longer exist in the client UI, and no poll builder markup
  exists in `index.html` at all.
- No Appwrite credentials exist and no live project access was
  available: function behaviour, permission flips, the `sounds`
  collection creation in Console, and the circular
  countdown-to-live render were NOT verified live. No GitHub
  pushes, deploys, console setup, or user contact happened.

### 9.4 Open questions (for the owner / coordinator)

- **(a) Discover page categories — keep or remove?** The
  `categories` collection + seed and the Discover UI stay; the
  owner has not answered whether Discover categories go too.
- **(b) Sounds content supply.** No allowed-sound library was
  asked for beyond the tabs; the owner supplies any naat/taqreer
  audio (or verified CC0 effects) himself. Tabs stay empty
  until then.
- **(c) Client extras with no backend storage.** The live store
  sends `trim_*`, `content_disclosure`, and `link_url` with
  uploads; `create-upload` ignores them (no such video
  attributes exist). If trimming, disclosure flags, or links
  become real features, they need their own schema/function
  decision.
- **(d) Location cap mismatch — coordinator reconciliation.**
  The backend (function + schema + spec) caps `location` at
  256 chars per the brief; the demo store slices it to 120.
  A 121–256-char location survives live but truncates in demo.
  Backend truth is 256; the demo cap is the client worker's.
- **(e) R7 — sound-creation role-check gap.** The live client
  performs no role check before creating a `sounds` row, and
  collection `create("users")` lets any signed-in user create a
  row via a direct API call. Admin-only creation is UI-gated
  only. Closing it needs a function-gated add-sound action or
  a collection-permission change — a separate decision.

### 9.5 Fix-up pass — catalog loader, location cap, post-screen extras, sounds streaming-only (2026-11-03)

Coordinator reconciliation of three verified findings, plus a user
rule on sounds playback (ordered 2026-11-03 ~23:13). No other
change. §9.4 (c)/(d) above are superseded by this note as recorded
here; their original text is left untouched.

- **Catalog loader.** `store.js` gains `loadSoundsCatalog` /
  `SOUNDS_CATALOG_PATH`. The ONE fixed catalog path is
  **`sounds-catalog.json`** at the app root (next to `index.html` /
  `store.js`); entries are `{id, title, category, duration_seconds,
  src, source}`. The file ships EMPTY (`[]`): no audio was
  downloaded, copied, or seeded from the staging/research
  candidates file or the web, and nothing in the loader treats
  that file as approval. `listSounds()` fetches the catalog
  lazily on first library open, merges it with the empty inline
  catalog and admin-added sounds (deduped by id), and on any
  failure/absence/malformed content falls back silently to the
  empty inline catalog, so demo mode and honest empty states
  keep working. Catalog `duration_seconds` is display metadata
  only; the 20-second video limit, direct publish, and demo mode
  are untouched. Documented in the loader comment, §7.3/§5.24
  wording in `APPWRITE_SETUP.md`, and `schema.json`
  `soundsLibrary`.
- **Location cap alignment.** Backend truth is 256. The client
  only changed: `app.js` Location input `maxlength` 120 → 256 and
  the demo store slice 120 → 256. Function/schema caps unchanged.
  `APPWRITE_SETUP.md` §12 item 4 now tests the 256 cap through
  the client (paste 300 chars; stored location is exactly 256).
- **Post-screen extras persisted live.** `trim_start_seconds`
  (double 0–20.5, default 0), `trim_end_seconds` (double 0–20.5,
  default null → duration), `content_disclosure` (boolean,
  default false, true only on exact `true`), and `link_url`
  (string 300, null when absent/empty) were added to the `videos`
  collection in `schema.json` (counts now 25 collections, **134**
  attributes, 40 indexes); `create-upload` parses, clamps
  (`trim_*` into `[0, duration]`), and stores them, matching the
  demo store's shapes exactly (demo shapes unchanged). Documented
  in `APPWRITE_SETUP.md` §5.3, §8.3, §10, and §11 (c) (closed),
  and in `functions/README.md` (contract table + behaviour).
  Tests extended in `tests/store.test.mjs` (round-trip + defaults
  + 300-char link slice) and `tests/functions.contract.mjs`
  (schema attributes + function storage).
- **Sounds streaming-only (user rule).** Audit found NO download
  affordance for sounds in the library sheet (Preview/Stop via a
  programmatic `Audio` element; Select attaches the sound to the
  video) or the feed (sound line is text only). The one native
  control that could expose a download entry — the Admin Sounds
  tab `<audio controls>` — now carries
  `controlsList="nodownload"` with a streaming-only comment; the
  library preview gained the same comment. Video watermark
  download is untouched (sounds-only rule). Live sound files
  resolve to file-view (streaming) URLs, never download URLs.
- **Verification (offline/static only).** `node --check` clean on
  all JS files touched. `node tests/store.test.mjs` → **153
  passed, 0 failed**; `node tests/functions.contract.mjs` → **55
  passed, 0 failed**. jsdom smokes run from a throwaway `/tmp`
  copy (tree not polluted): `app.smoke.mjs` → **97 passed, 0
  failed**; `admin.smoke.mjs` → **23 passed, 0 failed**; a render
  probe confirmed the admin `<audio>` carries
  `controlsList="nodownload"` with zero download affordances when
  a sound exists. `singlefile.check.mjs` was not run: its target
  file does not exist in this workspace. No live Appwrite access,
  credentials, pushes, deploys, or console setup. Sounds-collection
  permissions / R7 and the "Contains music" report strings were
  left exactly as documented (out of scope).

## 10. Addendum — user-added sounds, direct-to-library; original-sound auto-register; R7 superseded (2026-11-03)

Owner decision 2026-11-03 ~23:35 (explicit, supersedes the old R7
note everywhere it appears): users CAN add sounds,
direct-to-library, NO admin approval; violations are removed via
report + strike. Any signed-in user creating `sounds` rows is now
INTENTIONAL — this change documents that as superseded; it does
not "fix" R7 by restricting creation.

### 10.1 Decisions

- **User-added sounds, direct-live.** Any signed-in user adds a
  sound via the new `api` action `create-sound`; the row is `live`
  at once, with no approval step and no admin queue. Staff
  (Team `admins`) using the same action get `source_type`
  `"admin"`; plain users get `"user"`. The server decides
  `creator_id`, `source_type`, `status`, and `report_count`;
  caller-sent values for those fields are ignored.
- **R7 superseded, not closed by restriction.** The old R7 note
  (signed-in creation of `sounds` rows as a residual risk, to be
  closed by a function gate or permission change) is superseded
  by the owner decision quoted above. It is marked SUPERSEDED in
  `schema.json` (collection notes, `residualRisks` R7, judgment
  J14), in `APPWRITE_SETUP.md` (§5.24, §7.3, §8.1, §11 R7,
  §12), and in the `api` function header comment. The collection
  `create("users")` grant is unchanged, so a direct client create
  remains possible; such rows lack the function-set fields and
  are treated as user-added.
- **Removal is post-moderation, status-only.** `report-sound`
  (signed-in) files a `reports` row (`target_type` `"sound"`)
  and best-effort increments `report_count`; the sound stays
  visible (no auto-hide). Staff `remove-sound` flips `status` to
  `"removed"` and best-effort writes an `admin_actions` row. The
  row and its audio file are NEVER deleted by removal (audit
  trail + stable references); the file is deleted separately by
  hand if it must go too.
- **Original-sound model.** A live video posted with no library
  sound chosen gets a `sounds` row automatically from
  `create-upload`: category `"original"`, `source_type`
  `"original"`, `video_id` = the video `$id`, `storage_path` =
  the video's file `$id`, title `Original sound — @<username>`
  (fallback `Original sound`), `source` `Original sound from
  video`, `status` `live`. Category `"original"` is function-only:
  `create-sound` rejects it, and client add-sound forms must not
  offer it. Drafts are skipped; videos posted WITH a chosen sound
  get no original row.
- **Dedupe by lookup, not by unique index.** `create-upload`
  queries `sounds` by `video_id` first and skips when a row
  exists. `video_id` carries a key index (`video_id_idx`),
  deliberately NOT unique: most rows carry null `video_id`, and
  Appwrite unique-index behaviour over nulls must not block
  library rows. The lookup + create are not atomic; a concurrent
  duplicate is possible in principle and harmless (same
  `video_id`, same title).

### 10.2 File-by-file changes

- `functions/api/index.js` — three new actions + `HANDLERS`
  entries, following the existing envelope / `asError`-free
  `HttpError` / context-helper patterns (see §10.3): 
  `create-sound` (signed-in), `report-sound` (signed-in),
  `remove-sound` (staff). New `COL.sounds` / `COL.adminActions`
  entries, `SOUND_CATEGORIES` constant, `callerIsStaff`
  best-effort staff check, `mapSoundRow` mapper, and the R7
  SUPERSEDED header note. No admin-action write pattern existed
  in this file before this change; `remove-sound` writes the
  `admin_actions` collection in the §5.14 schema shape,
  best-effort, and never rolls back a removal over an audit
  failure. `report-sound` returns 404 for an unknown sound (it
  does not mirror `file-report`'s no-existence-check behaviour,
  because the `report_count` increment needs the row).
- `functions/create-upload/index.js` — original-sound
  auto-register: `registerOriginalSound` helper (video_id lookup,
  `public_profiles` username lookup best-effort, §5.24 template
  permissions), called after file-permission normalisation for
  approved non-draft videos with no `sound_id` only. It never
  throws, so registration can never fail an upload. Header
  comment updated. `SOUND_CATEGORIES` for client-sent
  `sound_category` is unchanged (`"original"` is NOT added to
  it); the auto-register uses its own `ORIGINAL_SOUND_CATEGORY`
  constant.
- `schema.json` — `sounds` only, additive: category enum gains
  `"original"`; new attributes `creator_id` (string 36,
  nullable), `source_type` (enum `admin|user|original`),
  `video_id` (string 36, nullable), `status` (enum
  `live|removed`, default `"live"`), `report_count` (integer,
  default 0); new key index `video_id_idx` (`category_idx`
  kept); collection notes rewritten for R7-superseded /
  user-added / originals / non-unique-index rationale. Counts:
  139 attributes, 41 indexes (was 134/40). Necessary companion
  change: `reports.target_type` enum gains `"sound"`, without
  which `report-sound` rows could not be created; `file-report`
  still accepts only `video`/`comment`/`user`. Judgment J14
  added; `residualRisks` R7 marked SUPERSEDED; `soundsLibrary`
  decision/storage/collection strings updated (10 attributes,
  2 indexes; functions now write sounds rows). No renames, no
  duplicates.
- `APPWRITE_SETUP.md` — §5.24 (new attributes, enum value,
  second index, R7-superseded note), §7.3 (user-added
  direct-live flow, original auto-register, Original tab,
  report + staff remove, streaming-only/no-download and catalog
  merge incl. `sounds-catalog.json` restated), §8.1 (three new
  actions with auth levels + request/response shapes), §8.3 (one
  sentence: auto-register step), §10 table row (sound actions as
  the write path), §11 R7 bullet (superseded), §12 (item 11
  sounds wording corrected; new items 13–17: user add-sound
  direct-live, original auto-register, report → remove,
  no-download affordance, Original tab). Section numbering
  preserved; no unrelated section rewritten.
- `functions/README.md` — action table updated (count 17 → 20
  canonical actions) with the three new actions, and the
  direct-publish/sounds deviation note (§10) extended with the
  R7-superseded decision. No other section changed.

### 10.3 Contract notes (for the tests / client workers)

- Actions (all `POST` JSON `{ "action": "<name>", ... }` to the
  `api` function; envelope `{ ok: true, data }` /
  `{ ok: false, error }`):
  - `create-sound` — auth signed-in. Request: `title` (non-empty,
    ≤ 80), `category` (`sound-effects` | `naat` | `taqreer` |
    `islamic`; `"original"` → 400), `storage_path` (non-empty,
    ≤ 512), `duration_seconds`? (number ≥ 0), `source`? (sliced
    to 120). `creator_id` / `source_type` / `status` /
    `video_id` / `report_count` in the body are IGNORED.
    Response `data`: `{ sound: { id, title, category,
    duration_seconds, storage_path, source, creator_id,
    source_type, video_id, status, report_count } }`.
  - `report-sound` — auth signed-in. Request: `sound_id`,
    `reason` (non-empty, ≤ 500). Unknown sound → 404. Response
    `data`: `{ report_id, report, warnings }` where `report` is
    the created `reports` row (`target_type` `"sound"`,
    `status` `"open"`); `warnings` holds a failed
    `report_count` increment only.
  - `remove-sound` — auth staff (Team `admins`, admin or
    moderator). Request: `sound_id`, `reason`? (sliced to 500).
    Unknown sound → 404. Already `removed` → row returned
    unchanged, no duplicate audit row. Response `data`:
    `{ sound: <same mapped shape as create-sound>, warnings }`.
- `sounds` row fields (new): `creator_id`, `source_type`
  (`admin|user|original`), `video_id` (originals only),
  `status` (`live|removed`, default `live`), `report_count`
  (default 0). Category enum now includes `"original"`.
- Client id contract: the client maps an original-sound server
  row to the stable client id `original-<videoId>` (the
  `video_id` value); server rows are keyed by `video_id`, never
  by that client id string. Library listing must filter
  `status == "live"`; `removed` rows must not render. The
  add-sound form offers the four library tabs only, never
  Original. Sounds remain streaming-only: no download affordance
  anywhere.
- `create-upload` behaviour: approved + no `sound_id` ⇒ one
  `sounds` row (dedupe by `video_id`); draft or chosen sound ⇒
  none. The upload response is unchanged (the created video
  row); the sounds row is a side effect, invisible in the
  response, and its failure is logged only.

### 10.4 Open questions (for the owner / coordinator)

- **Real-device recording.** No live Appwrite project,
  credentials, or device test was available; nothing here was
  executed against Appwrite (functions syntax-checked only).
  Confirm on a real device: add-sound → library at once;
  original row on publish; report → remove hides the sound.
- **Live Appwrite behaviour.** The `video_id` dedupe lookup and
  the `sounds` create with the five new attributes both require
  the new attributes/index to exist in the Console collection
  BEFORE first use; until the schema is applied, registration
  fails best-effort (logged) and the upload still succeeds, and
  `create-sound`/`remove-sound` writes carrying unknown
  attributes may be rejected — apply the schema first. The
  `reports` `"sound"` enum value likewise must exist before
  `report-sound` is called. Unverified as before: object-form
  TablesDB shapes, `setJWT` caller resolution, permission
  omission on update, and null handling for nullable attributes
  (see `functions/README.md` "Unverified behaviours").
- **§12 checklist still owed.** Items 13–17 in
  `APPWRITE_SETUP.md` §12 (added by this change) must be run
  live before launch, including the staff-only `remove-sound`
  rejection for plain users and the no-download check. The
  strike/warning side of "report + strike" for sounds (beyond
  the status flip) is owner/staff process, not implemented here.
- **Earlier sections untouched.** §§0–9.5 above are left exactly
  as written, including §9.5's closing note that R7 was left as
  documented; that note is historical (pre-§10) and is superseded
  by this addendum for all forward work.

## 11. Addendum — `create-upload` + `delete-account` merged into `api`: 2 functions (2026-11-04)

Owner-verified live 2026-11-04: the Appwrite Free plan allows only
**2 functions per project** (Appwrite changelog 2026-01-08: reduced
from 5 to 2; Console banner: "limit of 2 functions"). The two live
Console functions, `api` and `events`, already occupy both slots, so
the other two functions built for this migration were never created
in the Console. This addendum records the merge; §§0–10 above are
left exactly as written (historical), including §4's statement that
`create-upload` and `delete-account` "are called as their own
functions" — that statement is superseded by this addendum for all
forward work.

### 11.1 What moved where

- **`create-upload` → `api` action `create-upload`.** The handler
  (`actionCreateUpload`) now lives in `functions/api/index.js`
  (before `actionCreateProfile`), dispatched from the `HANDLERS`
  table as a signed-in action. The client (`store.js`) now calls
  `callApi("create-upload", payload)` instead of executing a
  separate function id; the `CREATE_UPLOAD_FUNCTION` constant is
  removed. `functions/api/index.js` grew 1,233 → 1,736 lines.
  `package.json` untouched; no import changes.
- **`delete-account` → `api` action `delete-account`.** The handler
  (`actionDeleteAccount`) now lives in `functions/api/index.js`,
  dispatched as a signed-in action. The client now calls
  `callApi("delete-account", {})`; the `DELETE_ACCOUNT_FUNCTION`
  constant is removed. `API_FUNCTION = "api"` is retained.
- **History files kept, not deployed.** `functions/create-upload/
  index.js` and `functions/delete-account/index.js` are retained
  byte-for-byte as history, each with a 3-line `MERGED INTO api`
  header comment prepended; their logic is untouched. The
  pre-merge `api` code is backed up at
  `functions/api/index.js.pre-merge-20261104` (md5
  `4e5f9cad68ce4ccd9594bfcecc178c21`). None of these three files
  goes into any deploy archive.
- **Docs updated in the same change.** `functions/README.md`
  (action count 20 → 22; §§3–4 rewritten as merged-action
  contracts), `APPWRITE_SETUP.md` §8 only (header corrected to
  2 functions; §8.1 gains both actions; §§8.3–8.4 kept in full
  as merged-action contracts; one-line pointers added where
  other sections still say "4 functions"), and this addendum.
  `schema.json` is untouched by the merge (its `functions: 4`
  count still describes the pre-merge design; the live truth is
  §8 of the spec + this addendum).
- **Deploy artefact rebuilt.** New `api.zip` / `api.tar.gz` in
  `tokisla-setup/functions/` contain only the merged `index.js`
  + `package.json` from `functions/api/`. The other six archives
  (`events`, `create-upload`, `delete-account` zips/tarballs)
  are left byte-untouched as history. See `MERGE-2FUNCTIONS.md`
  for paths, sizes, listings, and md5s. The owner redeploys by
  uploading the new `api.zip` as a deployment of the existing
  `api` function; `events` needs no redeploy.

### 11.2 What was re-verified (offline/mock only, 2026-11-04)

- The merged `api/index.js` was read in full against the two
  standalone history files: both contracts are preserved (see
  §11.3 for the divergences that are inherent to the merge).
- New mocked test suite `tests/functions.merged-actions.test.mjs`
  (stubbed `node-appwrite`, no network, no live calls) executes
  the real merged router: validation-error shapes, 401 behaviour,
  create-upload happy paths (live/draft/poll/duet/reply/trim/
  mentions/original-sound), and the delete-account cascade order
  asserted from the mock operation log — 147/147 passed. The
  pre-existing suites were re-run in the same pass; see
  `MERGE-2FUNCTIONS.md` for the per-suite counts from that run.
- Grep checks: zero `supabase` references in live files;
  zero remaining live-code invocations of the old standalone
  function ids; `sounds-catalog.json` still `[]`.
- Nothing was live-verified against Appwrite (mocked tests only);
  the §12 first-run checklist in `APPWRITE_SETUP.md` still has to
  run against the real project after the redeploy.

### 11.3 Residual risks / divergences (carried honestly, not hidden)

1. **Parse-before-auth.** The `api` dispatcher parses the JSON
   body and resolves the action before authenticating, so invalid
   JSON or a missing/unknown action returns 400 even for an
   unauthenticated caller, where the standalone functions
   returned 401 first. Inherent to the router; not changed.
2. **Failure log prefix.** Dispatcher failures now log as
   `api failed:`; the orphan-cleanup / original-sound / team-
   removal lines inside the merged actions keep their standalone
   prefixes (`create-upload: …`, `delete-account: …`).
3. **History-file contract tests guard history, not live code.**
   `tests/functions.contract.mjs` still statically reads the two
   standalone history files and passes; it does NOT verify the
   merged code (pointing it at `api/index.js` would break its
   assertions — e.g. `api` legitimately contains `"pending"` in
   `STORY_STATUSES`). The merged code is covered by the new
   `tests/functions.merged-actions.test.mjs` suite instead.
4. **Team removal, single page.** `delete-account` lists Team
   `admins` memberships with limit 100, single page, exactly as
   the standalone handler did (pre-existing limitation).
5. **Nothing live-verified.** SDK method/parameter shapes, JWT
   resolution, permission omission on update, counting, file
   shapes, and null handling remain unverified against a live
   project, as before (see `functions/README.md`, "Unverified
   behaviours"). The mocked tests prove wiring and contract
   shapes only.
