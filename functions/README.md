# Tokisla — Appwrite Functions

Two Node.js functions for the Appwrite migration, implementing
`APPWRITE_SETUP.md` §8. (2026-11-04: the Free plan allows only 2
functions per project, verified live — see §8. The former standalone
`create-upload` and `delete-account` functions are merged into `api`
as actions; their history files in `functions/create-upload/` and
`functions/delete-account/` are retained for reference and must NOT
be deployed standalone.) This README is the deploy and contract
reference for both. The setup spec (`APPWRITE_SETUP.md`) and its
machine-readable mirror (`schema.json`) in the parent folder are
authoritative for the schema, permissions, and team design; this
README does not restate them.

No secret appears in any file in `functions/`. Every function reads
its credentials only from environment variables (`process.env`).
The endpoint, project ID, and API key are never hardcoded in code.

## Shared conventions

| Item | Value |
|---|---|
| Runtime | `node-22` (fallback `node-20.0` if the Console does not offer `node-22`; record the substitution) |
| Language / module system | Node.js, ESM throughout (`"type": "module"` in each `package.json`, `export default` handler) |
| Server SDK | `node-appwrite` pinned to exactly `31.1.0` in every `package.json` (see "SDK version" below) |
| Entrypoint | `index.js` (see "Entrypoint note" below) |
| Build | Template default (`npm install`); the only dependency is `node-appwrite` |
| Response envelope (HTTP functions) | `{ ok: true, data }` on success, `{ ok: false, error }` on failure. `delete-account` returns `{ ok: true }` exactly, per its spec contract. The client store must unwrap the envelope; the frozen UI code never sees it. |

### SDK version — verified, with a caveat

`node-appwrite@31.1.0` was verified as the current `latest` on the
npm registry at authoring time (registry metadata crawled
2026-11-02; package `engines.node >= 20.0.0`, so it is compatible
with the `node-22` runtime). The object-form TablesDB shapes used
throughout (`listRows({ databaseId, tableId, queries })`,
`createRow({ databaseId, tableId, rowId, data, permissions })`, and
so on) match the current Appwrite docs quick-start. The code was
**not** executed against a live Appwrite project and the SDK was
**not** installed (no credentials, no deploy in this work), so the
installed package's `.d.ts` must still be checked at deploy time for
the exact method/parameter shapes listed under "Unverified
behaviours" below. If `31.1.0` does not match the deployed Cloud
version, pin the version the Console/docs name for that version and
record the change — do not float the dependency.

### Entrypoint note — deviation from the spec template default

`APPWRITE_SETUP.md` §8 names the template-default entrypoint
`src/main.js`. These functions are laid out as `<function>/index.js`
(one file per function, self-contained; shared helpers are
intentionally duplicated per deployment unit because each function
deploys its own folder). When creating each function in the Console,
set **Entrypoint** to `index.js`, not `src/main.js`. The handler
shape is the modern context form, verified against current Appwrite
docs/guides:

```js
export default async ({ req, res, log, error }) => { /* ... */ return res.json({ ok: true }); };
```

### Environment variables — set on EVERY function

In the Console: Function → Settings → Variables. Mark the API key
variable secret/hidden where the Console offers it. Values come from
`APPWRITE_SETUP.md` §2 (the API key) and §0 (endpoint / project ID);
never paste a key into chat, a file, or client code.

| Variable | Value / note |
|---|---|
| `APPWRITE_ENDPOINT` | The Appwrite Cloud endpoint from the spec (§0). |
| `APPWRITE_PROJECT_ID` | The project ID from the spec (§0). |
| `APPWRITE_API_KEY` | The §2 key (scopes: Databases, Storage, Users, Teams). Server-side only. |
| `APPWRITE_DATABASE_ID` | `tokisla`. The code defaults to `tokisla` when this variable is unset (the spec treats the database ID as a code constant, not a secret); setting it explicitly is still required by this README so the deploy is self-describing. |

Fallbacks: the code also accepts the runtime-injected
`APPWRITE_FUNCTION_API_ENDPOINT` / `APPWRITE_FUNCTION_PROJECT_ID` /
`APPWRITE_FUNCTION_API_KEY` names if the `APPWRITE_*` names are
absent, preferring the `APPWRITE_*` names when both are set. The
runtime-injected key may be scoped to the execution rather than
bypassing permissions, so the §2 key must be set for correct
behaviour; the fallback exists only so a missing variable is not a
silent misconfiguration.

### Authentication and authorisation (HTTP functions)

- The caller's JWT is read from the `x-appwrite-user-jwt` header
  (falling back to an `Authorization: Bearer <jwt>` header carrying
  the same JWT) and resolved with the Account service. Anonymous
  calls are rejected with 401. A client-supplied user id is never
  trusted; the caller id always comes from the resolved session.
- Staff power comes only from Team `admins` membership, checked with
  the Teams API under the API key. `profiles.role` is a display
  mirror and is never consulted for any authorisation decision.
  The team `owner` role is treated as admin-equivalent (the setup
  also assigns the owner an explicit `admin` membership role).
- All database/storage writes inside functions use the API key and
  bypass document/file permissions by design; ownership checks are
  therefore coded in each handler, not assumed.

## Functions

### 1. `api` — action router (HTTP execution)

- **Purpose:** every synchronous privileged action that needs an
  immediate answer, sharing one auth/team-check implementation.
  Combining them is mandatory: the naive count (RPC replacements,
  profile creation, moderation endpoints, upload, account deletion)
  would exceed the Free 2-function budget (verified live 2026-11-04;
  the plan's earlier 5-function figure is superseded — see
  `APPWRITE_SETUP.md` §8). `create-upload` and `delete-account`
  are actions of this router (see the action table), not separate
  functions.
- **Trigger:** HTTP execution only. No schedule, no database events.
- **Execute permission:** `execute("users")` — any signed-in user may
  call it; each action re-authorises internally. Guests have no
  execute permission.
- **Timeout:** 30 seconds.
- **Request:** `POST` JSON `{ "action": "<name>", ...params }`.
  Non-POST requests get 405. Unknown actions get 400.
- **Deploy:** create the function, set Entrypoint `index.js`,
  Runtime `node-22`, the four variables above, execute permission
  `users`, timeout 30s; upload the `api/` folder as the deployment
  (or deploy it with the Appwrite CLI from this folder).

Actions (22 canonical, plus the aliases noted). `caller` means the
JWT-resolved caller id.

| Action | Caller check | Behaviour |
|---|---|---|
| `create-profile` | Signed in. Document id = caller id. | Validates username `^[a-z0-9_.]{3,24}$` (lowercased) and uniqueness against `public_profiles` and `profiles`; forces `role="user"`, `is_suspended=false`, `verified=false`; attaches the §5.1 document-permission template; creates the `public_profiles` copy synchronously (the `events` sync remains as backstop). Idempotent: returns the existing profile when one already exists. Duplicate username → 409 "That username is taken." |
| `create-upload` | Signed in. **Merged into `api` 2026-11-04** (Free 2-function limit; was a standalone function — see §3 below, retained as history only). | The only video-creation path (inverted flow, J9): validates the caller (suspended callers, including callers with no profile document, are rejected 403), the metadata (duration `> 0` and `<= 20.5`, size `<= 26214400` with the file's server-side size as ground truth, caption sliced to 300, location trimmed/sliced to 256 or null, visibility/filter enums, poll all-or-none shape, `duet_of`/`reply_comment_id` existence, trim clamped to `[0, duration]`, `content_disclosure` true only on exact `true`, `link_url` trimmed/sliced to 300), and the already-uploaded file (must exist, must belong to the caller — a foreign file is 403 and is NOT deleted). On a 400/403 failure the orphaned file(s) are deleted when they belong to the caller. Creates the video document live (`approved` + `published_at`, or `draft` when `is_draft`), counters at 0, the chosen sound fields (`sound_id` ≤ 64 opaque, `sound_title` ≤ 80, `sound_category` one of the 4 tabs else null), permission normalisation, a `moderation_events` `uploaded` row, best-effort @mentions (live videos only), and best-effort original-sound auto-register for live no-sound videos. Returns the created video document. Any 400 is a validation failure; see §3 for the full contract. |
| `delete-account` | Signed in. **Merged into `api` 2026-11-04** (Free 2-function limit; was a standalone function — see §4 below, retained as history only). | Deletes only the caller's own account (target always from the JWT; the `{}` body is ignored). Cascade in order: files first (a file-delete failure → 500 before any document is deleted), then per-video comments (+ `comment_likes`), `video_categories`/`video_likes`/`saved_videos`/`poll_votes`/`watch_history` and the video rows; `story_views` then stories; follows/blocked/likes/saves/messages/notifications/reports/verification requests/account events on both sides; remaining comments; SET NULL `moderation_reviews.reviewer_id` / `admin_actions.admin_id` / `moderation_events.video_id` (rows kept); `user_preferences`, `public_profiles`, `profiles`; Team `admins` removal (single page, limit 100, pre-existing); Auth user delete LAST. Returns `{ ok: true }` exactly. Idempotent on retry. See §4 for the full cascade. |
| `increment-view` | Signed in. | Increments `view_count` by 1 only when `moderation_status` is `approved`; otherwise a no-op returning `counted: false`. Read-then-write; a lost increment under concurrency is accepted, matching the legacy RPC. Guest views are not counted (guests cannot execute the function; the client must not fail the feed). |
| `publish-draft` | Owner only, status must be `draft`. | Sets status to `approved` + `published_at` and flips the document + video/thumbnail file permissions to the live template (direct publish, 2026-11-03; no `pending` step). Logs a `published` moderation event. Mention notifications on publish remain the client's job (as in the legacy flow). |
| `set-comment-pin` | Owner of the video the comment belongs to. | Unpins all other comments on that video when pinning, then sets the target pin state (one pin per video). Accepts `pinned` (or `p_pinned`); when omitted, toggles the current state. |
| `moderate-video` | Team `admins`, role `admin` or `moderator`. | **Post-moderation only (2026-11-03):** acts on live/reported videos after publication — `rejected` removes/hides, `needs_review` flags, `approved` restores. Never gates a new post. Sets `moderation_status` (`approved`/`rejected`/`needs_review`), `rejection_reason`, and `published_at` (set on first approval if empty); inserts a `moderation_reviews` row and a `moderation_events` row (`event_type` = the decision, `details` = JSON string); flips the video document permissions and the video + thumbnail file permissions per §7.1; inserts a `moderation` notification for the creator (best-effort). File flips happen after the row write and are reported in `warnings` when they fail — a failed flip leaves the file private (safe direction). |
| `moderate-story` | Team `admins`, role `admin` or `moderator`. | Sets story status and flips the story document + file permissions per §7.1. No review row, no notification (mirrors the legacy story decision). |
| `moderate-comment` | Team `admins`, role `admin` or `moderator`. | Sets comment `moderation_status` (`visible`/`hidden`/`removed`) and flips its document permissions per the §5.7 templates. |
| `decide-verification` | Team `admins`, role `admin` or `moderator`. | Sets request `status`/`decided_at`/`decided_by`. On approval, sets `profiles.verified = true` AND `public_profiles.verified = true` in the same call (repairing a missing public copy from the profile when needed), then inserts the `system` notification for the applicant (best-effort). Rejecting never clears an existing `verified` flag (mirrors the legacy flow). |
| `decide-report` | Team `admins`, role `admin` or `moderator`. | Sets report `status` only (`open`/`reviewed`/`dismissed`). |
| `suspend-user` / `unsuspend-user` (aliases `suspend` / `unsuspend`) | Team `admin` only (not moderator). | Sets `profiles.is_suspended`; suspend deletes the `public_profiles` document synchronously, unsuspend recreates it from the profile (restoring `verified` from the profile row, since the sync event never copies it); flips the creator's approved+public video/story files (§7.1). Document permissions on videos/stories are deliberately NOT flipped — discovery is governed by the missing public copy and playback by the file flip, per the spec. |
| `set-role` | Team `admin` only. | Sets the `profiles.role` mirror only after verifying the target's Team membership already matches the requested role (admin → membership role `admin`/`owner`; moderator → `moderator`; user → no admin/moderator/owner membership). Create/remove the membership in the Console first; a mismatch returns 409. Never writes `public_profiles`. |
| `delete-video` | Owner, or Team `admin`/`moderator`. | Explicit cascade: comments (+ their `comment_likes`), `video_categories`, `video_likes`, `saved_videos`, `poll_votes`, `watch_history`, then the video + thumbnail files, then the video document. Moderation review/event rows are kept as audit history. |
| `notify` | Signed in. **Fallback only** (§5.10). | Creates a `notifications` document addressed to another user, with the addressee permission template. `actor_id` is forced to the caller; `system` type is rejected (system notices are function-only). Wire only if the §10 cross-user grant test fails. |
| `file-report` | Signed in. **Fallback only** (§5.11). | Creates a `reports` document (`reporter_id` forced to the caller, `status="open"`), with the §5.11 template. `reason` must be 3–500 chars. Wire only if the grant test fails. |
| `send-message` | Signed in. **Fallback only** (§5.19). | Creates a `messages` document with the §5.19 template (read sender + recipient, update recipient; `sender_id` forced to the caller). Validates sender ≠ recipient and `body` 1–1000 chars; returns the created document. Used only when the client's direct message create fails with a 401/403 permission error. |
| `check-allow-prefs` (alias `get-allow-prefs`) | Signed in. | Reads another user's `user_preferences` with the API key and returns ONLY the five gate values (`allow_comment`, `allow_mention`, `allow_like`, `allow_download`, `view_follow_list`), defaulting to `everyone` when no row exists. Never returns notification settings or category ids. The caller still performs the `followers` follow-check, as in the legacy flow. |
| `create-sound` | Signed in. **User-added sounds, direct-live (2026-11-03; R7 superseded).** | Validates `title` (non-empty, ≤ 80), `category` (one of `sound-effects`/`naat`/`taqreer`/`islamic`; `original` and unknown values → 400), `storage_path` (non-empty, ≤ 512), optional `duration_seconds` (number ≥ 0) and `source` (sliced to 120). Forces `creator_id` to the caller and `source_type` to `admin` for Team `admins` staff else `user`; sets `status: "live"`, `report_count: 0`, `video_id: null`. Caller-sent `creator_id`/`source_type`/`status` are ignored. Creates the row with the §5.24 template and returns `{ sound }` in the mapped shape (`id`, `title`, `category`, `duration_seconds`, `storage_path`, `source`, `creator_id`, `source_type`, `video_id`, `status`, `report_count`). No approval step. |
| `report-sound` | Signed in. | Validates `sound_id` (unknown sound → 404) and `reason` (non-empty, ≤ 500 chars). Creates a `reports` row (`target_type: "sound"`, `status: "open"`, §5.11 template, reporter forced to the caller) and best-effort increments the sound's `report_count`. Returns `{ report_id, report, warnings }`. The reported sound stays visible — no auto-hide. |
| `remove-sound` | Team `admins`, role `admin` or `moderator`. | Sets the sound row's `status` to `removed` (row and audio file are NOT deleted) and best-effort writes an `admin_actions` row (`action: "remove-sound"`, `target_type: "sound"`, `details` JSON with the reason). Already-removed rows return unchanged. Returns `{ sound, warnings }` with the same mapped shape as `create-sound`. |

### 2. `events` — database-event reactions (no HTTP)

- **Purpose:** counter recounts and the public-profile sync, reacting
  to database changes.
- **Trigger:** database events, selected in the Console Events
  picker. **Use the picker; do not hand-type event strings.**
- **Execute permission:** none for clients (event-triggered only).
- **Timeout:** 15 seconds.
- **Deploy:** create the function, set Entrypoint `index.js`,
  Runtime `node-22`, the four variables above, timeout 15s; attach
  the events below via the picker; no execute permission for users.

Logical triggers and logic (API key; recompute, never delta):

| Trigger (logical) | Logic |
|---|---|
| `video_likes` create or delete | Count `video_likes` rows for the affected `video_id`; write that exact number to `videos.like_count` (never negative). |
| `comments` create or delete | Count ALL `comments` rows for the video (any status — mirrors the legacy trigger, which counted hidden comments too); write to `comment_count`. |
| `profiles` create | Create the `public_profiles` document (safe fields only) unless suspended. |
| `profiles` update | Suspended → delete the public document. Not suspended → upsert the six safe fields only (`username`, `display_name`, `bio`, `avatar_url`, `website`, `private_account`). Never copies `verified`, `role`, or `is_suspended`. A sync failure leaves the old public document in place and logs the conflict; it never deletes on failure. |
| `profiles` delete | Delete the `public_profiles` document. |

Event-string patterns (for orientation only — the picker is
authoritative; the code accepts both vocabularies):

- Pre-rename form: `databases.tokisla.collections.video_likes.documents.*.create` / `.delete`, and the same for `comments` and `profiles` (`create` / `update` / `delete`).
- Post-rename form: `databases.tokisla.tables.video_likes.rows.*.create` / `.delete`, and the same for `comments` and `profiles`.

The exact post-rename format could not be verified without a live
project (see "Unverified behaviours"). If the picker shows a
different segment order or wildcard form, follow the picker and
record what was selected.

Loop safety: this function never writes to `profiles`, `video_likes`,
or `comments`, and its writes to `videos` (counters) and
`public_profiles` are not subscribed triggers, so it cannot
re-trigger itself. Handlers are idempotent under at-least-once
delivery. This function deliberately does no moderation audit, no
file flips, and no view counting — the `api` actions do those
synchronously.

### 3. `create-upload` — video creation (MERGED INTO `api` — history only, do NOT deploy standalone)

> **MERGED 2026-11-04 (Free 2-function limit).** The live
> implementation is the `create-upload` action of the `api`
> function (§1 above), called as `POST` to `api` with
> `{ "action": "create-upload", ... }` under `api`'s execute
> permission (`users`) and 30-second timeout. There is NO
> standalone `create-upload` function in the Console. The
> contract below is the behaviour documentation for that action
> and is kept in full; `functions/create-upload/index.js` is
> retained as history only.

- **Purpose:** the only video-creation path. Inverted flow (J9):
  the client uploads the file first, then this action validates
  and creates the row. There is no signed-upload-URL equivalent.
- **Trigger:** HTTP execution only, via `api`.
- **Execute permission:** `execute("users")` (via `api`).
- **Timeout:** 30 seconds (the `api` timeout).

Contract (request JSON — canonical field names; aliases accepted
are listed so the client worker can wire either spelling):

| Field | Meaning |
|---|---|
| `fileId` (aliases: `file_id`, `storage_path` when it is a bare file id) | **Required.** File `$id` in the `media` bucket from the client's prior upload. |
| `thumbnailFileId` (aliases: `thumbnail_file_id`, `thumbnail_path` when it is a bare file id) | Optional thumbnail file `$id`. A `thumbnail_path` data URL / external URL ≤ 2048 chars is stored verbatim instead; a longer data URL is stored as `null` (see below). |
| `caption` | Sliced to 300 chars. |
| `location` | Optional free-text place name. Trimmed, sliced to 256 chars; empty/absent → `null` (stored on `videos.location`, added 2026-11-03). |
| `visibility` | `public` / `followers` / `private` (default `public`). |
| `duration_seconds` | Must be `> 0` and `<= 20.5` (probe value, re-checked here; a determined client can lie about a probe value — the same documented limitation as the legacy function). Error message mirrors the legacy one. |
| `size_bytes` | Must be `<= 26214400`. The file's server-side size (`sizeOriginal`) is ground truth when available. |
| `filter` | One of `normal`, `warm`, `cool`, `mono`, `vivid` (default `normal`). |
| `poll` | Object `{ question, options: [a, b] }`; question ≤ 80, options ≤ 30 each, all-or-none (an incomplete poll is dropped, not an error — mirrors the legacy function). Flat `poll_question` / `poll_option_a` / `poll_option_b` fields are accepted as a fallback. |
| `duet_of` | Must name an existing video when supplied (stricter than the legacy function — see "Disagreements"). |
| `reply_comment_id` | Must name an existing comment when supplied; `reply_video_id` is derived from that comment (stricter than the legacy function — see "Disagreements"). |
| `is_draft` | `true` → `moderation_status: "draft"`; otherwise `"approved"` (direct publish, 2026-11-03 — the exact live status the feed query uses) with `published_at` set. |
| `filename`, `content_type` | Accepted and ignored (kept for the frozen client's metadata shape). |
| `sound_id`, `sound_title`, `sound_category` | The creator's chosen library sound, stored on the video row. `sound_id` ≤ 64 chars (opaque, not validated against the `sounds` collection), `sound_title` ≤ 80, `sound_category` one of `sound-effects`/`naat`/`taqreer`/`islamic` (unknown → `null`, never fails the upload). Nulls = original audio (default). No music field of any kind is accepted or stored. |
| `trim_start_seconds`, `trim_end_seconds`, `content_disclosure`, `link_url` | Post-screen extras, stored on the video row (2026-11-03 fix-up; shapes match the demo store). `trim_*` are numbers in seconds, clamped to `[0, duration_seconds]` (defaults `0` / duration, never fail the upload); `content_disclosure` is a boolean, `true` only when exactly `true` is sent; `link_url` is trimmed and sliced to 300 chars, null when absent/empty. |
| `category_ids`, any other sound/music/audio field | **Not in this contract.** Sent values are ignored: never validated, never stored. Categories remain Discover-only (collection + seed kept); the sounds catalog lives in the `sounds` collection + `media` bucket (APPWRITE_SETUP.md §5.24/§7.3), plus the optional catalog file `sounds-catalog.json` at the app root (see `store.js` `loadSoundsCatalog`). |

Behaviour: authenticates the caller; rejects suspended callers
(including callers with no profile document, mirroring the legacy
function); validates metadata; verifies the file exists and belongs
to the caller (a file whose permissions name nobody else is accepted;
a file that demonstrably belongs to another user is rejected with
403 and is NOT deleted); on validation failure after upload,
deletes the orphaned file(s) when they belong to the caller and
returns 400; creates the video document LIVE (`approved` +
`published_at`, or `draft`) with the live file-permission template
(public read for approved+public, creator+team only otherwise),
counters at 0, `storage_provider: "appwrite"`, `location` as
validated, the post-screen extras as validated (`trim_*` clamped
to the video length, `content_disclosure` boolean, `link_url`
sliced to 300 chars), and the chosen sound (`sound_id`/`sound_title`/
`sound_category`, nulls when original audio); logs a `moderation_events` row (`uploaded`, JSON-string
`details` including the status); for a live (non-draft) video with
no `sound_id`, best-effort auto-registers an original sound in the
`sounds` collection (category `original`, `video_id` dedupe; never
fails the upload); handles @mentions best-effort,
never blocking, by looking usernames up in `public_profiles`
(drafts skip mentions until publish); normalises the video +
thumbnail file permissions to the live template; returns
`{ ok: true, data: <video document> }`. Post-moderation (reports,
admin remove/hide, suspend) happens afterwards through the `api`
function — nothing in this function gates publication.

Client contract warning: there is no `upload_url` in the response.
The client store must unwrap the envelope and hand the video row
(or `{ video, upload_url: null }`) to the frozen upload code, whose
PUT step is skipped when no upload URL is present. Returning the
raw `{ ok, data }` envelope to that code would break it.

Thumbnail note: `thumbnail_path` in the legacy flow is a canvas JPEG
data URL, which can exceed the 2048-char attribute. A data URL that
fits is stored verbatim; one that does not fit is stored as `null`
rather than sliced (slicing would corrupt it). If thumbnails must
survive at full fidelity, the client must upload them as files and
pass the file id — that is a client decision, not one this function
can make.

### 4. `delete-account` — account deletion (MERGED INTO `api` — history only, do NOT deploy standalone)

> **MERGED 2026-11-04 (Free 2-function limit).** The live
> implementation is the `delete-account` action of the `api`
> function (§1 above), called as `POST` to `api` with
> `{ "action": "delete-account" }` under `api`'s execute permission
> (`users`) and 30-second timeout. There is NO standalone
> `delete-account` function in the Console. The cascade below is
> the behaviour documentation for that action and is kept in
> full; `functions/delete-account/index.js` is retained as
> history only.

- **Purpose:** Play Store account-deletion requirement. Deletes the
  caller's files, documents, team membership, and Auth user.
- **Trigger:** HTTP execution only, via `api`.
- **Execute permission:** `execute("users")` (via `api`; the caller deletes only
  their own account; the target always comes from the JWT).
- **Timeout:** 30 seconds (the `api` timeout; set the maximum the Console allows and
  record it if lower).
- **Request:** `POST` JSON `{ "action": "delete-account" }` (other body fields ignored). **Response:**
  `{ ok: true }` exactly on success; an error envelope on failure.

Cascade (explicit — no foreign keys or cascades exist):

1. Files: every `videos` document's `storage_path` + `thumbnail_path`
   file ids and every `stories` document's `storage_path` file id,
   in the `media` bucket. A file-delete failure (other than
   already-gone) aborts before any document is deleted.
2. Documents deleted: for each owned video — its `comments` (+ their
   `comment_likes`), legacy `video_categories` rows (no new rows
   since 2026-11-03), `video_likes`,
   `saved_videos`, `poll_votes`, `watch_history`, then the video
   itself; for each owned story — its `story_views`, then the story;
   then `follows` (either side), `video_likes`, `saved_videos`,
   `blocked_users` (either side), `comment_likes`, `poll_votes`,
   `watch_history`, `story_views`, `messages` (either side),
   `notifications` addressed to the user, `reports` filed by the
   user, `verification_requests`, `account_events`, remaining
   `comments` authored by the user on others' videos (+ their
   `comment_likes`); then `user_preferences`, `public_profiles`,
   and `profiles` (the public copy is deleted directly as well as
   via the `events` sync).
3. References nulled, history kept: `moderation_reviews.reviewer_id`,
   `admin_actions.admin_id`, and `moderation_events.video_id` for
   the deleted videos. Notifications where the user was only the
   actor (addressed to others) are left as-is, mirroring the spec's
   "addressed to them" wording; their `actor_id` dangles and the
   client renders them without an actor profile.
4. Team `admins` membership removed, if present.
5. Auth user deleted via the Users API, last.

The function is idempotent: already-deleted documents/files count
as success, so a client retry after a mid-cascade failure can
finish the job. The Auth user is not deleted until the data
deletion succeeds. Very large accounts may exceed the 30-second
timeout; a retry is safe, and that limit is recorded here rather
than hidden.

## Console deploy steps (both functions)

1. In the project Console: **Functions → Create Function**. Set
   **Function ID** to exactly `api` / `events`, **Name** to the same string, **Runtime** to
   `node-22` (or `node-20.0` — see the table above), and
   **Entrypoint** to `index.js`. Do NOT create `create-upload` or
   `delete-account` functions: they are `api` actions (2026-11-04
   merge; the Free plan allows 2 functions per project).
2. Upload the matching folder as the deployment source (Dashboard
   tarball upload, or the Appwrite CLI from that folder:
   `appwrite deploy function` / the CLI's function-deploy flow for
   the project's CLI version — follow the CLI's own help at deploy
   time; no CLI command is asserted here). Verify the deployment
   contains `index.js` + `package.json` at the top level of the
   deployed folder, with no extra nesting.
3. Set the four environment variables (table above) on each
   function. Set the API key variable as secret/hidden where offered.
4. Set execute permissions: `users` for `api`; none (event-only) for `events`.
5. For `events`, attach the database events via the **Events**
   picker (see §2 above). For the HTTP function (`api`), set no events and
   no schedule. Set the timeouts from the table above.
6. Verify with the first-run checklist in `APPWRITE_SETUP.md` §12
   (direct publish, drafts, 20s/size enforcement, location,
   post-moderation remove/restore, stories still gated, sounds
   library, role tamper, cross-user grants, counters, RPC
   equivalents, verification, suspension, signup, delete-account,
   categories, budgets). Do not call setup done without it.

## Unverified behaviours (coded around, not hidden)

These could not be verified without a live project, credentials, or
an installed SDK (none were available for this work; nothing was
deployed). Each must be confirmed at first deploy; the code is
written so the most likely failure is visible in logs rather than
silent.

1. **SDK method shapes (pinned major).** Object-form TablesDB /
   Users / Teams / Storage calls, `Query.equal/limit/offset`,
   `Permission.*` / `Role.*` helpers, and `ID.unique()` follow the
   current Appwrite docs. Confirm against the installed package's
   `.d.ts` before the first deploy; if any shape differs, fix the
   call sites in both live functions together (they share the same
   helpers by duplication; the merged `create-upload` /
   `delete-account` history files are not deployed and need no fix).
2. **Caller resolution.** `Client.setJWT(jwt)` + `Account.get()`
   from the `x-appwrite-user-jwt` header is the documented
   functions pattern, but was not exercised here. If the deployed
   runtime delivers the JWT under a different header or the SDK
   build lacks `setJWT`, every HTTP action fails closed with 401
   (or 500 for the missing-method case) — check the first execution
   log before debugging anything else.
3. **Permissions on update.** Flips pass a full permission set;
   ordinary updates omit `permissions`. If omitting resets
   permissions instead of preserving them, counters and status
   updates would strip document permissions — test one
   `increment-view` + one `publish-draft` and inspect the document
   permissions afterwards.
4. **Counting.** `listRows` with `total: true` + `Query.limit(1)`
   is assumed to return the full matched count. The `events`
   recount falls back to a paged scan when `total` is absent, so a
   semantics surprise costs speed, not correctness.
5. **Event strings.** The post-TablesDB-rename event format and the
   exact header name are unverified; the code accepts both
   vocabularies and the picker is authoritative. Confirm the
   attached events in the Console after creation.
6. **Storage file shapes.** `getFile` returning `sizeOriginal`,
   `name`, and `$permissions`, and `updateFile` accepting
   `{ bucketId, fileId, name, permissions }`, are assumed from the
   SDK surface. File flips and size checks degrade gracefully
   (log + safe direction) if these differ, but the first
   moderation/upload run must confirm them.
7. **Nulling attributes.** Passing `null` for a nullable string
   attribute in `updateRow`/`createRow` is assumed to clear it or
   store an empty value (used for the SET NULL references in
   `delete-account`, and for optional fields such as
   `rejection_reason`, `published_at`, poll fields, and `duet_of`
   in `create-upload` / `moderate-video`). If the deployed SDK
   rejects `null` for optional attributes, those writes must be
   revisited (omit the key instead) before the first upload,
   moderation, or account-deletion test.
8. **Membership listing.** Team memberships are listed (paged) and
   filtered in code by `userId`, rather than relying on a
   queryable `userId` attribute, so an unverified query attribute
   cannot break staff checks. The membership object's `userId`,
   `roles`, and `$id` fields are assumed from the Membership model.
9. **Execution response shape (client side).** How the client SDK
   surfaces a function's `{ ok, data }` body (and failures) was
   not verified here; it is the client worker's surface, but the
   envelope above is the contract the client must unwrap. The
   functions themselves always return JSON with an explicit HTTP
   status via `res.json`.

## Disagreements and deliberate deviations (spec vs plan vs legacy)

Where the setup spec and the research plan disagree, the spec was
followed, per the work order. The material ones are recorded here
so a reviewer does not have to rediscover them.

1. **Entrypoint / layout.** The spec names the template default
   `src/main.js`; this work lays functions out as `<function>/index.js`
   per its work order, with Entrypoint set to `index.js`. Functionally
   equivalent; the Console field must match the layout.
2. **Database ID variable.** The spec treats `tokisla` as a code
   constant and lists only three environment variables. This work
   also reads `APPWRITE_DATABASE_ID` (defaulting to `tokisla`),
   because its work order lists four required variables. No
   behaviour changes when the variable is set to `tokisla`.
3. **Upload flow.** The spec (§8.3, J9) inverts the flow: client
   uploads first, function validates second, returns the video
   document, no `upload_url`. The research plan (§6.8) recommended
   the opposite order (function creates the row, store uploads via
   the client SDK, synthetic `{ video, upload_url: null }`). The
   spec was followed. The client store must be wired for the
   inverted flow and the envelope unwrap described in §3 above.
4. **Reply/duet strictness.** The spec's validation table says
   `duet_of` and `reply_comment_id` must exist; the legacy Deno
   function passed `duet_of` through unchecked and silently dropped
   a missing reply comment. This work follows the spec (400 on a
   missing reference, orphan file deleted).
5. **Public-profile creation on signup.** The spec assigns the
   public copy to the `events` sync (§6.1); `create-profile` in
   this work ALSO creates the public copy synchronously, so signup
   is immediately consistent and so the §12 signup check (profile
   + public copy) passes without waiting for an async event. The
   `events` handler remains idempotent against the row.
6. **Moderation notification + audit rows.** The legacy client
   decision wrote only a `moderation_reviews` row and no
   notification. The spec adds the `moderation_events` row, the
   file flips, and the creator notification; this work implements
   the spec. The notification is best-effort so it cannot roll
   back an approval.
7. **`check-allow-prefs` naming.** The spec's canonical action name
   is `check-allow-prefs`; the store method it replaces is named
   `getAllowPrefs`. Both action names are accepted (`get-allow-prefs`
   is an alias). Likewise `suspend`/`unsuspend` are accepted as
   aliases for `suspend-user`/`unsuspend-user`.
8. **`delete-video` scope.** `watch_history` rows for the deleted
   video are also deleted, although the spec's delete-video list
   does not name them; leaving them would orphan references the
   cascade exists to prevent.
9. **Test adaptation vs the plan.** The research plan (§5) says the
   demo test file needs no change and must keep passing
   byte-identical. The work order for this partition forbids the
   legacy-backend string in any file it writes, including tests,
   so `tests/store.test.mjs` changes only its config stub keys
   (empty Appwrite endpoint/project keys, replacing the
   legacy-backend config keys). Behaviour is unchanged: empty
   config keys still force demo mode under both the legacy and the
   new store. The change is recorded in the handoff report.
10. **Direct publish + sounds library (2026-11-03, owner orders).**
    The pending-queue model is gone for videos: `create-upload`
    writes `approved` + `published_at` + live file permissions,
    `publish-draft` flips drafts to `approved`, and `moderate-video`
    is post-moderation only. `category_ids` was removed from the
    `create-upload` contract (Discover categories kept). A `location`
    attribute was added to `videos`, as were `sound_id` /
    `sound_title` / `sound_category` for the creator's chosen
    library sound. The sounds library adds a `sounds` collection
    (§5.24 in the spec: title, category, duration_seconds,
    storage_path, source) because the client implementation
    strictly requires structured metadata storage for owner-added
    sounds — audio files live in the `media` bucket, and no naat/taqreer
    audio exists in the workspace (none was bundled or invented);
    no music handling exists in any function. Since 2026-11-03
    (owner decision, J14) user-added sounds go direct-to-library
    via `create-sound` (no approval; `create-upload` auto-registers
    original sounds), and R7 is SUPERSEDED: signed-in creation of
    `sounds` rows is intentional, and removal is via `report-sound`
    + staff `remove-sound` (status flip). The `sounds` collection
    now also carries `creator_id`, `source_type`, `video_id`,
    `status`, and `report_count` (§5.24).

## What was NOT done

- Nothing was installed (`npm install` was not run in any function
  folder), nothing was deployed, no Appwrite project was contacted,
  and no credentials were requested or used. Syntax was checked
  with `node --check` only (see the handoff report).
- No client code was written or modified by this work, and no file
  outside `functions/` and `tests/` was touched.
- Live behaviour (auth resolution, permission flips, event
  delivery, counting, file operations) is untested by construction
  and must be verified with the §12 checklist before launch.
