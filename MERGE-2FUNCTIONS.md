# Tokisla — Merge to 2 functions (2026-11-04)

`create-upload` and `delete-account` merged into `api` as router
actions. Reason: the Appwrite Free plan allows only **2 functions
per project** (Appwrite changelog 2026-01-08: reduced from 5 to 2;
verified live 2026-11-04 via the Console banner "limit of 2
functions"). The two live Console functions, `api` and `events`,
already occupy both slots; the other two functions were built but
never created in the Console.

This file is the merge record. Code is the authority for behaviour;
docs were corrected to match the merged code where they disagreed.
Nothing in this change was live-verified against Appwrite (see
"Not live-verified" below). No network calls, no Console/GitHub/
account access, and no secrets were used in this work. Local files
only.

## Files changed

### Code (prior implementation pass; verified by reading in this pass)

| File | Change (verified) |
|---|---|
| `functions/api/index.js` | 1,233 → 1,736 lines. Two new actions added: `actionCreateUpload` (before `actionCreateProfile`) and `actionDeleteAccount`; `HANDLERS` entries at lines 1652–1653; dispatcher `ctx` gained `users`, `logFn`, `errFn`; `void users;` removed. md5 `156fb641188ebfcd051760c6a7c4850a`. |
| `functions/api/index.js.pre-merge-20261104` | Backup of the pre-merge `api/index.js`, byte-identical to the pre-merge file, md5 `4e5f9cad68ce4ccd9594bfcecc178c21`. Not deployed; not in any archive. |
| `functions/api/package.json` | Untouched. md5 `d36461aca3d052efe0df8d2b8127dde4`. No import changes in `index.js`. |
| `store.js` | Routing only (see "Call sites repointed"). `API_FUNCTION = "api"` retained (line 901). No design/UI/copy changes. |
| `functions/create-upload/index.js` | Logic untouched; 3-line `MERGED INTO api` header comment prepended. Retained as history only — do NOT deploy standalone. |
| `functions/delete-account/index.js` | Logic untouched; 3-line `MERGED INTO api` header comment prepended. Retained as history only — do NOT deploy standalone. |
| `functions/events/index.js` | Untouched. |
| `schema.json` | Untouched by the merge (md5 `495436972b390b9cbfb5049f3007e71c`, mtime 2026-11-03). Note: its `functions: 4` count still describes the pre-merge design; the live truth is `APPWRITE_SETUP.md` §8 + this file. No collections/attributes/indexes added or changed. |
| `styles.css`, `sw.js`, `manifest.webmanifest`, `assets/`, demo mode | Untouched. |

### Docs (this pass)

| File | Change |
|---|---|
| `functions/README.md` | Action count 20 → 22; `create-upload` and `delete-account` added to the `api` action table as merged-into-`api` actions with contract summaries; §§3–4 turned into "merged into api / history only" sections keeping the full contracts with a prominent merged note at the top of each; header/deploy steps corrected from 4 functions to 2 (`api` + `events` only; do not create the other two); Free budget wording corrected (5 → 2); entrypoint note (`index.js`, NOT `src/main.js`), env-var table, and no-secret rule kept intact. |
| `APPWRITE_SETUP.md` (§8 only, plus one-line pointers) | §8 header corrected: Free = 2 functions per project (changelog 2026-01-08; Console banner verified 2026-11-04); design now 2 functions (`api` HTTP incl. `create-upload` + `delete-account`; `events` database events, unchanged). §8.1 action table gained both new actions with caller checks. §§8.3–8.4 turned into "merged into api" sections keeping the full contracts, each with a prominent merged note at the top. Runtime `node-22`, entrypoint `index.js` (corrected in §8 from the template default `src/main.js` to match the deployed layout — code is the authority), timeouts (`api` 30s, `events` 15s), and variables kept. One-line pointers to §8 added where other sections still say "4 functions" / spare slot: §0 budget table, §2 (API key), §5.23 (future scheduled function), §11 J8, §12 item 12 and §12 limits paragraph. No other section rewritten. |
| `MIGRATION_NOTES.md` | §11 addendum added (date 2026-11-04, reason, what moved, re-verification, residual risks). §§0–10 left as written (historical). |
| `MERGE-2FUNCTIONS.md` | This file. |

### Tests (this pass)

| File | Change |
|---|---|
| `tests/functions.merged-actions.test.mjs` | NEW. Executes the real merged `functions/api/index.js` with a stubbed `node-appwrite` (no network, no live calls). Covers validation-error shapes, auth-required behaviour, create-upload happy paths, and the delete-account cascade order asserted from the mock operation log. 147 assertions, all passing (see "Test counts"). |
| `tests/node-appwrite-stub.mjs` | NEW. Test-only in-memory `node-appwrite` stub (TablesDB/Storage/Teams/Users, `ID`/`Permission`/`Query`/`Role`). Never used outside tests; not the SDK. |
| `tests/node-appwrite-hooks.mjs` | NEW. Node module-customization hooks redirecting the bare `node-appwrite` import to the stub for the merged-actions test only. |
| All other test files | Untouched. |

### Deploy archives (this pass)

| File | Change |
|---|---|
| `~/workspace/tokisla-setup/functions/api.zip` | OVERWRITTEN with the merged `api` build (see "Deploy archives" below). |
| `~/workspace/tokisla-setup/functions/api.tar.gz` | OVERWRITTEN with the merged `api` build (see "Deploy archives" below). |
| Other 6 archives (`events`, `create-upload`, `delete-account` `.zip`/`.tar.gz`) | Byte-untouched (md5s unchanged — see below). Retained as history. |

## Call sites repointed (all in `store.js`; verified by grep + read)

| Location (current line) | Old (as reported by the implementation pass; pre-merge file not retained for `store.js`) | New (verified) |
|---|---|---|
| `store.js:1980` (was 1982) — `submitVideo` | `execFunction(CREATE_UPLOAD_FUNCTION, payload)` | `callApi("create-upload", payload)` |
| `store.js:2323` (was 2325) — `deleteAccount` | `execFunction(DELETE_ACCOUNT_FUNCTION, {})` | `callApi("delete-account", {})` |
| `store.js:902–903` (old) — constants | `CREATE_UPLOAD_FUNCTION` / `DELETE_ACCOUNT_FUNCTION` constants | Removed. `API_FUNCTION = "api"` retained at line 901; `callApi` (line 1279) sends `{ action, ...params }` via `execFunction(API_FUNCTION, …)` (line 1280). |

Grep verification: zero remaining live-code invocations of the old
standalone function ids (`CREATE_UPLOAD_FUNCTION` /
`DELETE_ACCOUNT_FUNCTION` — no hits in `store.js`, `app.js`,
`admin.html`, or `functions/api/index.js`). The strings
`create-upload` / `delete-account` still appear in comments and in
the `callApi("…")` action names, which is the intended routing.

## New `api` action list — all 22 canonical actions, in router (`HANDLERS`) order

Read from `functions/api/index.js` `HANDLERS` (lines 1650–1679).
Auth is the dispatcher level; each action re-authorises internally.

| # | Action | Dispatcher auth |
|---|---|---|
| 1 | `create-profile` | signed-in |
| 2 | `create-upload` (merged 2026-11-04) | signed-in |
| 3 | `delete-account` (merged 2026-11-04) | signed-in |
| 4 | `increment-view` | signed-in |
| 5 | `publish-draft` | signed-in |
| 6 | `set-comment-pin` | signed-in |
| 7 | `moderate-video` | staff (Team `admins`, admin/moderator) |
| 8 | `moderate-story` | staff |
| 9 | `moderate-comment` | staff |
| 10 | `decide-verification` | staff |
| 11 | `decide-report` | staff |
| 12 | `suspend-user` | admin only |
| 13 | `unsuspend-user` | admin only |
| 14 | `set-role` | admin only |
| 15 | `delete-video` | signed-in (owner-or-staff rule applied in the handler) |
| 16 | `notify` | signed-in |
| 17 | `file-report` | signed-in |
| 18 | `send-message` | signed-in |
| 19 | `check-allow-prefs` | signed-in |
| 20 | `create-sound` | signed-in |
| 21 | `report-sound` | signed-in |
| 22 | `remove-sound` | staff |

Aliases (same handlers, not counted above): `suspend` /
`unsuspend` (→ suspend/unsuspend-user, admin only),
`get-allow-prefs` (→ check-allow-prefs, signed-in).

Merged-action contracts (summarised; full text in
`functions/README.md` §§3–4 and `APPWRITE_SETUP.md` §§8.3–8.4):

- **`create-upload`**: suspended check (incl. no-profile callers →
  403); duration `> 0` and `<= 20.5`; size `<= 26214400`
  (server-side size is ground truth); caption ≤ 300; location ≤ 256;
  sound fields (`sound_id` ≤ 64 opaque, `sound_title` ≤ 80,
  `sound_category` 4-tab else null); visibility/filter enums; poll
  shape; duet/reply existence checks; trim clamp `[0, duration]`;
  `content_disclosure` exact-`true`; `link_url` trim/slice 300;
  file verify + orphan cleanup; live doc (`approved` +
  `published_at`) or draft; permission normalisation;
  original-sound auto-register; `moderation_events` log;
  @mentions; returns the created video document; 400 on
  validation failure.
- **`delete-account`**: files first (failures → 500 before any
  document deletion), then per-video comments + likes,
  `video_categories` / `video_likes` / `saved_videos` /
  `poll_votes` / `watch_history`, video rows; `story_views`
  then stories; follows / blocked / likes / saves / messages /
  notifications / reports / verification requests /
  `account_events` on both sides; remaining comments; SET NULL
  `moderation_reviews.reviewer_id` / `admin_actions.admin_id` /
  `moderation_events.video_id` (rows kept); `user_preferences`,
  `public_profiles`, `profiles`; Team `admins` removal (single
  page, limit 100, pre-existing); Auth user delete LAST.
  Returns exactly `{ ok: true }`.

## Test counts — from this pass's own runs (Node 24.22.1)

All suites run locally; no network, no live Appwrite calls.
`node --check` clean on every JS file changed in this pass plus
the merged `functions/api/index.js` and `store.js` (18 files
checked, all clean; full list: the 4 function files, `store.js`,
`app.js`, `config.js`, `sw.js`, and all 7 test files incl. the 3
new ones).

| Suite | Result |
|---|---|
| `tests/functions.contract.mjs` | **95 passed, 0 failed** (guards the standalone history files + schema; see divergence 3) |
| `tests/functions.merged-actions.test.mjs` (NEW) | **147 passed, 0 failed** (executes the real merged router against the stubbed SDK: routing/auth gates, validation errors + orphan cleanup, live/draft/poll/duet/reply/trim/mention/original-sound happy paths, delete-account cascade order + file-failure abort + body-id-ignored) |
| `tests/store.test.mjs` | **187 passed, 0 failed** |
| `tests/store.live.test.mjs` | **42 passed, 0 failed** |
| `tests/app.smoke.mjs` | **123 passed, 0 failed** |
| `tests/admin.smoke.mjs` | **34 passed, 0 failed** |
| `tests/auth-check-failure.test.mjs` | **5 passed, 0 failed** |
| **Total (7 suites)** | **633 passed, 0 failed** |
| `tests/singlefile.check.mjs` | **Fails, pre-existing, unchanged.** `ENOENT` for `/home/hatch/workspace/your_files/tokisla-demo/tokisla-app-demo.html` — a demo HTML path outside this tree. Same failure before this change; not caused by the merge. |

Grep checks (this pass): zero `supabase` references in all live
files (`store.js`, `app.js`, `config.js`, `sw.js`, all 4 function
files, `index.html`, `admin.html` — 0 hits each); zero
secret-like values in changed files (env-var names only; the new
test sets dummy placeholder env values
`https://example.invalid/v1` / `test-project` /
`test-key-placeholder` — placeholders, not real credentials);
`sounds-catalog.json` still `[]`. No render-affecting change was
made (client change is routing only), and the demo/admin smoke
counts are identical to the pre-merge baseline (123 / 34), so no
separate pixel check was needed and no render diff was accepted.

## Deploy archives

Built from `~/workspace/tokisla-appwrite/functions/api/` only
(`index.js` + `package.json` at the archive root, no nesting, no
`.pre-merge` backup file). `index.js` inside both new archives is
byte-identical to `functions/api/index.js`
(md5 `156fb641188ebfcd051760c6a7c4850a`); `package.json` is
byte-identical too (md5 `d36461aca3d052efe0df8d2b8127dde4`).

| Archive | Size | md5 BEFORE | md5 AFTER | Contents |
|---|---|---|---|---|
| `~/workspace/tokisla-setup/functions/api.zip` | 20,641 bytes | `2c571181b0e306fb4f30152ebd29dee0` | `bec10dfa8733ed6a3c8052cc013e2154` | `index.js` (77,203) + `package.json` (306) — exactly 2 files |
| `~/workspace/tokisla-setup/functions/api.tar.gz` | 20,488 bytes | `275977a85e9a99c1764fe4e158ba487c` | `7968c2017ffe9fcef8f1f9965c672c10` | `index.js` + `package.json` — exactly 2 files |
| `create-upload.zip` | 9,566 bytes | `9633c7742f1b7c4dc8cdf69a720a8515` | unchanged | history only |
| `create-upload.tar.gz` | 9,448 bytes | `ec0d733d405526b85b697e1f9fabe8fa` | unchanged | history only |
| `delete-account.zip` | 4,753 bytes | `c18a058c462ec15e7431a1ae11112e30` | unchanged | history only |
| `delete-account.tar.gz` | 4,656 bytes | `430c2ef6f49c6990c8532beb15c0a8e8` | unchanged | history only |
| `events.zip` | 4,504 bytes | `4d3c3b155b7cc65ee74c6aca3fe33506` | unchanged | live, no redeploy needed |
| `events.tar.gz` | 4,409 bytes | `1c5145206fabe6d3f7e308cf227c1e23` | unchanged | live, no redeploy needed |

The old `api.zip`/`api.tar.gz` held the pre-merge `index.js`
(52,875 bytes); the new archives hold the merged 77,203-byte
`index.js`. Verified by extracting both archives and comparing
md5s against the source files.

## Console redeploy steps for the owner (precise)

Do these in the Appwrite Console, in the existing project. Do NOT
create any new function.

1. Open **Functions** → click the existing **`api`** function →
   **Deployments** → **Create deployment** (upload the deployment
   source). Upload the NEW
   `~/workspace/tokisla-setup/functions/api.zip` file.
2. On the deployment form, confirm (do not change): **Entrypoint**
   stays `index.js`; **Runtime** stays `node-22`; **Timeout**
   stays `30s`. **Variables** are unchanged — do not re-enter or
   edit them (`APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`,
   `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID` stay as they are).
   Execute permission stays `users`.
3. Submit the deployment and wait for its build to succeed. **No
   separate Redeploy press is needed**: creating the new
   deployment is itself the activation step — once the build
   succeeds, the new deployment becomes the active one and the
   merged code is live. (The Console's Redeploy action re-runs a
   previous deployment; it is not used here.) Before leaving the
   page, confirm the new deployment is listed as the current /
   active deployment; if the Console ever shows it inactive,
   activate that deployment instead of pressing Redeploy on an
   old one.
4. Verify the deployment contents show `index.js` + `package.json`
   at the top level, with no extra nesting and no
   `index.js.pre-merge-20261104` file.
5. Smoke-check in the Console: **Functions → `api` →
   Executions → Execute** (or the equivalent execute action)
   with an **empty body** `{}`. Expect exactly:
   `{"ok":false,"error":"action is required."}` — the same
   response the pre-merge router gave for an empty body. That
   result proves the new deployment is serving the merged router
   (an unauthenticated empty-body call still returns this 400,
   by design — see divergence 1). Then run the §12 first-run
   checklist in `APPWRITE_SETUP.md` (direct publish, drafts,
   20s/size enforcement, delete-account, sounds, etc.) — none of
   it has been verified live yet.
6. **`events` needs NO redeploy.** It is unchanged; do not touch
   its deployments, events, variables, or timeout (15s).
7. Do NOT create `create-upload` or `delete-account` functions.
   If either name was ever created in the Console by mistake,
   remove it — the Free plan allows 2 functions total and both
   slots are taken by `api` + `events`.

## Divergences / residual risks (stated plainly)

1. **Parse-before-auth.** The `api` dispatcher parses the JSON
   body and resolves the action before authenticating, so invalid
   JSON / a missing action / an unknown action returns 400 even
   for an unauthenticated caller, where the standalone functions
   returned 401 first. Inherent to the router design; not
   changed. (Covered by a test case asserting the 400.)
2. **Failure log prefix.** Dispatcher failures now log as
   `api failed: …`. The orphan-cleanup, original-sound, and
   team-removal lines inside the merged actions keep their
   standalone prefixes (`create-upload: …`,
   `delete-account: …`).
3. **History-file contract tests guard history, not live code.**
   `tests/functions.contract.mjs` still statically reads the two
   standalone history files and passes — it does NOT verify the
   merged code, because pointing it at `api/index.js` would break
   its assertions (e.g. `api` legitimately contains `"pending"`
   in `STORY_STATUSES`). The merged code is covered by the new
   `tests/functions.merged-actions.test.mjs` suite instead.
4. **Team removal, single page.** `delete-account` lists Team
   `admins` memberships with limit 100, single page, exactly as
   the standalone handler did. A team with > 100 memberships
   could miss the caller's membership on that page
   (pre-existing limitation, unchanged).
5. **Nothing live-verified.** SDK method/parameter shapes, JWT
   resolution (`setJWT` / `Account.get`), permission omission on
   update, counting via `total`, Storage file shapes, and null
   handling for nullable attributes remain unverified against a
   live project, as before (see `functions/README.md`,
   "Unverified behaviours"). The mocked tests prove wiring and
   contract shapes only. The Console redeploy steps above and
   the §12 checklist are still owed live.

## What remains NOT live-verified

- Everything in item 5 above, plus: the new `api.zip` build
  succeeding in the Console; the empty-body Executions smoke
  check; every §12 checklist item (upload, draft publish,
  post-moderation, stories, sounds, suspension, verification,
  signup, delete-account end-to-end, counters, cross-user
  grants); and the client upload/delete flows against the
  redeployed `api` function. No live Appwrite execution happened
  in this merge work.
