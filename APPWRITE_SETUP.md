# Tokisla — Appwrite Cloud Console Setup Spec

> **Scope: LIVE mode only.** Demo mode runs on `localStorage` and is unaffected
> by everything in this document. Nothing here is client code, nothing is
> deployed by this spec, and no credentials are created by it — the owner
> creates every key and membership by hand in the Console, following the
> steps below, in order.
>
> **Source of truth (read-only):** `tokisla-app/supabase/migrations/0001_init.sql`,
> `0002_rls.sql`, `0003_features.sql`, `supabase/functions/create-upload/index.ts`,
> `supabase/functions/delete-account/index.ts`, and the live store in `store.js`.
> Where Supabase and the app disagree, this spec follows the app's actual
> behaviour and flags the deviation. See §11 (gaps & deviations register).
>
> **Machine-readable mirror:** `schema.json` in this same folder. If this
> document and `schema.json` ever disagree, stop and ask — do not guess.
>
> **2026-11-03 — direct publish + sounds library (owner orders).** New
> videos are published LIVE on upload: no pre-publication review, no
> `category_ids` in the upload flow, a new optional `location` field on
> `videos`, and a catalog-driven sounds library (no music) backed by a
> new `sounds` collection (§5.24) plus the existing `media` bucket —
> the collection was added because the client implementation strictly
> requires structured metadata storage for owner-added sounds. Stories
> keep pre-publication review; moderation for videos is
> post-publication only (report, admin remove/hide, suspend).

## 0. Fixed facts — do not change these

| Item | Exact value |
|---|---|
| Appwrite Cloud endpoint | `https://sgp.cloud.appwrite.io/v1` |
| Project ID (public identifier, safe to show) | `6ae910e6000dad2f34b4` |
| Database ID | `tokisla` |
| Collection IDs | Exactly the Supabase table names (see §5), plus `public_profiles` (§6) and `sounds` (§5.24, added 2026-11-03 for the sounds library) |
| Bucket IDs | `media`, `avatars` (§7) |
| Team ID | `admins` (§3) |
| Free-plan budget used by this spec | 1 of 1 database · 2 of 3 buckets · 4 of 5 functions · 1 team |

> 2026-11-04 correction: the Free plan allows 2 functions per project — see §8 (the "4 of 5 functions" figure in the table above is superseded; the design is `api` + `events` only).

**Naming warning — read first.** Appwrite renamed its database vocabulary.
Depending on the Console version you see, the same objects may be labelled
**TablesDB / Tables / Columns / Rows** instead of **Databases / Collections /
Attributes / Documents**. They are the same objects; the underlying behaviour
is unchanged and the old API names still work. This spec uses the
Collection/Attribute/Document wording from the migration brief, and gives the
TablesDB synonym in parentheses at first use. If a label in this spec does not
match the screen in front of you, use the synonym — do not create a different
kind of object (in particular, do **not** pick a native PostgreSQL/MySQL
database when creating the database in §4; pick the Appwrite TablesDB /
DocumentsDB database type, i.e. the Appwrite-managed database).

**Permission syntax.** In this spec, permissions are written in Appwrite REST
string form, e.g. `read("any")`, `create("users")`, `update("team:admins")`.
In the Console permission picker these appear as role rows: **Any**,
**Users** (any signed-in user), **Team: admins**, **User: \<id\>**. In SDK
code the same permission is `Permission.read(Role.any())` etc. (verified
against Appwrite docs, Permissions page, 2026-11-02.) A user can only grant a
permission they themselves hold — this matters in §5/§7 and is flagged
wherever a fallback exists.

**Two Appwrite facts that shape this whole design (no equivalents in SQL):**

1. There is **no SQL, no RLS, no triggers, no views, and no per-attribute
   permissions**. A user who holds update permission on a document can write
   *any* attribute of that document. Field-level rules from Supabase (the
   `guard_profile_role` / `guard_video_moderation` triggers, CHECK
   constraints) therefore move to: (a) collection/document permissions,
   (b) validation inside Functions, and (c) file-permission flips that only
   Functions can perform. Residual risks from this are stated plainly in
   §11 — they are not hidden.
2. There are **no foreign keys and no cascade deletes**. References are
   plain string ID attributes. Deleting a parent document does **not**
   delete its children. All cascade behaviour is implemented explicitly in
   the `delete-account` function and the `api` function's delete-video
   action (§8). Direct client-side deletes are therefore **not** granted
   on `videos`, `profiles`, or `stories` (see §5).

**Order of work.** Do the sections in order: §1 Auth → §2 API key →
§3 Team + owner admin → §4 Database → §5 Collections → §6 public_profiles
sync → §7 Buckets → §8 Functions → §9 Category seed → §10 Verification
checklist. Do not seed categories before the `categories` collection exists;
do not create Functions before the API key exists (§2), because every
function needs it as an environment variable.

---

## 1. Auth — email/password

Console path: open the project (`6ae910e6000dad2f34b4`) → left menu
**Auth** → **Settings** (or the Auth overview page, depending on Console
version).

1. Under **Auth methods** (or **Providers**), find **Email/Password** and
   enable it. Leave any OAuth providers untouched — Tokisla uses
   email/password only.
2. **Session length / security:** leave the defaults. Do not change password
   rules; the app does not enforce any beyond Appwrite's defaults.
3. **Email verification:** Appwrite sends verification mail only once a mail
   provider is configured under **Messaging**. The Supabase app flow tells a
   new user "Check your email to verify your account, then log in." Do NOT
   turn on "require verified email to sign in" until mail sending has been
   tested end-to-end; if it is turned on before mail works, nobody can log
   in. Record the decision (verification on/off) for the implementation
   workers — the profile-creation flow in §8 (action `create-profile`) is
   written to be idempotent and safe either way, because it is also called
   on first login when no profile document exists yet.
4. No other Auth settings change. In particular, do not enable anonymous
   sessions: guests are *unauthenticated* readers in this design (the
   guest-first feed), and Appwrite's `any` role already covers them.

**Identity rule (applies everywhere below).** An Appwrite Auth user's `$id`
**is** the Tokisla user id. The `profiles` document ID **must equal** the
Auth user ID — exactly as Supabase `profiles.id = auth.users.id`. Never
generate a second id for a profile. Every other collection's `*_id`
attributes (`creator_id`, `user_id`, `follower_id`, …) store that same Auth
`$id` string. Appwrite user IDs are opaque strings; do not assume they look
like UUIDs.

---

## 2. API key — owner creates it, never shares it

Console path: **Settings** (project settings, gear icon) → **API Keys** →
**Create API Key**.

1. **Name:** `tokisla-functions` (any recognisable name is fine; this name
   is used only to identify the key in the list).
2. **Scopes:** tick **Databases**, **Storage**, **Users**, and **Teams**
   (read + write wherever the Console offers the choice). No other scopes.
   Functions need Databases + Storage to bypass document/file permissions
   with the key, Users to delete accounts and read team memberships, Teams
   to check `admins` membership inside Functions.
3. **Expiry:** leave at the default (no expiry) unless the owner prefers a
   rotation date. If an expiry is set, write it down outside this spec and
   diary the rotation — an expired key silently breaks all four Functions.
4. Click **Create**, **copy the key once**, and store it where the owner
   keeps secrets (password manager). **The key must never be pasted into
   chat, into any file in the workspace, into client code, or into
   `schema.json`.** It is entered only (a) as a Function environment
   variable in §8, and (b) by the owner, on their own machine, if they run
   the optional category-seed command in §9. If the key is ever exposed,
   delete it in **Settings → API Keys** and create a replacement, then
   update the four Functions' variables. (2026-11-04: the design now
   has 2 functions — see §8.)

---

## 3. Admin mechanism — Team `admins` (the one authority)

**Decision (judgment call J1, see §11): the Appwrite Team `admins` is the
ONLY authority for admin/moderator power.** `profiles.role` is a display
mirror only and is never trusted for any authorisation decision. Functions
check team membership with the API key; collection permissions use
`team:admins`; the `admin.html` role check is a UI gate only and every
privileged action behind it re-checks membership server-side (or is gated
by a `team:admins` collection permission). A user cannot grant themselves
team membership: memberships are created only in the Console by an existing
team owner/admin, or by a Function holding the API key. No client code path
creates memberships.

**Why not the alternatives?**

- *`profiles.role` alone* — rejected: a user with update permission on
  their own profile document could set `role: "admin"` in a direct API
  call (no per-attribute permissions exist), so the field cannot be
  authority. It is kept because `admin.html` and the app read it, but it
  is always re-derived from the team (see `set-role` action, §8).
- *User labels* (e.g. label `admin`) — rejected: labels can express only
  one flat flag per check and cannot distinguish `admin` from `moderator`
  without two labels; team roles express both in one membership, are
  visible in the Console membership list, and are directly usable in the
  permission picker. Labels are not used anywhere in this spec.

**The `moderator` distinction is KEPT.** Supabase has `role in
('user','moderator','admin')`, `is_moderator()` = admin or moderator, and
`is_admin()` = admin only; the app's admin panel admits both roles. The
team therefore has two roles with exactly these meanings:

| Team role | Meaning (mirrors Supabase) | May do |
|---|---|---|
| `admin` | `is_admin()` | Everything, including `admin_actions`, category writes, suspend/unsuspend, role changes, user management |
| `moderator` | `is_moderator()` but not admin | Moderate videos/stories/comments, manage reports and verification requests, read moderation internals |

### 3.1 Create the team

Console path: left menu **Teams** (in some Console versions: **Auth →
Teams**) → **Create Team**.

1. **Team ID:** type exactly `admins`. (Custom ID — do not accept the
   auto-generated ID; every permission string in §5 references
   `team:admins`.)
2. **Name:** `Admins`.
3. Click **Create**. The owner, as team creator, is automatically a member
   with the `owner` team role.

### 3.2 Define the team roles

Console path: **Teams → Admins → Settings** (or **Roles** tab, depending on
version).

1. Add role **`admin`**.
2. Add role **`moderator`**.
3. Do not add any other role. (The built-in `owner` role is separate and
   belongs only to the team creator.)

### 3.3 Make the owner an admin (the equivalent of the old SQL `UPDATE profiles SET role='admin'`)

There is no SQL here. The owner's power comes from team membership, and the
`profiles.role` mirror is then set by a Function so the UI agrees. Do these
steps in this order:

1. The owner signs up / logs in to the Tokisla app once (live mode), so an
   Auth user exists. Console path: **Auth → Users** → find the owner's
   account → copy its **User ID** (the `$id`).
2. **Teams → Admins → Members → Create Membership** (or **Invite member**):
   add the owner's User ID (paste the ID — do not use the email-invite
   flow for the owner, or the membership will sit unaccepted), and assign
   role **`admin`**. Save. The membership list must now show the owner
   with roles including `admin`.
3. After the Functions exist (§8), call the `api` function's
   `set-role` action once for the owner (the parent agent will guide this
   call; it requires the API key and is not a client action). It sets
   `profiles.role = "admin"` for the owner's profile document so
   `admin.html` admits them. If `set-role` is unavailable yet, the owner
   can still moderate through Functions, but `admin.html` will refuse entry
   until the mirror is set — that is expected, not a bug.
4. **To make a moderator later:** repeat step 2 with role `moderator`,
   then `set-role` with `moderator`. **To remove an admin/moderator:**
   delete their membership in **Teams → Admins → Members**, then run
   `set-role` with `user` for that person. Removing the membership alone
   revokes all real power immediately; the `set-role` mirror update only
   fixes the display. Never "promote" anyone by editing `profiles.role`
   directly in the Console — that edits the mirror only and grants nothing,
   while leaving the UI and the truth disagreeing.
5. **First-admin safety note.** Until step 2 is done, nobody can moderate
   anything (correct — default deny). Until step 3 is done, the owner
   cannot enter `admin.html`. Do not work around this by loosening any
   collection permission in §5.

---

## 4. Database — one database, ID `tokisla`

Console path: left menu **Databases** → **Create Database**.

1. **Database ID:** type exactly `tokisla` (custom ID).
2. **Name:** `Tokisla`.
3. Database type: choose the Appwrite-managed database (TablesDB /
   DocumentsDB wording — see §0 naming warning). Do **not** choose a native
   PostgreSQL/MySQL database: native databases have no Appwrite
   permissions, no function event triggers, and no client SDK access, and
   this entire spec assumes the Appwrite database.
4. Click **Create**. Free plan allows exactly 1 database per project — this
   is it. All 25 collections in §5/§6 live inside it.

---

## 5. Collections — 25 collections

Create every collection inside database `tokisla`: **Databases → tokisla →
Create Collection** (or **Create Table**). For each collection:

- **Collection ID** = the ID in the heading (custom ID, typed exactly).
- **Name** = the same string.
- **Permissions:** set exactly as listed. Where the heading says
  *Document/row security: ON*, first open the collection's **Settings**
  and enable **Document security** (labelled **Row security** in the
  TablesDB Console). Where it says *OFF*, leave that toggle off.
- **Attributes/columns:** **Attributes** tab → **Create Attribute**,
  one per row in the table. Attribute **Key** = the `key` column, exactly.
  Types: Appwrite Console labels the double type **Float** and the string
  type **String** (legacy) / **Varchar** (TablesDB) — they are the same
  type this spec calls `string` / `double`; pick whichever label the
  Console shows for plain text / floating-point. `size` = maximum length
  for strings. **Required** and **Default** exactly as listed.
- **Indexes:** **Indexes** tab → **Create Index**, one per row. Index
  **Key** = the key shown; **Type** = `key`, `unique`, or `fulltext`;
  **Attributes** in the order shown (order matters for composite indexes).
- Wait for each attribute/index to finish building (status **Available**)
  before creating the next one that depends on it. Appwrite builds
  attributes/indexes asynchronously; creating documents before an index
  is available, or querying an attribute before it is available, fails.

**Global attribute rules (apply to every collection):**

- Do **not** create `created_at` / `updated_at` attributes. Appwrite
  supplies `$createdAt` and `$updatedAt` on every document automatically
  (this replaces the Supabase `touch_updated_at()` trigger). All
  "order by created_at" queries in the app become "order by `$createdAt`".
  The single exception is `watch_history.watched_at`, which the app reads
  as a distinct, updatable timestamp — it stays a real attribute.
  `story_views.viewed_at` is dropped for the same reason (nothing reads
  it; `$createdAt` covers it).
- Do **not** create an `id` attribute. The document `$id` is the id.
  References (`creator_id`, `video_id`, …) are plain **string** attributes
  holding another document's `$id`. **No relationship attributes are
  used anywhere** (judgment call J2): Appwrite relationships auto-create
  reverse attributes and cascade options that do not match the SQL
  foreign keys, and every reference in this app is a bare ID lookup.
  Existence checks that a foreign key used to enforce (e.g. `duet_of`
  must point at a real video) move into the `create-upload` function,
  which already performs them in the Supabase version.
- Do **not** create attributes for Appwrite system fields (`$id`,
  `$createdAt`, `$updatedAt`, `$permissions`, `$databaseId`,
  `$collectionId`).
- String sizes are ceilings, not targets: they mirror the SQL
  `char_length` CHECKs. Where SQL had a CHECK but Appwrite has no CHECK,
  the enforcing location is stated in the collection notes and in §10.
- **Uniqueness is enforced by `unique` indexes, not by document IDs.**
  Appwrite has no composite primary keys. For every former composite-PK
  table (`follows`, `video_likes`, `saved_videos`, `blocked_users`,
  `comment_likes`, `poll_votes`, `story_views`, `video_categories`,
  `watch_history`) documents use auto-generated IDs (`ID.unique()` in SDK
  terms) and the `unique` index on the key pair rejects duplicates.
  Client code must treat a duplicate-create error (409) as "already
  exists" and must never invent a composite document ID by joining two
  user IDs — joined IDs exceed Appwrite's 36-character document-ID limit.
  The one deliberate exception is `user_preferences`, whose document ID
  **is** the user ID (one row per user, mirroring its SQL primary key),
  and `profiles` / `public_profiles`, whose document ID is the Auth user
  ID (§1).

**Reading the permission blocks.** Each collection lists collection-level
permissions first, then — where document security is ON — the
*document-permission template*: the exact permission strings a creator
(client or Function) must attach when creating a document. `OWNER`,
`SENDER`, `RECIPIENT`, `REPORTER`, `BLOCKER` in templates mean "that
document's owning user ID". `schema.json` carries the same templates
machine-readably.

### 5.1 `profiles` — Document/row security: ON

Source: `profiles` (0001 + `private_account`, `website` additions).
Collection-level permissions — **create:** `create("users")` only;
**read / update / delete:** none (leave unchecked; document permissions
decide). **No client may create a profile document directly in the new
design** (see note below); the `create("users")` entry exists so the
Console/API-key path is not blocked, but the app's signup flow calls the
`api` function (§8) instead.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `username` | string | 32 | Yes | — | Unique index below. Format `^[a-z0-9_.]{3,24}$` is NOT enforceable in Appwrite — enforced by `create-profile` (§8) and by client validation. See §11. |
| `display_name` | string | 60 | No | `""` | |
| `bio` | string | 160 | No | `""` | |
| `avatar_url` | string | 2048 | No | — | URL string only. No avatar upload path exists in the app (see §7). |
| `website` | string | 200 | No | `""` | |
| `role` | enum | `user`, `moderator`, `admin` | No | `user` | DISPLAY MIRROR ONLY. Authority is Team `admins` (§3). Never trusted by Functions. |
| `is_suspended` | boolean | — | No | `false` | Only Functions (API key) change this, via `api` suspend action. |
| `verified` | boolean | — | No | `false` | ★ SCHEMA GAP FIXED (§11, G1). No `verified` column exists in any migration, yet 0003's `public_videos` view selects `p.verified` and the app reads/writes it. Added here so the shipped schema and the app agree. Only the `api` decide-verification action changes it. |
| `private_account` | boolean | — | No | `false` | |

Indexes: `username_unique` — unique — [`username`].

Document-permission template (set by the `create-profile` Function, never
by the client): read `read("user:OWNER")`, `read("team:admins")`; update
`update("user:OWNER")`, `update("team:admins")`; delete
`delete("team:admins")`. **Guests and other users must never hold read
permission on a full profile document** — `role` and `is_suspended` would
leak. All public reads go through `public_profiles` (§6).

Profile-creation rule (judgment call J3): **profile documents are created
only by the `api` function action `create-profile`**, which forces
`role="user"`, `is_suspended=false`, `verified=false`, validates the
username format and uniqueness, and attaches the template above. The
alternative considered — letting clients create the document with a
collection `create("users")` permission and "only if role is user" — is
impossible in Appwrite: permissions cannot inspect attribute values, so a
client granted create could set `role="admin"` on its own document. The
Function is therefore mandatory, not optional. The old Supabase flow
(client `insert` into `profiles` in `store.js` `signUp`) must be changed
by the implementation workers to call `create-profile`; the old flow must
not be kept alongside it.

Profile-update rule: the owner may update only `username`, `display_name`,
`bio`, `website`, `avatar_url`, `private_account` (the `updateProfile` /
`setPrivateAccount` fields). Appwrite cannot enforce *which* attributes an
owner writes — an owner with document update permission can technically
write `role`/`verified`/`is_suspended` on their own document in a direct
API call. This is a stated residual risk (§11, R1). It grants nothing:
Functions and privileged collection permissions consult only Team
`admins`, and `public_profiles` sync (§6) never copies `role`,
`is_suspended`, or `verified` from a profile update event. Suspension and
verification are additionally backstopped by file-permission flips (§7).

### 5.2 `categories` — Document/row security: OFF

Source: `categories` (0001 seed, §9). Collection-level permissions —
**read:** `read("any")`; **create / update / delete:**
`create/update/delete("team:admins")` (admin team role only — note: the
permission string is `team:admins`; the admin-only restriction within the
team is enforced because category writes in the app go through admin
flows, and the `api` function is the only writer the implementation
workers should wire; a moderator holding `team:admins` read/update on this
collection could technically write a category in a direct API call —
accepted, low severity, §11 R4).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `name` | string | 60 | Yes | — | |
| `slug` | string | 64 | Yes | — | Unique index below. **Document `$id` = the slug** (see note). |
| `sort_order` | integer | — | No | `0` | 1–20 for the seed (§9). |
| `is_active` | boolean | — | No | `true` | Inactive categories are hidden: every category read filters `is_active = true`, except admin reads. |

Indexes: `slug_unique` — unique — [`slug`]; `sort_order_idx` — key —
[`sort_order`].

**Categories are Discover-only since 2026-11-03.** The collection and
the §9 seed are KEPT for the Discover page (the owner has not answered
whether Discover categories go too — see §11 open questions). The
upload/post flow no longer assigns categories: `create-upload` accepts
no `category_ids`, creates no `video_categories` rows, and videos
carry no category data. Nothing in the feed, profile, or admin reads
may require a category join or crash when a video has no categories;
category display, if any, is optional and must tolerate its absence.
`user_preferences.category_ids` remains a Discover preference only
(§5.15).

**Numeric category IDs are NOT preserved** (judgment call J4). Supabase
`categories.id` was an integer identity (1–20) and `video_categories`
/ `user_preferences.category_ids` stored integers. Appwrite documents
have string `$id`s. In this design the **slug is the join key**:
`video_categories.category_id` and `user_preferences.category_ids` store
slugs (e.g. `"halal-funny"`), and each category document's `$id` is its
slug. `sort_order` preserves the 1–20 ordering. Implementation workers
must map old numeric ids via `sort_order` (or the seed table in §9) and
must not store integers in `category_id`/`category_ids`. The alternative
— document IDs `"1"`…`"20"` — was rejected: it preserves nothing the
client can query by name, and it makes Console browsing and debugging
opaque.

### 5.3 `videos` — Document/row security: ON

Source: `videos` (0001 + 0003 `filter`/`poll`/`duet_of`/`reply_*`/`draft`
status). Collection-level permissions — **create / read / update /
delete:** none (leave all unchecked). **No client creates, reads, updates,
or deletes a video document through collection permissions.** Creation is
by the `create-upload` Function only; reads/updates/deletes are governed
entirely by the document-permission templates below; moderation, publish,
pin-adjacent and delete actions go through the `api` Function (§8).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `creator_id` | string | 36 | Yes | — | Auth user `$id`. |
| `caption` | string | 300 | No | `""` | 300-char ceiling lives here (attribute size). |
| `location` | string | 256 | No | — | **Added 2026-11-03.** Optional free-text place name from the post screen. Trimmed and capped at 256 chars by `create-upload`; null when absent/empty. Reuses the existing visibility/comment/duet fields — no field is duplicated. |
| `sound_id` | string | 64 | No | — | **Added 2026-11-03 (sounds library).** Catalog sound chosen for this video. Stored opaquely by `create-upload`; NOT validated against the `sounds` collection, so built-in catalog entries need no server row. Null = original audio (default). No music anywhere. |
| `sound_title` | string | 80 | No | — | Display copy of the chosen catalog sound title, as sent by the client (sliced to 80 by `create-upload`). Null when no sound chosen. |
| `sound_category` | enum | `sound-effects`, `naat`, `taqreer`, `islamic` | No | — | Display copy of the chosen catalog sound category. Unknown values are stored as null by `create-upload` (never fail the upload). |
| `trim_start_seconds` | double | min `0`, max `20.5` | No | `0` | **Added 2026-11-03 (fix-up).** Crop/Trim start in seconds from the post screen. Stored by `create-upload` clamped to `[0, duration_seconds]`; `0` when absent. Feed playback keeps the video inside `[trim_start_seconds, trim_end_seconds]`. |
| `trim_end_seconds` | double | min `0`, max `20.5` | No | — | **Added 2026-11-03 (fix-up).** Crop/Trim end in seconds from the post screen. Stored by `create-upload` clamped to `[trim_start_seconds, duration_seconds]`; the video duration when absent. |
| `content_disclosure` | boolean | — | No | `false` | **Added 2026-11-03 (fix-up).** Branded-content/ad disclosure checkbox from the post screen. Stored by `create-upload` exactly as sent (`true` only when the client sends `true`); `false` when absent. |
| `link_url` | string | 300 | No | — | **Added 2026-11-03 (fix-up).** Optional link from the post screen (Add link). Trimmed and sliced to 300 chars by `create-upload`; null when absent/empty. |
| `storage_provider` | string | 32 | No | `appwrite` | Supabase default was `"supabase"`; new rows say `"appwrite"`. Retained for client compatibility; never read for playback decisions. |
| `storage_path` | string | 512 | Yes | — | The Appwrite file `$id` in the `media` bucket (§7). NOT a filesystem path — Appwrite Storage has no folders. |
| `thumbnail_path` | string | 2048 | No | — | Appwrite file `$id` in `media` (thumbnail file), or an external URL. See §7. |
| `duration_seconds` | double | min `0`, max `20.5` | Yes | — | Attribute bounds are inclusive; `0` is rejected by `create-upload`, not by the schema. The `> 0 and <= 20.5` CHECK lives in the Function (§10). |
| `size_bytes` | integer | min `0`, max `26214400` | No | — | 25 MiB ceiling (26214400 bytes) lives here AND in `create-upload`. |
| `visibility` | enum | `public`, `followers`, `private` | No | `public` | |
| `moderation_status` | enum | `pending`, `approved`, `rejected`, `needs_review`, `draft` | No | `pending` | **Direct publish (2026-11-03):** `create-upload` sets non-draft posts to `approved` with `published_at` set, so they match the §6.2 feed query immediately — there is no pre-publication review and `pending` is never assigned to a new upload (the enum value and the schema default are retained for legacy rows only; `create-upload` always sets the status explicitly). `draft` is the only client-choosable non-live status. `rejected`/`needs_review` are post-moderation only (`api` moderate-video). Only Functions set this. |
| `rejection_reason` | string | 500 | No | — | Set only by moderation action. |
| `published_at` | datetime | — | No | — | Set by `create-upload` on direct publish and by `api` publish-draft when a draft goes live; set by the moderation action when a video first becomes `approved` if empty (mirrors the SQL guard trigger: `coalesce(published_at, now())`). Never set by clients. |
| `like_count` | integer | min `0` | No | `0` | Maintained ONLY by the `events` Function (§8). Clients never write it. |
| `comment_count` | integer | min `0` | No | `0` | Same as `like_count`. |
| `view_count` | integer | min `0` | No | `0` | Maintained ONLY by the `api` increment-view action (§8). Clients never write it. |
| `filter` | enum | `normal`, `warm`, `cool`, `mono`, `vivid` | No | `normal` | |
| `poll_question` | string | 80 | No | — | Poll decomposed (J5): the SQL `poll` JSONB object `{question, options[2]}` becomes three string attributes. All three are set together, or none. See note. |
| `poll_option_a` | string | 30 | No | — | First poll option. |
| `poll_option_b` | string | 30 | No | — | Second poll option. |
| `duet_of` | string | 36 | No | — | Video `$id` of the duet source, or empty. Existence validated by `create-upload`. |
| `reply_comment_id` | string | 36 | No | — | Comment `$id`, or empty. |
| `reply_video_id` | string | 36 | No | — | Derived by `create-upload` from `reply_comment_id` (mirrors the Supabase function). |

Indexes: `feed_idx` — key — [`moderation_status`, `visibility`];
`creator_idx` — key — [`creator_id`]; `creator_status_idx` — key —
[`creator_id`, `moderation_status`]; `caption_search` — fulltext —
[`caption`].

Document-permission templates (set by `create-upload`; flipped by the
`api` moderation / publish-draft actions — see §7 for the matching file flips):

- **Not live** (`draft`, `rejected`, `needs_review` — there is no
  `pending` step for new uploads since direct publish, 2026-11-03):
  read `read("user:CREATOR")`, `read("team:admins")`; update
  `update("user:CREATOR")`, `update("team:admins")`; delete
  `delete("user:CREATOR")`, `delete("team:admins")`.
- **Approved + `visibility = public`:** read `read("any")`; update/delete
  as above. A new non-draft upload is created directly with this
  template by `create-upload`, together with the matching public file
  permissions (§7) — that is what makes it appear in the feed at once.
  The flip from creator/team-only read to `any` read for a draft or a
  restored video happens **only** inside the `api` publish-draft /
  moderation actions, in the same call that flips the video file's
  permissions (§7). A document whose status is `approved` but whose file
  was never flipped is unplayable — this is the deliberate backstop for
  the residual risk in §11 R2.
- **Approved + `visibility = followers` or `private`:** read stays
  creator/team-only. This faithfully mirrors the SQL `videos_select`
  policy, under which followers could not read followers-visibility rows
  through the direct table query either (they appear only in the demo
  store's in-memory filtering — a pre-existing demo/live divergence, not
  something this migration invents; see §11 G4). Do not invent a
  follower-list read permission: Appwrite cannot express "readable by my
  followers" as a permission.

Poll note (J5): decomposing `poll` into three attributes was chosen over
a single JSON string because Appwrite has no JSON attribute type, the
three fields have independent SQL length caps (question 80, options 30),
and the client reads them as plain fields. `create-upload` enforces
"all three or none" and the 80/30 caps. A video with no poll has all
three empty.

### 5.4 `video_categories` — Document/row security: ON

Source: `video_categories` (composite PK). Collection-level permissions
— **create:** `create("users")`; **read / update / delete:** none.
Reads are governed by document permissions. **No new rows are created
since direct publish (2026-11-03):** `create-upload` accepts no
`category_ids` and creates no links. The collection is retained for
the Discover page and for legacy rows; `delete-video` /
`delete-account` still clean up legacy rows.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `video_id` | string | 36 | Yes | — | Video document `$id`. |
| `category_id` | string | 64 | Yes | — | Category **slug** (§5.2, J4), not a number. |

Indexes: `video_category_unique` — unique — [`video_id`, `category_id`];
`category_idx` — key — [`category_id`].

Document-permission template: read `read("any")` (category membership of
a video is public information, mirroring the SQL select policy which
exposed rows for approved videos); update/delete: none for clients
(Function-only via API key). A row for a non-approved video is still
listable by ID in this template — harmless, because the video document
and file themselves are gated; the feed query pattern (§6) never joins
through this collection for unauthenticated users. If an implementation
worker prefers stricter behaviour, the template may be narrowed to the
video template in §5.3 — record the change.

### 5.5 `follows` — Document/row security: ON

Source: `follows` (composite PK, `follower_id <> following_id` CHECK).
Collection-level permissions — **create:** `create("users")`;
**read:** `read("any")`; **update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `follower_id` | string | 36 | Yes | — | |
| `following_id` | string | 36 | Yes | — | Self-follow (`follower_id = following_id`) is rejected by client validation + the `api` function is NOT involved; the CHECK has no server enforcement in this design — the client must check before insert (flagged in §10). |

Indexes: `follow_unique` — unique — [`follower_id`, `following_id`];
`following_idx` — key — [`following_id`]; `follower_idx` — key —
[`follower_id`].

Document-permission template: read `read("any")` (follow lists/counts are
public, mirroring SQL `follows_read_counts`); update: none; delete
`delete("user:FOLLOWER")`. The delete permission is what makes
unfollow-by-owner work through the client SDK while nobody else can
delete the row.

### 5.6 `video_likes` — Document/row security: ON

Source: `video_likes` (composite PK). Collection-level permissions —
**create:** `create("users")`; **read:** `read("any")`;
**update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `video_id` | string | 36 | Yes | — | |

Indexes: `like_unique` — unique — [`user_id`, `video_id`];
`video_idx` — key — [`video_id`].

Document-permission template: read `read("any")` (like rows are publicly
readable for counts, mirroring SQL); update: none; delete
`delete("user:OWNER")`. Like/unlike is insert/delete of this document;
`like_count` on the video is recomputed by the `events` Function (§8),
never written by the client.

### 5.7 `comments` — Document/row security: ON

Source: `comments` (0001 + 0003 `is_pinned`). Collection-level
permissions — **create:** `create("users")`; **read / update / delete:**
none (document permissions decide, because `hidden`/`removed` comments
must not be publicly readable).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `video_id` | string | 36 | Yes | — | |
| `user_id` | string | 36 | Yes | — | |
| `body` | string | 500 | Yes | — | 1–500 chars (SQL CHECK). Empty body is rejected by client validation; Appwrite cannot enforce a minimum length. |
| `moderation_status` | enum | `visible`, `hidden`, `removed` | No | `visible` | Clients may only create `visible`. Hiding/removing is an `api` moderation action that also flips document permissions. |
| `is_pinned` | boolean | — | No | `false` | Only the `api` set-comment-pin action changes this (one pin per video). Clients never write it directly. |

Indexes: `video_status_idx` — key — [`video_id`, `moderation_status`];
`user_idx` — key — [`user_id`]; `video_pin_idx` — key — [`video_id`,
`is_pinned`].

Document-permission templates: **visible** — read `read("any")`, update
`update("user:AUTHOR")`, `update("team:admins")`, delete
`delete("user:AUTHOR")`, `delete("team:admins")`. **hidden/removed** —
read `read("user:AUTHOR")`, `read("team:admins")`, update/delete as
visible. The template flip is performed by the `api` moderation action
together with the status change.

### 5.8 `saved_videos` — Document/row security: ON

Source: `saved_videos` (composite PK). Collection-level permissions —
**create:** `create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `video_id` | string | 36 | Yes | — | |

Indexes: `save_unique` — unique — [`user_id`, `video_id`].

Document-permission template: read `read("user:OWNER")`; update: none;
delete `delete("user:OWNER")`. Saves are strictly owner-only (SQL
`saves_all`), including read — unlike follows/likes, there is no public
read.

### 5.9 `blocked_users` — Document/row security: ON

Source: `blocked_users` (composite PK, `blocker_id <> blocked_id` CHECK).
Collection-level permissions — **create:** `create("users")`;
**read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `blocker_id` | string | 36 | Yes | — | |
| `blocked_id` | string | 36 | Yes | — | Self-block is rejected by client validation only (no server CHECK; §10). |

Indexes: `block_unique` — unique — [`blocker_id`, `blocked_id`].

Document-permission template: read `read("user:BLOCKER")`; update: none;
delete `delete("user:BLOCKER")`. Strictly blocker-only, mirroring SQL.

### 5.10 `notifications` — Document/row security: ON

Source: `notifications`. Collection-level permissions — **create:**
`create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | The ADDRESSEE (recipient), not the actor. |
| `type` | enum | `follow`, `like`, `comment`, `moderation`, `system`, `share`, `mention` | Yes | — | |
| `actor_id` | string | 36 | No | — | Empty for `system` notifications. |
| `video_id` | string | 36 | No | — | |
| `comment_id` | string | 36 | No | — | |
| `is_read` | boolean | — | No | `false` | |

Indexes: `user_idx` — key — [`user_id`].

Document-permission template: read `read("user:ADDRESSEE")`; update
`update("user:ADDRESSEE")` (mark-read); delete
`delete("user:ADDRESSEE")`.

★ **DEVIATION FROM THE SQL RLS — DELIBERATE, FOLLOWS THE APP (G2).**
Migration 0002 defines NO user insert policy for `notifications`
("inserts are service-role only"). But the live store inserts
notifications client-side in `shareVideo`, `addComment` (@mentions),
`publishDraft` (@mentions), and `adminDecideVerification` (system
notice). Following the app's actual behaviour, this spec **does** grant
authenticated users create permission here, with the document addressed
to another user. **Caveat — must verify in the first live run (§10):**
Appwrite forbids a user granting a permission they do not hold, and the
docs give team-sharing as the example failure. Whether a client-created
document may carry `read("user:<a different user>")` must be tested with
a real share/mention before launch. If the Console/API rejects it, route
those three client insert sites through the `api` function's `notify`
action instead (already specified as the fallback in §8) and set this
collection's create permission to none. Do not leave both paths live
without the test. Function-created notifications (mention handling inside
`create-upload`, moderation/system notices) always use the API key and
are unaffected by this caveat.

### 5.11 `reports` — Document/row security: ON

Source: `reports`. Collection-level permissions — **create:**
`create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `reporter_id` | string | 36 | Yes | — | |
| `target_type` | enum | `video`, `comment`, `user` | Yes | — | |
| `target_id` | string | 36 | Yes | — | ID of the reported video/comment/user. No FK (J2). |
| `reason` | string | 500 | Yes | — | 3–500 chars in SQL; minimum length is client-enforced only. |
| `status` | enum | `open`, `reviewed`, `dismissed` | No | `open` | Clients may only create `open`. Status changes are moderator-only via `api` decide-report action. |

Indexes: `status_idx` — key — [`status`]; `reporter_idx` — key —
[`reporter_id`].

Document-permission template: read `read("user:REPORTER")`,
`read("team:admins")`; update `update("team:admins")`; delete
`delete("team:admins")`. Same grant caveat as §5.10: a non-team reporter
granting `read("team:admins")` on a document they create must be verified
in the first live run; if rejected, route report filing through the
`api` `file-report` action (§8) and set create to none. Reporters see
only their own reports; moderators see all.

### 5.12 `moderation_reviews` — Document/row security: OFF

Source: `moderation_reviews`. Collection-level permissions — **create /
read / update / delete:** `team:admins` (all four; team roles admin +
moderator). No client outside the team ever touches this collection;
review rows are normally written by the `api` moderation action with the
API key.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `video_id` | string | 36 | Yes | — | |
| `reviewer_id` | string | 36 | No | — | Null when the reviewer account was deleted (SQL `ON DELETE SET NULL` — here, `delete-account` must null this field explicitly; see §8). |
| `decision` | enum | `approved`, `rejected`, `needs_review` | Yes | — | |
| `reason` | string | 1000 | No | — | |

Indexes: `video_idx` — key — [`video_id`].

### 5.13 `moderation_events` — Document/row security: OFF

Source: `moderation_events`. Collection-level permissions — **create /
read / update / delete:** `team:admins`. Rows are written by Functions
with the API key (`create-upload` logs `uploaded`; `api` moderation
actions log decisions). Clients never write here.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `video_id` | string | 36 | No | — | Empty for non-video events. |
| `event_type` | string | 64 | Yes | — | Free text in SQL (`uploaded`, decision events, …). No enum — new event types must not require a schema change. |
| `details` | string | 2000 | No | `"{}"` | JSON-encoded object (Appwrite has no JSON attribute type). The SQL `jsonb` default `{}` is preserved as the string `"{}"`. |

Indexes: `video_idx` — key — [`video_id`].

### 5.14 `admin_actions` — Document/row security: OFF

Source: `admin_actions`. Collection-level permissions — **create / read /
update / delete:** admin team role only. The Console permission picker
expresses this as `team:admins` with role `admin` — in REST strings:
`create("team:admins/admin")`, `read("team:admins/admin")`, and so on.
If the picker in the Console version in front of you cannot express a
team-role restriction, set the permissions to `team:admins` and record
that moderators can technically read this collection in a direct API
call; the audit content is low-sensitivity and all writes go through
Functions. Do not loosen it to `users`/`any` under any circumstances.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `admin_id` | string | 36 | No | — | |
| `action` | string | 128 | Yes | — | Free text in SQL. |
| `target_type` | string | 32 | No | — | |
| `target_id` | string | 36 | No | — | |
| `details` | string | 2000 | No | `"{}"` | JSON-encoded object, as in §5.13. |

Indexes: `admin_idx` — key — [`admin_id`].

### 5.15 `user_preferences` — Document/row security: ON

Source: `user_preferences` (0001 + the five `allow_*` / `view_follow_list`
additions). **Document `$id` = the Auth user ID** (one row per user,
mirroring the SQL primary key on `user_id`). Upserts in the app target
that ID directly.

Collection-level permissions — **create:** `create("users")`;
**read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | Always equal to the document `$id`. Kept as an attribute so queries filter on it. |
| `category_ids` | string array | 64 per element | No | `[]` | Array attribute. Stores category **slugs** (J4). Discover-page preference only since 2026-11-03; the upload flow no longer reads or writes it. |
| `notify_likes` | boolean | — | No | `true` | |
| `notify_comments` | boolean | — | No | `true` | |
| `notify_follows` | boolean | — | No | `true` | |
| `allow_comment` | enum | `everyone`, `followers`, `nobody` | No | `everyone` | SQL had no CHECK on these five columns; the enum values are taken from the values the app actually reads/writes. Stricter than SQL, matches the app. |
| `allow_mention` | enum | `everyone`, `followers`, `nobody` | No | `everyone` | |
| `allow_like` | enum | `everyone`, `followers`, `nobody` | No | `everyone` | |
| `allow_download` | enum | `everyone`, `followers`, `nobody` | No | `everyone` | |
| `view_follow_list` | enum | `everyone`, `followers`, `nobody` | No | `everyone` | |

Indexes: `user_unique` — unique — [`user_id`].

Document-permission template: read `read("user:OWNER")`; update
`update("user:OWNER")`; delete `delete("user:OWNER")`. Strictly
owner-only. Note a deliberate consequence: `getAllowPrefs` in the live
store reads *another* user's preferences to enforce like/comment/mention
gates — under owner-only permissions that read fails for other users.
The implementation workers must move those gate checks into the `api`
function (which reads preferences with the API key) or accept the app
defaulting to `everyone` when the read is denied. This spec does **not**
open preferences to public read to preserve the gate: preference values
are private settings. Record the chosen handling in the implementation
handoff; do not silently widen this collection.

### 5.16 `watch_history` — Document/row security: ON

Source: `watch_history` (composite PK). Collection-level permissions —
**create:** `create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `video_id` | string | 36 | Yes | — | |
| `watched_at` | datetime | — | Yes | — | Upsert semantics: the app upserts on `(user_id, video_id)` refreshing `watched_at`. Appwrite has no upsert-by-query: the client queries for the existing row, updates it if found, creates it if not. The unique index makes a race create fail with 409 — treat 409 as "row exists, update it". |

Indexes: `watch_unique` — unique — [`user_id`, `video_id`].

Document-permission template: read `read("user:OWNER")`; update
`update("user:OWNER")`; delete `delete("user:OWNER")`.

### 5.17 `account_events` — Document/row security: ON

Source: `account_events`. Collection-level permissions — **create:**
`create("users")`; **read:** none at collection level (document
permissions decide); **update / delete:** none (the SQL design has no
update/delete policy at all — events are append-only and owner-readable).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `type` | string | 64 | Yes | — | Free text in SQL. |
| `detail` | string | 1000 | No | `""` | |

Indexes: `user_idx` — key — [`user_id`].

Document-permission template: read `read("user:OWNER")`; update: none;
delete: none.

### 5.18 `verification_requests` — Document/row security: ON

Source: `verification_requests`. Collection-level permissions —
**create:** `create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `full_name` | string | 80 | No | `""` | |
| `category` | string | 64 | No | `Creator` | Free text in SQL (default `Creator`). |
| `note` | string | 300 | No | `""` | |
| `payment_method` | string | 32 | No | `JazzCash` | |
| `payment_tid` | string | 128 | No | `""` | Transaction ID; the app requires ≥ 6 chars (client validation). |
| `status` | enum | `pending`, `approved`, `rejected` | No | `pending` | Clients may only create `pending`. Decisions are an `api` action. |
| `decided_at` | datetime | — | No | — | Set by the decision action. |
| `decided_by` | string | 36 | No | — | Moderator/admin Auth ID. |

Indexes: `user_status_idx` — key — [`user_id`, `status`];
`status_idx` — key — [`status`].

Document-permission template: read `read("user:APPLICANT")`,
`read("team:admins")`; update `update("team:admins")`; delete
`delete("team:admins")`. The one-pending-request rule (app checks for an
existing `pending` row before filing) has no schema enforcement — the
`api` decision flow and client check carry it; a duplicate pending row
created by a direct API call is possible and harmless (both stay
pending; deciding one leaves the other, which the admin queue will
still show — noted in §11).

### 5.19 `messages` — Document/row security: ON

Source: `messages` (`sender_id <> recipient_id` CHECK). Collection-level
permissions — **create:** `create("users")`; **read / update / delete:**
none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `sender_id` | string | 36 | Yes | — | |
| `recipient_id` | string | 36 | Yes | — | Self-message is rejected by client validation only (no server CHECK; §10). |
| `body` | string | 1000 | Yes | — | 1–1000 chars; empty/long rejected by client validation. |
| `is_read` | boolean | — | No | `false` | |

Indexes: `pair_idx` — key — [`sender_id`, `recipient_id`];
`recipient_read_idx` — key — [`recipient_id`, `is_read`].

Document-permission template (the sender MUST attach these exact
permissions at creation; the client SDK must pass them explicitly —
default creator-only permissions would hide the message from the
recipient): read `read("user:SENDER")`, `read("user:RECIPIENT")`; update
`update("user:RECIPIENT")` (mark-read only; the recipient is the only
updater, mirroring SQL); delete: none. Same grant caveat as §5.10 for the
recipient grant — verify in the first live run; if a sender cannot grant
read to the recipient directly, message sending moves to the `api`
`notify`-style action and this collection's create becomes none.

### 5.20 `comment_likes` — Document/row security: ON

Source: `comment_likes` (composite PK, 0003). Collection-level
permissions — **create:** `create("users")`; **read:** `read("any")`;
**update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `comment_id` | string | 36 | Yes | — | |
| `user_id` | string | 36 | Yes | — | |

Indexes: `comment_like_unique` — unique — [`comment_id`, `user_id`].

Document-permission template: read `read("any")` (mirrors SQL select
`using (true)`; the app counts likes per comment from these rows);
update: none; delete `delete("user:OWNER")`. Comment like counts are
computed by counting rows client-side (the app already does this) — no
counter attribute exists on `comments` in SQL, and none is added here.

### 5.21 `poll_votes` — Document/row security: ON

Source: `poll_votes` (composite PK, `choice in (0,1)`). Collection-level
permissions — **create:** `create("users")`; **read:** `read("any")`;
**update / delete:** none at collection level.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `video_id` | string | 36 | Yes | — | |
| `user_id` | string | 36 | Yes | — | |
| `choice` | integer | min `0`, max `1` | Yes | — | Attribute bounds enforce the SQL CHECK. |

Indexes: `poll_vote_unique` — unique — [`video_id`, `user_id`].

Document-permission template: read `read("any")` (mirrors SQL select
`using (true)`; vote tallies are computed from these rows); update
`update("user:OWNER")` (re-vote changes choice — the app upserts on the
pair key; Appwrite equivalent is query-then-update, 409 = exists);
delete `delete("user:OWNER")`.

### 5.22 `stories` — Document/row security: ON

Source: `stories` (0003). Collection-level permissions — **create:**
`create("users")`; **read / update / delete:** none (document
permissions decide, as with `videos`).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `user_id` | string | 36 | Yes | — | |
| `media_type` | enum | `image`, `video` | Yes | — | |
| `storage_path` | string | 512 | Yes | — | Appwrite file `$id` in the `media` bucket (§7), not a path. |
| `caption` | string | 200 | No | `""` | |
| `duration_seconds` | double | — | No | — | Null for images. No 20.5s cap in SQL for stories — none here either. |
| `moderation_status` | enum | `pending`, `approved`, `rejected` | No | `pending` | No `draft` status for stories in SQL. Only Functions/moderators change this. |

Indexes: `user_status_idx` — key — [`user_id`, `moderation_status`];
`status_idx` — key — [`moderation_status`].

Document-permission templates (mirror `videos` §5.3, minus drafts):
**pending/rejected** — read `read("user:OWNER")`,
`read("team:admins")`, update/delete owner + team. **Approved** — read
`read("any")`, update/delete owner + team; the flip happens only inside
the `api` story-moderation action together with the story file flip
(§7). **24-hour expiry is a query filter, not a permission:** the feed
queries `moderation_status = approved` AND `$createdAt` within the last
24 hours. An approved story older than 24h remains readable by direct
document ID — Appwrite has no time-based permission expiry. This is a
stated gap (§11, R3); a future 5th function on a schedule could flip old
stories back, but none is specified here. (2026-11-04: no function
slot exists for this under the Free 2-function limit — see §8.)

### 5.23 `story_views` — Document/row security: ON

Source: `story_views` (composite PK, 0003). Collection-level permissions
— **create:** `create("users")`; **read / update / delete:** none.

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `story_id` | string | 36 | Yes | — | |
| `user_id` | string | 36 | Yes | — | |

Indexes: `story_view_unique` — unique — [`story_id`, `user_id`].

Document-permission template: read `read("user:OWNER")`; update: none;
delete `delete("user:OWNER")`. Strictly owner-only (SQL `story_views_own`).
`viewed_at` is dropped — `$createdAt` covers it (§5 global rules).

### 5.24 `sounds` — Document/row security: ON (added 2026-11-03, sounds library)

Source: none — NEW collection (judgment call J13, extended by J14
2026-11-03). The client implementation strictly requires
structured metadata storage for owner-added sounds: the live store
reads/writes this collection directly (`listSounds` / `addSound` /
`deleteSound`), and the setup comment in the client names this
spec as the backing for the `sounds` table + `media` bucket. The
built-in catalog is an empty client-side array; every owner-added,
user-added, and auto-registered original sound is a row here plus
an audio file in the `media` bucket (§7.3). Collection-level
permissions — **create:** `create("users")`; **read / update /
delete:** none (document permissions decide).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `title` | string | 80 | Yes | — | Sound title shown in the library and on videos using the sound. The client rejects an empty title. |
| `category` | enum | `sound-effects`, `naat`, `taqreer`, `islamic`, `original` | Yes | — | Library tab. `original` is auto-registered original sounds ONLY (§7.3); client add-sound forms must not offer it, and `create-sound` rejects it. No music category exists. |
| `duration_seconds` | double | min `0` | No | — | Display metadata only; video duration enforcement (20.5s) never reads this. |
| `storage_path` | string | 512 | Yes | — | Appwrite file `$id` in the `media` bucket (audio file), or a playable URL. The client rejects an empty path. For original sounds, the source video's file `$id`. |
| `source` | string | 120 | No | — | Source/license note shown next to the sound (e.g. a CC0/public-domain note, or "Added by the owner"). Client supplies it sliced to 120 chars. Original sounds carry "Original sound from video". |
| `creator_id` | string | 36 | No | — | Auth user `$id` of the adder (user/staff) or, for originals, the video creator. Set by Functions only; never accepted from a caller body. |
| `source_type` | enum | `admin`, `user`, `original` | No | — | `admin` = team staff via `create-sound`; `user` = signed-in user via `create-sound`; `original` = auto-registered by `create-upload`. Set by Functions only. |
| `video_id` | string | 36 | No | — | Source video `$id` for original sounds only; null for library sounds. Deduped by `create-upload` via the `video_id_idx` index. |
| `status` | enum | `live`, `removed` | No | `live` | Removal is a status flip, not a deletion: staff `remove-sound` sets `removed`; row and audio file are kept. Clients list `live` sounds only. |
| `report_count` | integer | min `0` | No | `0` | Best-effort count incremented by `report-sound`. Display/triage only; never auto-hides a sound. |

Indexes: `category_idx` — key — [`category`]; `video_id_idx` —
key — [`video_id`] (key index, deliberately NOT unique: most rows
carry a null `video_id`, and unique-index behaviour over nulls must
not block library rows; duplicates are prevented by the
`create-upload` video_id lookup, not by the index).

Document-permission template (set by the client on creation, exactly
as the live store sends it): read `read("any")`; update
`update("team:admins")`; delete `delete("team:admins")`. Reads are
public so any viewer can list and play catalog sounds; only the team
can change or remove a row through permissions.

**Honest content + R7 SUPERSEDED — read before creating any row.**
Rows must only be created for audio the owner owns or has rights to;
Sound Effects rows only for verified CC0/public-domain effects with
the license in `source`; Naat/Taqreer rows only once the owner
supplies audio (§7.3). And: **R7 is SUPERSEDED by the owner decision
of 2026-11-03 (~23:35): users CAN add sounds, direct-to-library, NO
admin approval; violations are removed via report + strike.** Any
signed-in user creating a `sounds` row is now INTENTIONAL, not a
risk to close — do not "fix" it by restricting creation. The
function-gated flow is `create-sound` (§8.1, signed-in, live at
once, `source_type` `user` or `admin`); removal is `report-sound`
+ staff `remove-sound`, which flips `status` to `removed` without
deleting the row or its file. The collection `create("users")`
grant remains, so a direct client create is still possible; rows
so created lack the function-set fields (`creator_id`,
`source_type`, `status`, `report_count` default) and must be
treated as user-added. Deleting a row does NOT delete its audio
file, and deleting a file does not remove the row — no cascade
exists; the admin removes both by hand if needed.

---

## 6. The two views — NOT collections: `public_profiles` collection + query patterns

Supabase had two views. Appwrite has no views. They are replaced
differently, and the difference matters:

### 6.1 `public_profiles` — a REAL collection, synced by a Function (decision J6)

**Recommendation (a) from the brief is adopted: a separate
`public_profiles` collection, synced by the `events` Function.** Option
(b) — document permissions on `profiles` that "hide" `role` /
`is_suspended` — is not acceptable and is not used: Appwrite permissions
are per-document, not per-attribute. Any guest who can read a profile
document can read *all* of its attributes, including `role` and
`is_suspended`. A synced public copy is the only Appwrite-native way to
expose a subset of fields publicly.

Create it inside database `tokisla`, **Document/row security: OFF**.
Collection-level permissions — **read:** `read("any")`;
**create / update / delete:** none (leave unchecked). Only Functions
with the API key write here. **Document `$id` = the Auth user ID**
(same as `profiles`).

| Key | Type | Size / elements | Required | Default | Notes |
|---|---|---|---|---|---|
| `username` | string | 32 | Yes | — | Mirrors `profiles.username`. |
| `display_name` | string | 60 | No | `""` | |
| `bio` | string | 160 | No | `""` | |
| `avatar_url` | string | 2048 | No | — | |
| `website` | string | 200 | No | `""` | |
| `verified` | boolean | — | No | `false` | ★ Added beyond the SQL view (see note). Synced ONLY by the `api` decide-verification action — never by the profile-sync event. |
| `private_account` | boolean | — | No | `false` | ★ Added beyond the SQL view (see note). Synced by the profile-sync event (it is a display/feed-filter field, not a secret). |

Indexes: `username_unique` — unique — [`username`];
`username_search` — fulltext — [`username`].

**Fields that are NEVER synced here:** `role`, `is_suspended`, and any
email (email lives in Auth, never in `profiles`). If either field ever
appears in this collection, that is a security bug — the §10 checklist
tests for it.

**Sync function + triggers (implemented in `events`, §8):**

- On `profiles` **create** → create the `public_profiles` document with
  the seven fields above copied from the new profile. If the profile is
  created suspended (`is_suspended = true` — only possible via Function
  creation), create nothing.
- On `profiles` **update** → if the new profile has
  `is_suspended = true`, **delete** the `public_profiles` document; if
  `is_suspended = false`, upsert it copying ONLY `username`,
  `display_name`, `bio`, `avatar_url`, `website`, `private_account`
  (never `verified`, never `role`, never `is_suspended`).
- On `profiles` **delete** → delete the `public_profiles` document.
- `verified` is written to `public_profiles` ONLY by the `api`
  decide-verification action, in the same call that writes
  `profiles.verified`. This is what stops a user who tampers with their
  own `profiles.verified` (residual risk R1) from gaining a blue tick:
  the sync event deliberately ignores `verified`, so the tampered value
  never reaches the public copy.

**Tradeoff, stated plainly.** The public copy is eventually consistent,
not transactional: between a profile edit and the `events` Function
running, `public_profiles` shows stale data (typically seconds). A
username change also has a rename race: the unique index on
`public_profiles.username` can reject the sync upsert if another user
took the name in between — the sync function must then leave the old
public document in place and log the conflict for an admin to resolve
manually; it must never delete the public document on a sync failure.
Suspended users vanish from public reads only after the sync (or the
suspend action, which deletes the public document synchronously —
preferred, §8) runs. These are accepted costs of the only design that
keeps `role`/`is_suspended` out of guest hands. The alternative —
serving public profiles through a Function on every read — was rejected
because the app reads public profiles on nearly every screen and the
Free plan's function budget and latency do not support it.

**Why `verified` and `private_account` are in the public copy although
the SQL `public_profiles` view omitted them:** the live app already
reads both from public-profile rows — `app.js` renders the blue tick
from `public_profiles` rows in people/profile lists and renders the
private-account lock from `getProfile` (which reads `public_profiles`).
Under raw Supabase those reads returned `undefined` (the view never
selected the columns), so the tick/lock silently never showed on those
screens in live mode. Including them here restores the app's intended
behaviour. `verified` is low-sensitivity (it is a public badge by
definition) and `private_account` is a single boolean the UI already
treats as public. This is a deliberate, documented deviation from the
SQL view (G3).

### 6.2 Query pattern for `public_videos` (guest-first feed)

There is no `public_videos` collection. The implementation workers
reproduce the view with this exact client-side sequence (the app's
`feed`, `profileVideos`, `savedVideos`, `likedVideos`, `trending`,
`search`, `hashtagVideos` all read `public_videos` today):

1. **Base query** on `videos`: `moderation_status = "approved"` AND
   `visibility = "public"`, ordered by `published_at` descending
   (fallback `$createdAt` descending when `published_at` is empty),
   limit 30 (over-fetch to 50 when post-filtering, see step 3).
   Guests (no session) run the same query — `read("any")` on approved
   public video documents permits it. **This query is unchanged by
   direct publish (2026-11-03):** it already selects the exact live
   status, and `create-upload` now writes `approved` + `published_at`
   + public file permissions at creation, so a new post matches it
   immediately with no admin action and no query change.
2. **Join in the client:** collect the distinct `creator_id`s, fetch
   their `public_profiles` documents, and merge `username`,
   `display_name`, `avatar_url`, `verified` onto each video (this
   reproduces the SQL `JOIN profiles` columns, including the 0003
   `p.verified`).
3. **Post-filters, in the client, in this order** (these are the view's
   `WHERE` clauses that Appwrite cannot express as a join):
   - Drop any video whose creator has **no** `public_profiles` document
     → reproduces `p.is_suspended = false` (suspended creators have no
     public document, §6.1).
   - **Private-account rule:** if the creator's `private_account` is
     true and the viewer is not the creator, keep the video only if a
     `follows` document exists with `follower_id = viewer` and
     `following_id = creator`. For guests there is no viewer: drop all
     private-account creators' videos. (SQL: `private_account = false
     OR creator = auth.uid() OR EXISTS (follows …)`.)
   - **Blocked rule** (app-level, from the demo store's
     `approvedVisible`): drop videos whose creator the viewer blocked.
     The SQL view did not encode blocking; the app's demo behaviour
     did. Keep the app behaviour.
   - The **following feed** (`kind = "following"`): query `follows`
     first for the viewer's `following_id` list, then add
     `creator_id IN (…)` to the base query. An empty following list
     returns an empty feed without querying `videos`.
4. **Playback URLs** are built only from `storage_path` file IDs whose
   files carry `read("any")` (§7). A tampered video document
   (status flipped client-side, §11 R2) still has an owner-only file,
   so playback fails even if the row leaks into a list.

### 6.3 Query pattern for `public_profiles`

Query the `public_profiles` collection directly: by `$id` for
`getProfile`, by `username` equality for `usernameAvailable` /
`profileByUsername`, by fulltext search on `username` for user search,
list with limit for `people`. Never query the `profiles` collection for
another user's data — the document permissions forbid it, and any code
that tries will fail for non-team users by design. The owner's own
full profile comes from `profiles` with `$id = own Auth ID`
(`currentUser`, `accountDetails`).

---

## 7. Storage — 2 buckets planned, 1 allowed (Free limit VERIFIED 2026-11-04)

**CORRECTION (live Console, 2026-11-04): the Free plan allows 1 bucket per
project, not 3.** The Console banner after creating `media` reads:
"You've reached the limit of 1 buckets. Your plan (Free) includes up to
1 buckets." The "3 buckets" figure in the May 2026 pricing source is
outdated. **Do NOT upgrade for this.** Only the `media` bucket exists;
the `avatars` bucket is NOT created. Avatar files, if an upload flow is
ever added, go in `media` with the `avatars-` name prefix and
read-`any` / update-delete owner-only file permissions — no code change
today, because the app stores `avatar_url` as a URL string and has no
avatar-upload path (§7.2).

Supabase had 4 private buckets (`videos`, `thumbnails`, `avatars`,
`stories`). Appwrite Free allows 3. Consolidation (decision J7):

| Appwrite bucket | Holds (Supabase origin) | ID |
|---|---|---|
| `media` | videos (`videos`) + thumbnails (`thumbnails`) + stories (`stories`) + sounds-library catalog audio (§7.3) | `media` |
| `avatars` | avatars (`avatars`) — future use; see note | `avatars` |
| *(spare — do not create)* | — | — |

**There are no folders in Appwrite Storage.** The brief's path prefixes
(`videos/<uid>/<id>.<ext>`, `thumbnails/<uid>/<id>.jpg`,
`stories/<uid>/<id>…`) cannot be expressed as storage paths: a file is
identified by bucket + file `$id`, and its display `name` is metadata.
Prefix discipline is therefore a **naming convention for the file's
`name`** (e.g. `videos-<uid>-<videoId>.mp4`,
`thumbnails-<uid>-<videoId>.jpg`, `stories-<uid>-<storyId>.mp4`) used
for human browsing in the Console. **Enforcement never depends on the
name.** Enforcement is per-file permissions (§7.1) plus the document
record in `videos`/`stories`. Implementation workers must store the
file `$id` in `storage_path`/`thumbnail_path` and must never parse a
path prefix out of a name to decide access.

### 7.1 `media` bucket

Console path: left menu **Storage** → **Create Bucket**.

1. **Bucket ID:** type exactly `media`. **Name:** `Media`.
2. **File security:** **ON** (labelled "File security" / per-file
   permissions in the bucket Settings). This is mandatory: with file
   security off, bucket-level permissions would govern every file and
   pending videos could not be kept private. Verify the toggle reads ON
   after saving.
3. **Bucket-level permissions:** **create:** `create("users")`;
   **read / update / delete:** none (leave unchecked). With file
   security ON, file-level permissions govern reads/updates/deletes;
   the bucket create entry is what lets a signed-in client upload a
   file before `create-upload` validates it (flow in §8). If the
   Console forces a read entry, leave it empty and verify with the
   §12 file-privacy test — a guest must NOT be able to download a
   draft or removed (rejected) video file.
4. **Maximum file size:** `26214400` bytes (25 MiB — the SQL ceiling).
   The app's own cap is stricter (15 MB in `config.js`); the bucket
   ceiling is the backstop, not the user-facing limit.
5. **Allowed file extensions:** `mp4`, `mov`, `webm`, `jpg`, `jpeg`,
   `png`, `webp`, `gif`, plus audio `mp3`, `m4a`, `wav`, `ogg` (added
   2026-11-03 for sounds-library catalog audio, §7.3 — no other
   audio handling exists; there is no music anywhere). (Videos +
   thumbnails + story images/videos + catalog audio. Leave any
   "allowed file types" / antivirus / image-transformation settings
   at their defaults; do not enable anything the owner has not asked
   for.)
6. Leave encryption/compression settings at defaults.

**File-permission templates — the heart of the storage design.** Files
do not inherit readability from their video/story document; they carry
their own permissions, set and flipped only by Functions holding the
API key. The client upload (step 1 of the §8 flow) creates the file
with owner-only permissions; the Function then normalises them.

| File kind / state | Read | Update | Delete |
|---|---|---|---|
| Video file, `draft`/`needs_review`/`rejected` (not live) | `read("user:CREATOR")`, `read("team:admins")` | `update("user:CREATOR")`, `update("team:admins")` | `delete("user:CREATOR")`, `delete("team:admins")` |
| Video file, `approved` + `visibility = public` | `read("any")` | as above | as above |
| Video file, `approved` + `followers`/`private` | creator + team only (as not-live row) | as above | as above |
| Thumbnail file | **Identical to its video's row above**, flipped in the same `create-upload` / publish-draft / moderation call | as above | as above |
| Story file, `pending`/`rejected` | `read("user:OWNER")`, `read("team:admins")` | owner + team | owner + team |
| Story file, `approved` | `read("any")` | owner + team | owner + team |
| Sound file (sounds-library catalog audio, §7.3) | `read("any")` | `update("user:OWNER")`, `update("team:admins")` | `delete("user:OWNER")`, `delete("team:admins")` |

**What Appwrite bucket permissions can and cannot enforce — stated
honestly:**

- CAN: per-file read/update/delete for `any` / `users` / a specific
  user / a team (with file security ON). This is sufficient for the
  live-vs-not-live distinction, because the flip is a permission
  change on the file itself.
- CANNOT: "readable only if the matching video document is approved",
  "readable only by followers", "readable only for 24 hours", or
  path-prefix rules. Those are document/query rules (§6) and remain
  the client's and Functions' job. A guest who somehow learns an
  approved file's ID can download it directly (that is what `any`
  read means, and it is what the public feed needs). A guest who
  learns a *draft or removed* file's ID cannot — the file permission denies
  them. Signed/preview URLs: Appwrite file view/download URLs respect
  the same file permissions; there is no separate signed-URL mechanism
  that adds security beyond the file permission, and the old Supabase
  `createSignedUrl` calls in `storiesFeed` must be replaced by plain
  file-view URLs built from bucket + file ID (implementation workers'
  job). Do not present file URLs as "signed" or "expiring" — they are
  not.
- **Suspend/unsuspend flips:** the `api` suspend action sets every
  approved+public video file and story file of that creator back to
  creator+team-only read (mirroring the SQL view hiding suspended
  creators). Unsuspend flips approved+public files back to `any` read.
  Both actions also delete/recreate the `public_profiles` document
  synchronously (§6.1), so discovery and playback stay consistent
  without waiting for the sync event.

### 7.2 `avatars` bucket — NOT CREATED (Free limit is 1 bucket, verified 2026-11-04)

The `avatars` bucket was NOT created: the Free plan allows only 1 bucket
per project (see §7 header), and `media` uses that slot. Do not upgrade
for this bucket. If an avatar-upload flow is ever added, its files go in
the `media` bucket with the `avatars-` name prefix, read `any`,
update/delete owner-only, and the `avatar_url` attribute stores the
file-view URL — the same shape the app already uses.

**Note on current app behaviour:** the app today stores avatar URLs
only — `avatar_url` is a URL string typed/pasted in profile editing,
and there is **no client avatar-upload path** (no Supabase Storage
avatar upload is invoked from the live store; the `avatars` bucket's
write policy in 0002 was effectively unused by the app). Keep this
bucket for future use exactly as specified, and document that no
implementation worker should invent an avatar-upload flow from this
spec alone. If one is added later, files use read `any`, update/delete
owner-only, and the `avatar_url` attribute stores the file-view URL.

### 7.3 Sounds library — catalog + `sounds` collection + `media` bucket (2026-11-03)

**Decision (owner order, judgment calls J13/J14): the sounds library is
catalog-driven, backed by the `sounds` collection (§5.24) and the
`media` bucket. A new collection WAS added** — because the client
implementation strictly requires structured metadata storage for
owner-added sounds (the live store reads/writes the `sounds`
collection directly). **User-added sounds (2026-11-03, owner order)
go direct-to-library with NO admin approval** — R7 is superseded;
see "User-added sounds" below. Catalog writes ARE function-gated
now (`create-sound` / `remove-sound`, §8.1); do not silently add
further write paths from this spec.

- **Catalog.** Three parts, concatenated by `listSounds` and
  deduped by `id`: (1) the built-in catalog, an empty client-side
  array (deliberately empty: no naat/taqreer audio exists in the
  workspace and no copyrighted audio may be bundled or invented);
  (2) the catalog file at the ONE fixed path
  **`sounds-catalog.json`** (app root, next to `index.html` /
  `store.js`; a JSON array of entries shaped `id`, `title`,
  `category`, `duration_seconds`, `src`, `source` — it ships
  EMPTY, `[]`, and nothing is ever downloaded, copied, or seeded
  from staging/research material into it; `listSounds` fetches it
  lazily on first library open and falls back silently to the
  empty inline catalog when it is absent, fails, or is malformed,
  so demo mode and honest empty states keep working); (3) the
  `sounds` collection rows (owner-added, user-added, and
  auto-registered original sounds). Entry shape:
  `id`, `title`, `category`, `duration_seconds`, `src` (from
  `storage_path`: a media-bucket file id resolved to a file-view
  URL, or a playable URL), `source` (license/rights note).
  Collection rows additionally carry `creator_id`, `source_type`
  (`admin`/`user`/`original`), `video_id` (originals only),
  `status` (`live`/`removed`), and `report_count`; the client
  lists `live` rows only — `removed` rows never appear in the
  library. Tabs:
  **Sound Effects**, **Naat**, **Taqreer**, **Islamic** (other
  Islamic audio), plus **Original** (auto-registered original
  sounds only; never offered as a choice in add-sound forms). **Sounds are streaming-only:** they play inside
  the library (streaming preview) and are then used in the video
  being created — there is no download button, downloadable link,
  or save affordance for sound files anywhere in the UI, and live
  sound files are served for streaming playback through the
  `media` bucket (file-view URL), never exposed as downloads.
  **Original audio stays the default** — "Add sound" on the edit
  screen is an optional choice from the catalog, never a
  requirement. **No music anywhere**, in any tab, in any function,
  or in any catalog entry.
- **User-added + admin-added sounds (live, direct-to-library).**
  Any signed-in user (and staff, from the Admin panel Sounds tab)
  may add a sound with NO approval step: fill title + category
  (Sound Effects / Naat / Taqreer / Islamic — never Original) +
  source note, choose an audio file. The client (1) uploads the
  file to the `media` bucket with file permissions `read("any")`
  + team update/delete (§7.1 sound-file row), then (2) calls the
  `api` action `create-sound` (§8.1) with `title`, `category`,
  `storage_path` = the file `$id`, and optional
  `duration_seconds` / `source`. The function validates, forces
  `creator_id` to the caller, sets `source_type` to `admin` for
  team staff else `user`, and creates the row `live` at once with
  the §5.24 document-permission template — the sound is in the
  library immediately. The audio file's 25 MiB bucket ceiling
  applies. `creator_id` / `source_type` / `status` sent by a
  caller are ignored. Removing a sound is staff-only (see below);
  a user deleting their own row directly is not a supported flow.
- **Original sounds (auto-registered).** A video posted with no
  library sound chosen (original audio) gets a `sounds` row
  automatically: `create-upload` best-effort creates it after the
  live video row exists — category `original`, `source_type`
  `original`, `video_id` = the video `$id`, `storage_path` = the
  video's file `$id`, title `Original sound — @<username>` (or
  `Original sound` when the username lookup fails), `source`
  `Original sound from video`, `status` `live`. A `video_id`
  lookup first skips registration when a row already exists, so
  an original is never duplicated; registration never fails the
  upload. Drafts are skipped. Original rows appear under the
  **Original** tab and can be picked like any catalog sound; the
  client maps them to the stable client id
  `original-<videoId>` (see MIGRATION_NOTES.md §10).
- **Report + staff remove (post-moderation, no auto-hide).** Any
  signed-in user may report a sound via `api` `report-sound`
  (`sound_id`, `reason` ≤ 500 chars): a `reports` row with
  `target_type` `sound` is created and the row's `report_count`
  is incremented best-effort. The reported sound STAYS visible.
  Staff remove it via `api` `remove-sound` (`sound_id`, optional
  `reason`): the row's `status` flips to `removed` and an
  `admin_actions` row is written best-effort. Neither the row nor
  its audio file is deleted — delete the audio file separately
  if it must go too.
- **Demo mode.** Admin-added sounds persist locally, client-side
  (localStorage data URLs; the client caps demo audio files at
  8 MB). Nothing in this spec creates a server catalog for demo
  mode.
- **Honest content constraint — read this before adding any audio.**
  No naat/taqreer audio exists in the workspace, and no copyrighted
  audio may be bundled or invented. The **Naat** and **Taqreer**
  tabs ship with honest empty states until the owner adds audio he
  owns or has rights to. The **Sound Effects** tab may be seeded
  ONLY with verified CC0/public-domain effects, at most a few, with
  the license noted in the catalog entry's `source` — as of this
  spec change no such seed is verified or recorded here; if the
  client worker seeds any effect, its license note must be recorded
  in the `sounds` row itself. An empty tab is correct behaviour,
  not a bug.
- **Per-video choice.** When a creator picks a library sound, the
  live store sends `sound_id` / `sound_title` / `sound_category`
  to `create-upload`, which stores them on the video row (§5.3) —
  opaque, not validated against the `sounds` collection. The feed
  renders the sound title from the video row. The post-screen
  extras (`trim_start_seconds`, `trim_end_seconds`,
  `content_disclosure`, `link_url`) are stored on the video row by
  `create-upload` (2026-11-03 fix-up, §5.3): the Crop/Trim range
  drives feed playback, and the disclosure flag and link survive
  live exactly as in demo mode.
- **Enforcement.** Selecting a sound does not change video
  enforcement: the 20.5-second / 25 MiB limits in `create-upload`
  apply to the uploaded video file. Catalog sound `duration_seconds`
  is display metadata only. The §12 checklist verifies the library
  (tabs render, including Original; empty states show; a user
  add-sound goes live at once with no approval; an original sound
  auto-registers on publish; report + staff remove hides a sound;
  no download affordance; the chosen
  sound persists on the video, selection does not break the
  20-second limit or direct publish).

---

## 8. Functions — 2 of 2 (Free limit VERIFIED 2026-11-04)

**CORRECTION (live Console, 2026-11-04): the Free plan allows 2
functions per project, not 5.** The Console banner reads: "You've
reached the limit of 2 functions. Your plan (Free) includes up to
2 functions." (Appwrite changelog 2026-01-08: the Free function
limit was reduced from 5 to 2.) **Do NOT upgrade for this, and do
NOT create a 3rd or 4th function.** The design is now 2 functions:
`api` (HTTP — all synchronous actions, including `create-upload`
and `delete-account`, merged into `api` as actions on 2026-11-04)
and `events` (database events, unchanged). The former standalone
`create-upload` and `delete-account` functions must NOT be created
in the Console; their contracts live on as `api` actions in §8.1,
§8.3, and §8.4 below, and their code is retained as history in
`functions/create-upload/index.js` /
`functions/delete-account/index.js`. There is no spare function
slot.

Runtime (verified against the Appwrite runtimes docs page on 2026-11-02):
**Node.js `node-22`**. (`node-20.0` also exists; `node-22` is the
current unversioned Node.js line shown on the Functions product page and
is preferred. If the Console in front of you does not offer `node-22`,
pick `node-20.0` and record the substitution — do not pick an older or
deprecated runtime.)

Console path for each function: left menu **Functions** → **Create
Function**. For each: **Function ID** = the ID below (custom ID, typed
exactly), **Name** = the same string, **Runtime** = `node-22`,
**Entrypoint** = `index.js` (the deployed layout in `functions/`;
NOT the template default `src/main.js` — see the entrypoint note in
`functions/README.md`), **Build command:** none beyond the template
default (`npm install` — the code depends only on `node-appwrite`),
**Execute permissions:** as listed per function. **Variables** (Function
→ Settings → Variables, set on EVERY function, values from §2 — never
hardcode, never commit): `APPWRITE_ENDPOINT` =
`https://sgp.cloud.appwrite.io/v1`, `APPWRITE_PROJECT_ID` =
`6ae910e6000dad2f34b4`, `APPWRITE_API_KEY` = the §2 key (mark the
variable secret/hidden where the Console offers it). The database ID
`tokisla` is a constant in code, not a secret. **Timeouts** as listed.

**Why 2 functions, not 7 (judgment call J8, as corrected 2026-11-04).** The brief's naive count
— create-upload, delete-account, 3 RPCs, sync-counters, profile-sync —
is 7 logical units against a 2-function Free budget. Combining is
mandatory. The combination below groups by *trigger and trust model*,
not by feature name: synchronous user actions that need an immediate
answer share one HTTP function (`api`); asynchronous reactions to
database changes share one event function (`events`). Upload and
account-deletion are actions inside `api` (their contracts — file
handling; Auth-user deletion + cascade — are distinct, long-running,
and fail independently of the other actions only in the sense that a
failed action returns its own error envelope; a bad `api` deploy
breaks all actions at once, which is the accepted cost of the
2-function limit). No slot is left spare: a future scheduled cleanup
(e.g. expired-story flipping) would need a paid plan or a
re-architecture, and must not be created by deleting either live
function.

**Authentication inside Functions.** Every HTTP function reads the
caller's JWT from the `x-appwrite-user-jwt` header (SDK executions
carry the session) and resolves the caller via the Users API; anonymous
calls are rejected. Team membership is checked with the API key via the
Teams API — never from `profiles.role`, never from a client-supplied
flag. All database/storage writes inside Functions use the API key and
therefore bypass document/file permissions by design; that bypass is
why the ownership checks below must be coded, not assumed.

### 8.1 `api` — HTTP / execution trigger (the action router)

- **Function ID / Name:** `api`. **Trigger:** HTTP (execution) —
  **no** schedule, **no** database events.
- **Execute permission:** `execute("users")` (any signed-in user may
  call it; each action re-authorises internally). Guests get no execute
  permission.
- **Timeout:** 30 seconds.
- **Actions** (request body: `{ "action": "<name>", …params }` — one
  function, one deployment, shared auth/team-check helpers):

| Action | Replaces (Supabase) | Caller check inside the function |
|---|---|---|
| `create-profile` | Profile insert in `signUp` (+ signup edge behaviour) | Caller must be signed in; `documentId = callerId`; validates username format `^[a-z0-9_.]{3,24}$` + uniqueness (query `public_profiles`); forces `role="user"`, `is_suspended=false`, `verified=false`; attaches §5.1 template; idempotent (returns existing profile if already present). |
| `create-upload` | The only video-creation path (§8.3; **merged into `api` 2026-11-04** — no standalone function) | Signed-in caller; rejects suspended callers (including callers with no profile document) with 403. Request `{ "action": "create-upload", fileId, duration_seconds, size_bytes, ... }` (see §8.3 for aliases/fields). Validates duration `> 0` and `<= 20.5`, size `<= 26214400` (server-side file size is ground truth), caption/location/sound/visibility/filter/poll/duet/reply/trim/disclosure/link rules in §8.3; verifies the already-uploaded file exists and belongs to the caller (foreign file → 403, not deleted); on 400/403 deletes orphaned caller-owned file(s); creates the video live (`approved` + `published_at`, or `draft`), logs the `uploaded` event, handles @mentions and original-sound auto-register best-effort. Returns the created video document. |
| `delete-account` | Play Store account-deletion requirement (§8.4; **merged into `api` 2026-11-04** — no standalone function) | Signed-in caller; target always from the JWT, body ignored. Request `{ "action": "delete-account" }`. Cascade in §8.4 order: files first (failure → 500 before any document is deleted), per-video/per-story children, both-side references, SET NULL history rows (kept), own documents, Team `admins` removal, Auth user delete LAST. Returns `{ ok: true }` exactly. |
| `increment-view` | RPC `increment_video_view` | Any signed-in user, or guest? The app calls it for guests too — allow execution by `users` only and let guests skip it (view counting for guests is best-effort; the client must not fail the feed if the call is denied). Increments `view_count` by 1 **only if** the video's `moderation_status` is `approved` (mirrors the RPC's `WHERE` clause). Atomicity: read-then-write with the API key; concurrent views may occasionally lose one increment — accepted, matches the RPC's non-atomic update. |
| `publish-draft` | RPC `publish_draft` | Caller must own the video AND its status must be `draft`; sets status to `approved` (direct publish, 2026-11-03 — no `pending` step), sets `published_at`, and flips the document + video/thumbnail file permissions to the live template. Logs a `published` moderation event. |
| `set-comment-pin` | RPC `set_comment_pin` | Caller must own the video the comment belongs to; unpins all other comments on that video, then sets the target pin state (mirrors the RPC exactly, including "one pin per video"). |
| `moderate-video` | `adminDecide` + guard trigger | **Post-moderation only (2026-11-03).** Caller must be Team `admins` with role `admin` or `moderator`. Acts on live/reported videos after publication: `rejected` removes/hides the video, `needs_review` flags it, `approved` restores a removed/flagged video. Sets `moderation_status` / `rejection_reason` / `published_at` (set `published_at` on first approval if empty), inserts a `moderation_reviews` row, logs a `moderation_events` row, flips video + thumbnail file permissions per §7.1, and inserts a `moderation` notification for the creator. Never gates a new post. |
| `moderate-story` | `adminDecideStory` | Team admin/moderator. Sets story status + flips story file permissions per §7.1. |
| `moderate-comment` | Comment hide/remove (RLS update policy) | Team admin/moderator. Sets comment `moderation_status` + flips its document permissions (§5.7 templates). |
| `decide-verification` | `adminDecideVerification` | Team admin/moderator. Sets request `status`/`decided_at`/`decided_by`, and on approval sets `profiles.verified = true` AND `public_profiles.verified = true` in the same call, then inserts the `system` notification for the applicant. |
| `decide-report` | `adminSetReportStatus` | Team admin/moderator. Sets report `status` only. |
| `suspend-user` / `unsuspend-user` | `adminSetSuspended` | Team **admin** only (not moderator). Sets `profiles.is_suspended`, deletes/recreates the `public_profiles` document synchronously, and flips the creator's approved+public video/story files (§7.1). |
| `set-role` | The old SQL role update (owner setup, §3.3) | Team **admin** only. Sets `profiles.role` mirror AND requires the caller to have already created/removed the matching team membership — the function verifies the membership matches the requested role before writing the mirror, so mirror and truth cannot drift by this path. |
| `delete-video` | `deleteDraft` + creator delete | Caller must own the video or be Team admin/moderator. Deletes the video document, its `video_categories` / `video_likes` / `saved_videos` / `comments` (+ their `comment_likes`) / `poll_votes` rows, and its video + thumbnail files. (No cascade exists — this action IS the cascade.) |
| `notify` | **Fallback only** (§5.10) | Signed-in caller; creates a `notifications` document addressed to another user with the §5.10 template. Wired only if the §10 grant test fails. |
| `file-report` | **Fallback only** (§5.11) | Signed-in caller; creates a `reports` document with the §5.11 template. Wired only if the §10 grant test fails. |
| `check-allow-prefs` | Gate reads in `toggleLike` / `addComment` | Signed-in caller; reads another user's `user_preferences` with the API key and returns only the five `allow_*`/`view_follow_list` values (see §5.15 consequence). Returns defaults when no preferences row exists. |
| `create-sound` | **New (2026-11-03, J14; R7 superseded)** — user-added sounds | Signed-in caller. Request `{ "action": "create-sound", "title", "category", "storage_path", "duration_seconds"?, "source"? }`. `title` non-empty ≤ 80 chars; `category` one of `sound-effects`/`naat`/`taqreer`/`islamic` (`original` and unknown values rejected with 400); `storage_path` non-empty ≤ 512; `duration_seconds` ≥ 0 when supplied; `source` sliced to 120. Server decides `creator_id` (caller), `source_type` (`admin` for Team `admins` staff, else `user`), `status` `live`, `report_count` 0 — caller-sent values for those fields are ignored. Creates the row with the §5.24 template and returns `{ sound: { id, title, category, duration_seconds, storage_path, source, creator_id, source_type, video_id, status, report_count } }`. Live at once; no approval. |
| `report-sound` | **New (2026-11-03, J14)** — sound reports | Signed-in caller. Request `{ "action": "report-sound", "sound_id", "reason" }`. `reason` non-empty ≤ 500 chars; unknown sound → 404. Creates a `reports` row (`reporter_id` = caller, `target_type` `sound` — the enum gains `sound` in §5.11 — `target_id` = `sound_id`, `status` `open`, §5.11 template) and best-effort increments the sound's `report_count`. Returns `{ report_id, report, warnings }`. The reported sound stays visible (no auto-hide). |
| `remove-sound` | **New (2026-11-03, J14)** — staff sound removal | Team `admins`, role `admin` or `moderator`. Request `{ "action": "remove-sound", "sound_id", "reason"? }`. Sets the sound row's `status` to `removed` (row and audio file are NOT deleted) and best-effort writes an `admin_actions` row (`action` `remove-sound`, `target_type` `sound`, `details` JSON with the reason). Already-removed rows return unchanged. Returns `{ sound: <mapped row as in create-sound>, warnings }`. |

**Justification for one combined function:** all actions share the
caller-authentication and team-membership checks, are synchronous
request/response, and are invoked from the same client layer that
previously called three separate RPCs. Splitting them would exceed
the Free 2-function budget many times over and leave no room for
upload, deletion, or events. The cost is a single failure domain (a bad deploy breaks all
actions at once) and a larger bundle — accepted, and mitigated by
keeping each action a small, independently tested handler inside the
one deployment.

### 8.2 `events` — database-event trigger (reactions, no HTTP)

- **Function ID / Name:** `events`. **Trigger:** database events
  (select events in the Function → Settings → Events picker — **use
  the picker, do not hand-type event strings**: Appwrite's event format
  changed with the TablesDB rename, and the picker shows the format for
  this project's Appwrite version. The logical triggers are listed
  below; the picker entries are their equivalents).
- **Execute permission:** none for clients (event-triggered only).
- **Timeout:** 15 seconds.
- **Environment variables:** same three as §8 header.
- **Logical triggers and logic:**

| Trigger (logical) | Logic (API key; recompute, never delta-trust the client) |
|---|---|
| `video_likes` create OR delete | **sync-counters (likes):** count `video_likes` rows for the affected `video_id`; write that exact number to the video's `like_count`. Idempotent: concurrent events converge on the true count. Mirrors `bump_like_count` (including `greatest(count, 0)` — a count can never be negative). |
| `comments` create OR delete | **sync-counters (comments):** count ALL `comments` rows for the video (any status — mirrors the SQL trigger, which counted hidden comments too); write to `comment_count`. Client-side count updates are NOT a source of truth and must never be wired. |
| `profiles` create | **profile-sync:** create the `public_profiles` document (§6.1) unless suspended. |
| `profiles` update | **profile-sync:** suspended → delete public document; not suspended → upsert safe fields only (§6.1). Never copies `verified`/`role`. |
| `profiles` delete | **profile-sync:** delete the `public_profiles` document. |

- **What `events` deliberately does NOT do:** no moderation audit (the
  `api` actions log their own decisions synchronously), no file flips
  (the `api` moderation actions flip synchronously so the admin sees
  the result immediately), no view counting (synchronous `api`
  action). Event delivery is at-least-once: every handler must be
  idempotent (recounts and upserts are; no handler appends without
  checking).

### 8.3 `create-upload` — MERGED INTO `api` (the only video-creation path; NO standalone function)

> **MERGED INTO `api` 2026-11-04 (Free 2-function limit).** There is
> NO standalone `create-upload` function in the Console — do not
> create one. The live implementation is the `create-upload` action
> of the `api` function: call `api` with
> `{ "action": "create-upload", ... }`, under `api`'s execute
> permission (`users`) and 30-second timeout, with `api`'s
> variables. The full contract below is the behaviour
> documentation for that action and is kept in full (in the steps
> below, "this function" means the `create-upload` action).
> `functions/create-upload/index.js` is retained as history only.

- **Action name:** `create-upload` (in `api`). **Trigger:** HTTP, via `api`.
- **Execute permission:** `execute("users")` (via `api`).
- **Timeout:** 30 seconds (the `api` timeout).
- **Flow (mirrors the Supabase function, adapted to Appwrite Storage):**
  1. Authenticate the caller; reject suspended callers (read
     `profiles.is_suspended` with the API key — a suspended user must
     not upload).
  2. Validate: `duration_seconds > 0 and <= 20.5`, `size_bytes <=
     26214400`, caption ≤ 300 chars, `location` ≤ 256 chars when
     present (optional free-text place name; empty/absent → null),
     sound choice when present (`sound_id` ≤ 64 chars stored
     opaquely, `sound_title` ≤ 80, `sound_category` one of the four
     library slugs else null — never validated against the `sounds`
     collection, never fails the upload), `visibility` in
     (`public`,`followers`,`private`), `filter` in the five values,
     poll shape (question ≤ 80, two options ≤ 30 each, all-or-none),
     `duet_of` / `reply_comment_id` existence (look the rows up;
     derive `reply_video_id` from the comment, exactly as the
     Supabase function does). **No `category_ids` validation
     exists** (categories removed from the upload flow, 2026-11-03;
     a sent `category_ids` value is ignored) and **no music field
     exists** (any other sound/music field is ignored). The
     post-screen extras are STORED, not ignored (2026-11-03
     fix-up): `trim_start_seconds` / `trim_end_seconds` (numbers,
     clamped to `[0, duration]`, defaults `0` / duration),
     `content_disclosure` (boolean, `true` only when exactly
     `true` is sent), `link_url` (trimmed, sliced to 300 chars,
     null when absent/empty) — shapes matching the demo store.
     Reject with 400 on any validation failure. The duration/size
     values arrive from the
     client's media probe and are re-checked here, but a determined
     client can lie about a probe value — the same documented
     limitation as Supabase (strict server-side media probing is a
     future upgrade, not part of this spec).
  3. The client uploads the file bytes FIRST, directly to the `media`
     bucket (bucket create permission, §7.1), with owner-only file
     permissions and the §7 naming convention; the client then calls
     this function with the resulting file `$id` (plus thumbnail file
     `$id` when present). The function verifies the file exists and
     its size via the API key; on validation failure it deletes the
     uploaded file so no orphan remains. (The Supabase order was
     row-then-signed-URL; Appwrite has no equivalent signed-upload
     URL, so the order inverts. The security properties are the same:
     no video row exists until validation passes. Under direct
     publish there is no approval gate: a valid non-draft upload is
     publicly readable at once, and removal happens afterwards
     through post-moderation.)
  4. Create the `videos` document LIVE — direct publish (2026-11-03,
     no pre-publication review): `moderation_status = "approved"`
     with `published_at` set now (the exact status the §6.2 feed
     query uses), or `"draft"` when `is_draft` is true — the one
     client-choosable status, because a draft is strictly less
     visible than a live post. `storage_path = fileId`, counters at
     0, `location` as validated, post-screen extras
     (`trim_start_seconds`, `trim_end_seconds`,
     `content_disclosure`, `link_url`) as validated (2026-11-03
     fix-up). Create NO `video_categories` rows. For a live
     (non-draft) video created with no `sound_id`, best-effort
     auto-register its original sound as a `sounds` row
     (category `original`, `video_id` dedupe; never fails the
     upload — §7.3).
     Normalise the video + thumbnail file permissions to the live
     template (§7.1: public read for approved+public, creator+team
     only for drafts and followers/private videos) with the API key.
  5. Log a `moderation_events` row (`uploaded`, with duration/size/
     status in `details`). Handle @mentions as the Supabase function
     does (best-effort, never blocking): look up mentioned usernames
     in `public_profiles`, insert `mention` notifications via the API
     key. Drafts skip mention notifications until publish (the app
     sends them on `publish-draft` — in Appwrite, via the `api`
     function or the `notify` fallback, per §5.10).
  6. Return the created video document. There is no `upload_url` in
     the Appwrite contract — the file is already uploaded.
- **Constraint ownership for videos (where each CHECK lives):** caption
  length → attribute size (300) + Function slice; `location` length →
  attribute size (256) + Function trim/slice; sound fields →
  attribute sizes/enum + Function slice/sanitise (opaque, no
  catalog validation); post-screen extras → `trim_*` double bounds
  (0–20.5) + Function clamping to `[0, duration]`,
  `content_disclosure` boolean attribute + Function exact-true
  storage, `link_url` size (300) + Function trim/slice; duration/size
  → Function validation + attribute bounds;
  `filter`/`visibility`/`moderation_status` → enum
  attributes + Function (only Functions set statuses; new uploads
  are `approved` or `draft`, never `pending`); poll shape → Function
  + decomposed attribute sizes; `duet_of`/`reply_*` references →
  Function existence checks (no FK). See §10 for the full
  CHECK-by-CHECK map.

### 8.4 `delete-account` — MERGED INTO `api` (Play Store account-deletion requirement; NO standalone function)

> **MERGED INTO `api` 2026-11-04 (Free 2-function limit).** There is
> NO standalone `delete-account` function in the Console — do not
> create one. The live implementation is the `delete-account` action
> of the `api` function: call `api` with
> `{ "action": "delete-account" }`, under `api`'s execute permission
> (`users`) and 30-second timeout, with `api`'s variables. The full
> cascade below is the behaviour documentation for that action and
> is kept in full (in the steps below, "this function" means the
> `delete-account` action). `functions/delete-account/index.js` is
> retained as history only.

- **Action name:** `delete-account` (in `api`). **Trigger:** HTTP, via `api`.
- **Execute permission:** `execute("users")` (via `api`; the caller deletes only
  their own account; the function verifies caller = target).
- **Timeout:** 30 seconds (the `api` timeout; cascade deletes are many calls; if the
  Console caps this function lower, set the maximum available and
  record it).
- **Logic (mirrors the Supabase function, with Appwrite's lack of
  cascades made explicit):**
  1. Authenticate the caller; `userId = callerId`.
  2. Delete the user's files: all `videos`/`stories` files (video +
     thumbnail + story files in `media`), by file `$id` from their
     documents.
  3. Delete the user's documents across ALL collections that reference
     them (no FK cascade will do this): `profiles` (+ `public_profiles`
     via the `events` sync, and directly as a belt-and-braces delete),
     `user_preferences`, `videos` (+ legacy `video_categories` rows
     for older videos — no new rows since 2026-11-03, `video_likes`,
     `saved_videos`, `comments`, `comment_likes`, `poll_votes`,
     `watch_history`, `notifications` addressed to them, `reports` they
     filed, `verification_requests`, `messages` they sent/received,
     `follows` either side, `blocked_users` either side, `story_views`,
     `stories` (+ their views), `account_events`, `moderation_reviews`
     (null `reviewer_id` instead of deleting the row, mirroring
     `ON DELETE SET NULL` — then delete the row only if the
     implementation workers decide review history need not survive;
     default: null the field, keep the row), `moderation_events`
     (keep rows; they reference videos that are being deleted — null
     `video_id` where the video is deleted, mirroring `SET NULL`),
     `admin_actions` (keep rows; null `admin_id`).
  4. Remove the user from Team `admins` if a member.
  5. Delete the Auth user via the Users API. Only after the data
     deletion succeeds — deleting the Auth user first would orphan
     documents whose cleanup needs the caller context.
  6. Return `{ ok: true }`. Partial failure must be reported as an
     error (never silent success): the client retries, and the
     function is idempotent (deleting an already-deleted document is
     treated as success).

---

## 9. Seed data — the 20 categories (verbatim)

Seed **after** the `categories` collection exists (§5.2). Each row:
**Document ID = slug**, `name`, `slug`, `sort_order` as listed,
`is_active = true`. These names, slugs, and sort orders are copied
verbatim from migration 0001 — do not "improve" any spelling. The seed
is KEPT for the Discover page after the 2026-11-03 direct-publish
change (upload flow no longer assigns categories); whether Discover
categories stay at all is an open question (§11).

| # | name | slug | sort_order |
|---|---|---|---|
| 1 | Islamic Knowledge | `islamic-knowledge` | 1 |
| 2 | Quran and Recitation | `quran-recitation` | 2 |
| 3 | Hadith and Sunnah | `hadith-sunnah` | 3 |
| 4 | Duas and Daily Reminders | `duas-reminders` | 4 |
| 5 | Islamic History and Seerah | `islamic-history-seerah` | 5 |
| 6 | Islamic Motivation | `islamic-motivation` | 6 |
| 7 | Halal Funny Videos | `halal-funny` | 7 |
| 8 | Clean Comedy | `clean-comedy` | 8 |
| 9 | Educational Videos | `educational` | 9 |
| 10 | Science and General Knowledge | `science-gk` | 10 |
| 11 | Life Lessons and Sabaq | `life-lessons` | 11 |
| 12 | Motivational Stories | `motivational-stories` | 12 |
| 13 | Personal Development | `personal-development` | 13 |
| 14 | Good Manners and Character | `manners-character` | 14 |
| 15 | Family and Society | `family-society` | 15 |
| 16 | Positive Entertainment | `positive-entertainment` | 16 |
| 17 | Language Learning | `language-learning` | 17 |
| 18 | Technology and Digital Skills | `technology-skills` | 18 |
| 19 | Halal Business and Entrepreneurship | `halal-business` | 19 |
| 20 | Health and Positive Lifestyle | `health-lifestyle` | 20 |

**How to seed (two routes, owner's choice):**

- **Console (no key needed):** Databases → tokisla → categories →
  Create Document, 20 times: set Document ID to the slug, fill
  `name`/`slug`/`sort_order`/`is_active`. Slow but needs nothing else.
  Verify afterwards: list the collection sorted by `sort_order` — all
  20 rows, slugs unique, no duplicates.
- **API seed (owner only, on their own machine):** the owner creates a
  *separate, short-lived* API key in **Settings → API Keys** with only
  Databases write scope, runs a seed script (written by an
  implementation worker) that creates the 20 documents with the API
  key, then **deletes that key**. The key is typed into the owner's own
  terminal/CLI environment only — never into chat, never into a file in
  the workspace, never reused for the Functions' key in §2. If the
  owner does not want a second key, use the Console route. No seed
  script is included in this spec, and no other data is seeded: there
  are no seed users, videos, or stories. (The Supabase migrations seed
  only categories; everything else starts empty.)

---

## 10. Enforcement map — where every Supabase mechanism went

| Supabase mechanism | Appwrite equivalent in this spec | Enforced by |
|---|---|---|
| RLS policies (0002) | Collection permissions + document-permission templates (§5) + Team `admins` (§3) | Appwrite permissions engine |
| `profiles` select (own + moderators) | §5.1 template (owner + team); public reads via `public_profiles` | Permissions + sync function |
| `guard_profile_role` trigger | `profiles.role`/`is_suspended`/`verified` never trusted; team is authority; sync never copies them | Functions + §6.1 design (residual R1) |
| `guard_video_moderation` trigger | Post-moderation only via `api` action + file-permission flip backstop (direct publish 2026-11-03: no pre-publication gate) | Function + file permissions (residual R2) |
| `touch_updated_at` triggers | `$updatedAt` automatic | Appwrite |
| `bump_like_count` / `bump_comment_count` triggers | `events` function recounts (§8.2) | Function (event trigger) |
| `increment_video_view` RPC | `api` action `increment-view` | Function |
| `publish_draft` RPC | `api` action `publish-draft` (sets `approved` + `published_at`, flips document/file permissions live) | Function |
| `set_comment_pin` RPC | `api` action `set-comment-pin` | Function |
| CHECK `duration_seconds > 0 AND <= 20.5` | Float bounds (0–20.5) + `create-upload` validation | Schema + Function |
| CHECK `size_bytes <= 26214400` | Integer max + bucket max file size + `create-upload` | Schema + bucket + Function |
| CHECK `caption <= 300` | String size 300 + Function slice | Schema + Function |
| (new, 2026-11-03) `location` ≤ 256 chars, optional | String size 256 + `create-upload` trim/slice; null when absent | Schema + Function |
| (removed, 2026-11-03) category assignment on upload | No enforcement: `create-upload` ignores `category_ids`; categories are Discover-only (§5.2, §9) | — |
| (new, 2026-11-03; user-added sounds 2026-11-03, J14) sounds library | `sounds` collection (§5.24) + audio files in the `media` bucket (§7.3); per-video choice stored on the video row; catalog writes via `api` `create-sound`/`report-sound`/`remove-sound` + `create-upload` original-sound auto-register (user-added direct-live, no approval; R7 superseded); no music anywhere; catalog file `sounds-catalog.json` (app root, ships empty) merged by `listSounds` with silent fallback; sounds streaming-only, never exposed as downloads | `api` sound actions + `create-upload` (sound fields + original auto-register) + client direct writes (collection + bucket) + `loadSoundsCatalog` (file) |
| (new, 2026-11-03) post-screen extras `trim_*` / `content_disclosure` / `link_url` | `trim_*` double attributes (0–20.5) + `create-upload` clamping to `[0, duration]`; `content_disclosure` boolean + exact-true storage; `link_url` string size 300 + trim/slice; null/0/duration defaults when absent | Schema + Function |
| CHECK `filter` enum | Enum attribute + Function whitelist | Schema + Function |
| CHECK `visibility` / `moderation_status` enums | Enum attributes; statuses Function-only; new uploads are `approved` (direct publish) or `draft`, never `pending` | Schema + Function |
| CHECK `body` 1–500, `reason` 3–500, messages 1–1000 | String sizes (maxima) + client validation (minima — no server minimum exists) | Schema (max) + client (min) |
| CHECK `username` regex | `create-profile` validation + client validation; unique index | Function + client (no schema regex) |
| CHECK self-follow / self-block / self-message | Client validation only — **no server enforcement** (flagged) | Client |
| CHECK `choice in (0,1)` | Integer min 0 / max 1 | Schema |
| CHECK `poll` JSONB shape | Decomposed attributes + `create-upload` all-or-none validation | Function + schema |
| Composite PKs (9 tables) | `unique` indexes + auto IDs; 409 = already-exists | Schema (index) |
| FK `ON DELETE CASCADE` | Explicit deletes in `delete-video` / `delete-account` | Functions |
| FK `ON DELETE SET NULL` | Explicit nulling in `delete-account` | Function |
| Views `public_videos` / `public_profiles` | Client query patterns (§6.2) + synced `public_profiles` collection (§6.1) | Client + sync function |
| Storage policies (approved-only reads) | Per-file permission templates + flips (§7.1) | Function-set file permissions |
| `create-upload` signed URL | Inverted flow: client uploads first, Function validates + creates row (§8.3) | Function + bucket permissions |
| `delete-account` edge function | `delete-account` Function with explicit cascade (§8.4) | Function |
| `is_admin()` / `is_moderator()` helpers | Team `admins` membership, roles `admin` / `moderator` (§3) | Teams API in Functions; `team:admins` in permissions |

---

## 11. Gaps, deviations & residual risks register

**Schema gaps fixed by this migration:**

- **G1 — `profiles.verified` missing in Supabase (CONFIRMED).** No
  migration defines a `verified` column on `profiles`, yet 0003's
  `public_videos` view selects `p.verified`, `store.js`
  `adminDecideVerification` writes `profiles.verified = true`, and the
  app renders the blue tick from it everywhere. The shipped Supabase
  schema is inconsistent: on a fresh Supabase deploy the view and the
  verification flow would fail. This spec **adds `verified` (boolean,
  default `false`)** to `profiles` (§5.1) and to `public_profiles`
  (§6.1). No other fix is needed; do not "fix" the Supabase side from
  this spec.
- **G2 — Notifications insert policy missing in Supabase (CONFIRMED,
  deviation follows the app).** 0002 grants no user insert on
  `notifications`, but the live store inserts client-side (share,
  mentions, verification notice). This spec grants `create("users")`
  with the §5.10 caveat and fallback. The Supabase behaviour and the
  app behaviour disagreed; the app wins here because share/mention
  notifications are user-facing features, not admin-only events.
- **G3 — `public_profiles` view omits `verified`/`private_account`
  the app reads (CONFIRMED).** See §6.1: both fields are included in
  the Appwrite public copy, with `verified` synced only by the
  decision action.
- **G4 — Followers-visibility videos unreadable via direct query in
  SQL live mode (CONFIRMED).** The SQL `videos_select` policy exposes
  only approved+public rows to non-owners/non-moderators, so a
  `followers`-visibility video is invisible to followers through the
  live store (the demo store shows it). This spec mirrors SQL
  faithfully (§5.3). If the owner wants followers to actually see
  such videos, that is a new feature decision for the implementation
  workers (most likely: serve them through the `api` function) — it
  must not be smuggled in as a permission change here.
- **G5 — Table count.** The brief said 21, then 22. The migrations
  define **23 tables** (counted from `CREATE TABLE` statements across
  0001/0003, verified by grep). This spec maps all 23, plus the new
  `public_profiles` collection = **24 collections**. Nothing was
  missed; the brief's count was wrong. The `sounds` collection added
  2026-11-03 (§5.24) makes **25 collections** in total.

**Judgment calls (alternatives considered):**

- **J1** Team `admins` as sole authority (§3) over `profiles.role` or
  labels. Decided: team. Reasons in §3.
- **J2** No relationship attributes; plain string IDs + Function
  existence checks (§5 global rules).
- **J3** Profile creation only via `api` `create-profile` (§5.1) —
  attribute-conditional create permissions do not exist in Appwrite.
- **J4** Category slugs as join keys; numeric IDs dropped (§5.2).
- **J5** Poll JSONB decomposed into three string attributes (§5.3).
- **J6** Separate synced `public_profiles` collection (§6.1) over
  document-permissions-only (rejected: cannot hide attributes).
- **J7** Two buckets (`media` + `avatars`), no folders, name-convention
  prefixes, file-permission enforcement (§7).
- **J8** Four functions: `api` router + `events` + `create-upload` +
  `delete-account`, one spare slot (§8).
  (2026-11-04: superseded — Free limit is 2 functions; `create-upload`
  + `delete-account` are `api` actions, no spare slot — see §8.)
- **J9** `create-upload` flow inverted (client uploads first, Function
  validates second) because Appwrite has no signed-upload-URL
  equivalent (§8.3).
- **J10** `user_preferences` kept owner-only, breaking the live
  store's direct cross-user gate reads; gates move into `api`
  `check-allow-prefs` (§5.15). Widening preferences to public read was
  rejected.
- **J11** Direct publish (2026-11-03, owner order: "review khatam —
  seedha post ho"). No pre-publication review for videos:
  `create-upload` writes `moderation_status = "approved"` (the exact
  value the §6.2 feed query already uses) + `published_at` + live
  file permissions; `publish-draft` flips drafts to `approved`.
  Moderation is post-publication only: reports, admin remove/hide
  (`moderate-video` `rejected`), warning/strike handling, suspend.
  Stories keep pre-publication review. Alternatives rejected:
  keeping the pending queue (owner order) and inventing a new live
  status string (the feed already queries `approved`).
- **J12** `videos.location` added (optional string, max 256 chars):
  free-text place name from the post screen, reusing the existing
  visibility/comment/duet fields; no field duplicated, no structured
  location object or separate collection.
- **J13** Sounds library (2026-11-03, owner order) is catalog-driven:
  an empty built-in client catalog plus a NEW `sounds` collection
  (§5.24) for owner-added sounds, because the client implementation
  strictly requires structured metadata storage (the live store
  reads/writes the collection directly). Admin-added audio files
  live in the existing `media` bucket; demo-mode additions persist
  locally, client-side. Per-video sound choice is stored on the
  video row (`sound_id`/`sound_title`/`sound_category`). No Function
  endpoint writes the catalog. No music anywhere. Naat/Taqreer tabs
  ship with honest empty states until the owner adds audio he owns
  or has rights to; no copyrighted audio is bundled or invented.
  Alternative rejected: a catalog data file only with no collection
  (the client implementation requires structured rows).

**Residual risks (Appwrite cannot fully close these — do not claim otherwise):**

- **R1 — Owner can tamper with own profile fields.** A user with
  update permission on their own `profiles` document can write
  `role`/`verified`/`is_suspended` via a direct API call. Impact is
  contained (nothing trusts those fields; sync ignores them; file
  flips backstop suspension/verification), but the tampered document
  itself will *look* admin/verified to anyone who reads the full
  `profiles` row — which, by the §5.1 template, is only the owner and
  the team. Mitigation in place; no further mitigation exists without
  routing all profile updates through a Function (rejected as
  disproportionate: every profile edit would become a function call).
- **R2 — Creator can flip own video's `moderation_status`.** Same
  per-attribute limitation on `videos` documents. Since direct
  publish (2026-11-03) the live case is a creator restoring a
  removed (`rejected`) video to `approved` via a direct API call.
  Impact is contained by the file-permission backstop (§5.3/§7.1):
  a self-restored video is listed but unplayable until a Function
  flips its file, and no `moderation_reviews` row exists for the
  flip, so the admin audit exposes it. If the owner wants this
  closed completely, the follow-up is to remove client update
  permission on `videos` entirely and route caption/visibility edits
  through `api` — a client-change decision for later, not part of
  this setup spec.
- **R3 — Story 24h expiry is query-only.** Expired approved stories
  remain readable by direct document ID (§5.22). Feed filtering is
  correct; direct-ID access is the gap. A future 5th (scheduled)
  function could close it.
- **R4 — Moderators technically hold `team:admins` collection
  permissions** on `categories` and moderation-internal collections
  where the *intent* is admin-only or moderator-only respectively.
  Appwrite permission strings distinguish teams, and team roles only
  in the `team:<id>/<role>` form, which the Console picker may not
  expose for every object. Where a role-qualified string is given
  (`admin_actions`, §5.14), use it; elsewhere, team membership is the
  enforced boundary and role separation inside the team is enforced by
  Functions. Direct-API abuse by a rogue moderator is out of scope
  for this spec (moderators are trusted humans appointed by the
  owner).
- **R5 — Cross-user document-permission grants (notifications,
  reports, messages).** Whether a client can attach another user's
  read permission at creation must be verified live (§10 checklist).
  Fallbacks (`notify`, `file-report`, message-via-`api`) are specified
  and must be wired if the test fails.
- **R6 — Eventual consistency of `public_profiles` and counters.**
  Sync/counter updates arrive via the `events` Function, seconds
  after the triggering write. The UI must tolerate stale counts and
  stale public profiles briefly; it must never write counters or
  public-profile fields itself to "fix" staleness.
- **R7 — SUPERSEDED 2026-11-03 (~23:35, owner decision): any
  signed-in user can create a `sounds` row, and that is now
  INTENTIONAL.** User-added sounds go direct-to-library with no
  admin approval (`create-sound`, §8.1; `source_type` `user` /
  `admin`); violations are removed after the fact via
  `report-sound` + staff `remove-sound` (status flip, §7.3). Do
  not re-impose an admin-only gate. The collection
  `create("users")` grant remains, so a direct client create is
  still possible; such rows lack the function-set fields and are
  treated as user-added.

**Open questions — 2026-11-03 (owner has not answered; do not guess):**

- **(a) Discover page categories — keep or remove?** The categories
  collection and seed are kept for Discover, and categories are gone
  from the upload/post flow only. If the owner says Discover
  categories go too, remove the collection/seed and the Discover
  category UI in a separate change; nothing in the upload flow
  depends on them either way.
- **(b) Sounds library content — owner supplies the audio.** No
  naat/taqreer audio exists in the workspace. The owner must supply
  audio he owns or has rights to before the Naat/Taqreer tabs can
  hold anything; the Sound Effects tab may hold only verified
  CC0/public-domain effects with the license noted in the catalog.
  Until then, empty states are correct.
- **(c) Client extras — RESOLVED 2026-11-03 (fix-up pass).** The
  live store sends `trim_*`, `content_disclosure`, and `link_url`
  with uploads, and `create-upload` now stores them on the video
  row (§5.3, §8.3, §10): the Crop/Trim, content-disclosure, and
  Add-link controls ordered on the post screen survive live, with
  shapes matching the demo store. This question is closed; the
  pre-fix-up wording (extras ignored, no attributes) no longer
  applies.

---

## 12. First-run verification checklist (do not call setup done without these)

Run in order, with two test accounts (one plain user, one team admin)
plus a guest (logged-out) session. **Direct publish (2026-11-03):**
there is no pending-video queue and no "approve to publish" step for
videos — do not look for one. The circular countdown-to-live is a
client-side render behaviour: the backend check is that the row is
`approved` immediately (item 1); the countdown itself is verified by
watching the client render, not by any server state.

1. Direct publish: as the plain user, upload a public video (with a
   caption and a location). `create-upload` returns the video with
   `moderation_status = "approved"` and `published_at` set, and NO
   admin action is needed. Logged out, list `videos` with the §6.2
   base query — the new video is returned at once and plays for the
   guest (file carries `read("any")`). Guest cannot read any
   `profiles` document (permission denied) but can read
   `public_profiles`. Repeat with a followers/private video: it is
   `approved` but its file stays creator+team-only. In the client
   render, watch the post screen: the circular countdown runs and
   the video then appears live in the feed — record that the
   countdown showed and the video went live without any admin step.
   (If the countdown never resolves to a live video, that is a
   client defect, not a backend gate: the row is already `approved`.)
2. 20-second / size enforcement: attempt a 21-second upload and an
   over-25-MB upload — both rejected with 400 and the orphaned file
   deleted (verify the file ID is gone). A 20.5-second upload is
   accepted. A draft upload is NOT rejected by these checks any
   differently: duration/size rules apply to drafts too.
3. Drafts still work: save a draft (with a location, and with no
   location on a second draft) — status `draft`, `published_at`
   empty, absent from the guest feed and from any admin queue.
   `publish-draft` as the owner → status `approved`, `published_at`
   set, file flips to public, video appears in the feed at once.
   Non-owner publish → rejected. Delete a draft → row and files
   gone.
4. Location + post-screen extras round-trip: the video from item 1
   shows its location in the feed/profile render; a video posted
   with no location shows no location and nothing crashes. Test the
   256 cap THROUGH THE CLIENT: in the post screen, paste a
   300-character place name into the Location field — the input
   caps entry at 256 characters — post it, and confirm the stored
   `location` is exactly 256 characters (the first 256 of what was
   pasted). On the same video, set a Crop/Trim range, switch
   Content disclosure On, and add a link on the post screen:
   confirm the row carries `trim_start_seconds` /
   `trim_end_seconds` (the trimmed range), `content_disclosure`
   `true`, and `link_url` (the link, max 300 chars), and that feed
   playback stays inside the trimmed range. A video posted with
   the trim/disclosure/link controls untouched carries the
   defaults (`trim_start_seconds` 0, `trim_end_seconds` the video
   duration, `content_disclosure` false, `link_url` null).
5. Post-moderation (report / remove / strike): as the plain user,
   report the live video from item 1 (reason 3–500 chars) → an
   `open` report exists for the admin. As admin, `moderate-video`
   `rejected` → the video leaves the feed and its file stops playing
   for guests (file flipped private); the creator gets a
   `moderation` notification and a `moderation_reviews` row exists.
   `moderate-video` `approved` on the same video → it returns to the
   feed and plays again. `needs_review` hides it the same way as
   `rejected`. Confirm there is NO admin queue of new uploads: new
   posts never wait for approval.
6. Stories still pre-moderated (unchanged): submit a story →
   status `pending`, absent from the stories feed; admin
   `moderate-story` `approved` → it appears; its file privacy
   follows the same guest/creator/approved pattern as item 1.
7. File privacy for not-live videos: take a draft video's file ID,
   attempt a file-view/download as guest → denied; as the creator →
   allowed; after `publish-draft` → guest allowed. Repeat for its
   thumbnail file. Repeat for a rejected (removed) video's file →
   guest denied until re-approved.
8. Role tamper: as a plain user, attempt a direct API update of own
   `profiles` document setting `role: "admin"` — record whether
   Appwrite allows the write (expected: allowed, R1). Then verify the
   user still cannot moderate (moderation action rejects: not a team
   member), cannot read `moderation_reviews`, and `public_profiles`
   still shows no `role` field and `verified: false`.
9. Cross-user grants, counters, and RPC equivalents: as user A,
   create a notification addressed to user B (share flow) and a
   message to user B; verify B can read both and A cannot read B's
   other notifications/messages. If either create is rejected, wire
   the §8 fallbacks and re-test. Like then unlike a video;
   `like_count` returns to its prior value via the `events`
   Function (allow a few seconds). Comment then delete a comment;
   `comment_count` likewise. Pin a comment as video creator →
   pinned; pin a second → first unpins. View an approved video →
   `view_count` +1; view a draft/removed video → unchanged.
10. Verification and suspension: file a verification request;
    admin approves via `api decide-verification` →
    `public_profiles.verified` becomes true and the blue tick
    renders; a plain user cannot set their own `verified` into the
    public copy by editing `profiles`. Admin suspends a creator →
    creator disappears from `public_profiles`, their approved videos
    stop playing for guests (file permissions flipped); unsuspend
    restores both.
11. Signup, delete account, categories, sounds: new user signs up
    → `create-profile` creates profile + public copy with
    `role: "user"`; duplicate username rejected; malformed username
    rejected. Test user with a video, likes, and messages runs
    `delete-account` → Auth user gone, files gone, no orphan
    documents remain in `follows`/`video_likes`/`messages` for that
    user ID (spot-check by query). Categories: all 20 rows present,
    sorted 1–20, slugs exact (§9); guest can read them; plain user
    cannot create one; a video with no categories renders
    everywhere. Sounds library (§5.24/§7.3): the `sounds` collection
    exists with its 10 attributes and 2 indexes; all five tabs render
    (Sound Effects, Naat, Taqreer, Islamic, Original);
    Naat/Taqreer show honest empty states (and Sound Effects too,
    unless a verified CC0 seed with a license note was recorded in a
    `sounds` row's `source`); a user-added sound via `create-sound`
    creates a `sounds` row + a `media`-bucket audio file readable by guests, and
    `listSounds` returns it; a video posted with that sound chosen
    carries `sound_id`/`sound_title`/`sound_category` on its row and
    renders the sound title in the feed; selecting a sound does not
    break direct publish or the 20-second limit; no music appears
    anywhere. R7 is SUPERSEDED (2026-11-03 owner decision): a plain
    signed-in user adding a sound direct-to-library with no approval
    is the intended behaviour — confirm it works (see items 13–17),
    not that it is blocked.
12. Budgets: Console shows 1 database, 2 buckets, 4 functions. If a
    5th function or 3rd bucket was created during setup by mistake,
    remove it before handoff. The `sounds` collection (§5.24) DOES
    exist — it is part of this spec, not a mistake.
    (2026-11-04: Console should show 2 functions (`api` + `events`)
    and 1 bucket — see §8; remove any 3rd function created by
    mistake, and do not create `create-upload`/`delete-account`.)
13. User add-sound, direct-live: as the plain user, upload an audio
    file to the `media` bucket, then call `create-sound` (title +
    category + `storage_path`) → a `sounds` row exists at once with
    `creator_id` = the user, `source_type` `user`, `status` `live`,
    `report_count` 0, and the §5.24 template; it appears in the
    library immediately with NO admin step. `category` `original`
    via `create-sound` → 400. A caller-sent `creator_id` /
    `source_type` / `status` is ignored (server decides). As staff,
    the same call yields `source_type` `admin`.
14. Original-sound auto-register: as the plain user, post a public
    video with NO sound chosen → a `sounds` row exists with
    category `original`, `source_type` `original`, `video_id` =
    the video `$id`, `storage_path` = the video file `$id`, title
    `Original sound — @<username>`, `status` `live`; it appears
    under the Original tab. Posting a second video with no sound
    creates a second, distinct original row; re-running the same
    upload path never duplicates the first video's row (video_id
    dedupe). A draft with no sound creates NO sounds row. A video
    posted WITH a library sound chosen creates NO original row.
15. Report-sound → staff remove-sound: as the plain user, report
    the sound from item 13 (`report-sound`, reason ≤ 500 chars) →
    a `reports` row exists with `target_type` `sound`, `status`
    `open`, and the sound's `report_count` is 1; the sound is
    STILL visible in the library (no auto-hide). As staff,
    `remove-sound` → the row's `status` is `removed`, an
    `admin_actions` row exists, the row and its audio file still
    exist, and the sound no longer appears in the library. A
    plain user calling `remove-sound` → rejected (staff only).
16. No download affordance for sounds: in the library sheet, the
    admin Sounds tab, and the feed, no sound offers a download
    button, downloadable link, or save affordance; previews play
    through streaming file-view URLs only.
17. Original tab: the Original tab lists only `original`-category
    live rows; the add-sound form offers only the four library
    tabs and never Original.

**Limits & housekeeping.** Free plan: 2 GB storage / 5 GB bandwidth per
project — video files count against both; there is no per-user quota in
this spec (Supabase had none either beyond the 25 MB file ceiling).
Re-check Appwrite's current Free limits in the Console at setup time; if
they differ from §0, record the actuals for the parent agent. Keep one
function slot and one bucket slot spare. Demo mode remains untouched.
(2026-11-04: no function slot is spare — the Free limit is 2
functions, both used — see §8; the bucket count is 1, see §7.)
