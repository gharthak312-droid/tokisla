// Tokisla — `api` function (Appwrite Cloud Functions, Node.js, ESM).
//
// HTTP execution trigger. One action router for every synchronous
// privileged action, per APPWRITE_SETUP.md §8.1. All database/storage
// writes use the API key and therefore bypass document/file permissions
// by design, so every ownership / team check below is coded, not assumed.
//
// Request body (JSON): { "action": "<name>", ...params }.
// Response envelope (every action): { ok: true, data } on success,
// { ok: false, error } on failure. The client store must unwrap this
// envelope; it must not pass it through to the frozen UI code.
//
// Authentication: the caller's JWT is read from the
// `x-appwrite-user-jwt` header (falling back to an `Authorization:
// Bearer <jwt>` header carrying the same JWT) and resolved with the
// Account service. A client-supplied user id is NEVER trusted.
// Authorisation for staff actions uses Team `admins` membership via
// the Teams API. `profiles.role` is a display mirror only and is never
// consulted for any decision in this file.
//
// User-added sounds — R7 SUPERSEDED (owner decision 2026-11-03
// ~23:35): users CAN add sounds, direct-to-library, with NO admin
// approval. The old R7 note (any signed-in user creating `sounds`
// rows is a residual risk to be closed) is superseded and must not
// be "fixed" by restricting creation: signed-in creation of `sounds`
// rows via `create-sound` below is INTENTIONAL. Violating sounds
// are removed after the fact via `report-sound` (any signed-in
// user) + `remove-sound` (staff), which sets the row's `status` to
// "removed" without deleting the row or its file. Original sounds
// are auto-registered by the `create-upload` action, never created here:
// `create-sound` rejects category "original".
//
// Environment variables only (no secret, endpoint, or project id is
// hardcoded anywhere in this file):
//   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
//   (runtime-injected APPWRITE_FUNCTION_API_ENDPOINT /
//   APPWRITE_FUNCTION_PROJECT_ID / APPWRITE_FUNCTION_API_KEY are
//   accepted as fallbacks), APPWRITE_DATABASE_ID (defaults to the
//   schema constant `tokisla` when unset).
//
// Unverified at authoring time (no live Appwrite project or credentials
// were available; nothing here was executed against Appwrite):
// - the object-form TablesDB / Users / Teams / Storage method shapes
//   of the pinned node-appwrite major (see package.json) against the
//   deployed Cloud version — they follow the current Appwrite docs
//   quick-start shapes, but must be confirmed from the installed
//   package's .d.ts at deploy time;
// - that `Client.setJWT` + `Account.get()` resolves the caller from
//   the `x-appwrite-user-jwt` header on this runtime;
// - that omitting `permissions` on updateRow leaves existing document
//   permissions untouched, and that passing `permissions` replaces
//   them wholesale (both are relied on for the permission flips);
// - that `listRows` with `total: true` + `Query.limit(1)` returns the
//   full matched count (counting is not used by this function, but
//   the events function relies on it; see functions/README.md).
// See functions/README.md for the full list and the deploy steps.

import {
  Account,
  Client,
  ID,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";

const TEAM_ID = "admins";
const MEDIA_BUCKET = "media";
const DB_FALLBACK = "tokisla";

const COL = {
  profiles: "profiles",
  publicProfiles: "public_profiles",
  categories: "categories",
  videos: "videos",
  videoCategories: "video_categories",
  follows: "follows",
  videoLikes: "video_likes",
  comments: "comments",
  savedVideos: "saved_videos",
  blockedUsers: "blocked_users",
  notifications: "notifications",
  reports: "reports",
  moderationReviews: "moderation_reviews",
  moderationEvents: "moderation_events",
  userPreferences: "user_preferences",
  watchHistory: "watch_history",
  accountEvents: "account_events",
  verificationRequests: "verification_requests",
  messages: "messages",
  commentLikes: "comment_likes",
  pollVotes: "poll_votes",
  stories: "stories",
  storyViews: "story_views",
  sounds: "sounds",
  adminActions: "admin_actions",
};

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
const VISIBILITIES = ["public", "followers", "private"];
const VIDEO_DECISIONS = ["approved", "rejected", "needs_review"];
const STORY_STATUSES = ["pending", "approved", "rejected"];
const COMMENT_STATUSES = ["visible", "hidden", "removed"];
const ROLES = ["user", "moderator", "admin"];
const NOTIFICATION_TYPES = ["follow", "like", "comment", "moderation", "system", "share", "mention"];
const REPORT_TYPES = ["video", "comment", "user", "sound"];
const REPORT_STATUSES = ["open", "reviewed", "dismissed"];
const SOUND_CATEGORIES = ["sound-effects", "naat", "taqreer", "islamic"];
const VERIFICATION_DECISIONS = ["approved", "rejected"];
// Caps shared with the merged `create-upload` action below (same
// values the standalone function enforced; see its contract).
const MAX_SECONDS = 20.5;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_LOCATION = 256;
const FILTERS = ["normal", "warm", "cool", "mono", "vivid"];
const MAX_SOUND_ID = 64;
const MAX_SOUND_TITLE = 80;
const MENTION_RE = /@([a-z0-9_.]+)/gi;
const ALLOW_KEYS = ["allow_comment", "allow_mention", "allow_like", "allow_download", "view_follow_list"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function badRequest(message) {
  return new HttpError(400, message);
}
function unauthorized(message = "Not signed in.") {
  return new HttpError(401, message);
}
function forbidden(message = "Not allowed.") {
  return new HttpError(403, message);
}
function notFound(message = "Not found.") {
  return new HttpError(404, message);
}
function conflict(message) {
  return new HttpError(409, message);
}

function envConfig() {
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "";
  const projectId = process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID || "";
  const apiKey = process.env.APPWRITE_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY || "";
  const databaseId = process.env.APPWRITE_DATABASE_ID || process.env.APPWRITE_FUNCTION_DATABASE_ID || DB_FALLBACK;
  if (!endpoint || !projectId || !apiKey) {
    throw new HttpError(500, "Function is not configured (missing endpoint, project, or API key variables).");
  }
  return { endpoint, projectId, apiKey, databaseId };
}

function privilegedClient(cfg) {
  return new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
}

function headerValue(req, name) {
  const headers = req && req.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") {
    try {
      return headers.get(name) || headers.get(name.toLowerCase()) || "";
    } catch (_e) {
      return "";
    }
  }
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === wanted) return headers[key];
  }
  return "";
}

function callerJwt(req) {
  const fromHeader = headerValue(req, "x-appwrite-user-jwt");
  if (fromHeader) return String(fromHeader).trim();
  const auth = headerValue(req, "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(String(auth || "").trim());
  return match ? match[1].trim() : "";
}

// Resolve the caller from their JWT. Never accepts a user id from the
// request body. Throws 401 when there is no usable JWT/session.
async function authenticate(req, cfg) {
  const jwt = callerJwt(req);
  if (!jwt) throw unauthorized();
  const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId);
  if (typeof client.setJWT !== "function") {
    throw new HttpError(500, "Caller verification is unavailable in this SDK build (setJWT missing).");
  }
  client.setJWT(jwt);
  let me;
  try {
    me = await new Account(client).get();
  } catch (e) {
    throw unauthorized();
  }
  if (!me || !me.$id) throw unauthorized();
  return String(me.$id);
}

// Guest-tolerant variant: returns null when there is no usable JWT
// instead of throwing. Only actions marked auth: "guest" use it —
// currently just increment-view, so guest views can be counted.
async function authenticateOptional(req, cfg) {
  try {
    return await authenticate(req, cfg);
  } catch (e) {
    if (e && e.status === 401) return null;
    throw e;
  }
}

async function teamRoles(teams, userId) {
  const roles = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const res = await teams.listMemberships({
      teamId: TEAM_ID,
      queries: [Query.limit(100), Query.offset(offset)],
    });
    const memberships = res.memberships || res.documents || [];
    for (const m of memberships) {
      if (String(m.userId) === String(userId)) {
        for (const role of m.roles || []) roles.add(String(role));
      }
    }
    if (memberships.length < 100) break;
    offset += memberships.length;
  }
  return roles;
}

// Staff check. `owner` (team creator) is treated as admin-equivalent:
// the setup assigns the owner an explicit `admin` membership role as
// well (§3.3), but the owner must never be locked out of staff actions
// solely because that second role was not assigned yet.
async function requireTeam(teams, callerId, { adminOnly = false } = {}) {
  const roles = await teamRoles(teams, callerId);
  const isStaff = roles.has("admin") || roles.has("moderator") || roles.has("owner");
  const isAdmin = roles.has("admin") || roles.has("owner");
  if (adminOnly ? !isAdmin : !isStaff) {
    throw forbidden(adminOnly ? "Admin only." : "Moderator or admin only.");
  }
  return roles;
}

function appwriteStatus(e) {
  const code = e && (e.code || e.status);
  return typeof code === "number" && code >= 400 && code <= 599 ? code : 500;
}
function isNotFound(e) {
  return appwriteStatus(e) === 404;
}
function isConflict(e) {
  return appwriteStatus(e) === 409;
}

function parseBody(req) {
  const raw = req ? req.body : undefined;
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "object" && !(raw instanceof Uint8Array)) return raw;
  const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
    throw badRequest("Request body must be a JSON object.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest("Request body is not valid JSON.");
  }
}

function requireString(value, name, { max = 36 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw badRequest(`${name} is required.`);
  if (text.length > max) throw badRequest(`${name} is too long.`);
  return text;
}

function optionalString(value, max) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function sliceText(value, max) {
  return String(value === undefined || value === null ? "" : value).slice(0, max);
}

// TablesDB wrappers. `permissions` is only sent when supplied: flips
// pass a full permission set (replacing the document's permissions);
// ordinary updates omit it so existing permissions are left alone.
// That omission behaviour is UNVERIFIED against the deployed version
// and must be confirmed at first deploy (see header note).
function dbArgs(cfg, tableId) {
  return { databaseId: cfg.databaseId, tableId };
}
async function getRow(db, cfg, tableId, rowId) {
  try {
    return await db.getRow({ ...dbArgs(cfg, tableId), rowId });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
async function createRow(db, cfg, tableId, rowId, data, permissions) {
  const args = { ...dbArgs(cfg, tableId), rowId, data };
  if (permissions) args.permissions = permissions;
  return db.createRow(args);
}
async function updateRow(db, cfg, tableId, rowId, data, permissions) {
  const args = { ...dbArgs(cfg, tableId), rowId, data };
  if (permissions) args.permissions = permissions;
  return db.updateRow(args);
}
async function deleteRow(db, cfg, tableId, rowId) {
  try {
    await db.deleteRow({ ...dbArgs(cfg, tableId), rowId });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

// Offset-paged list of every matching row. Collections here are small;
// the 50-page cap (5,000 rows) is a runaway guard, not a limit the app
// is expected to hit.
async function listAll(db, cfg, tableId, queries = []) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await db.listRows({
      ...dbArgs(cfg, tableId),
      queries: [...queries, Query.limit(100), Query.offset(offset)],
    });
    const batch = res.rows || res.documents || [];
    rows.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return rows;
}

async function listOne(db, cfg, tableId, queries = []) {
  const res = await db.listRows({
    ...dbArgs(cfg, tableId),
    queries: [...queries, Query.limit(1)],
  });
  const rows = res.rows || res.documents || [];
  return rows[0] || null;
}

// Permission templates (APPWRITE_SETUP.md §5). `Role.team(TEAM_ID)`
// renders as `team:admins`; `Role.user(id)` as `user:<id>`.
const perm = {
  readAny: () => Permission.read(Role.any()),
  readUser: (id) => Permission.read(Role.user(id)),
  readTeam: () => Permission.read(Role.team(TEAM_ID)),
  updateUser: (id) => Permission.update(Role.user(id)),
  updateTeam: () => Permission.update(Role.team(TEAM_ID)),
  deleteUser: (id) => Permission.delete(Role.user(id)),
  deleteTeam: () => Permission.delete(Role.team(TEAM_ID)),
};

function profileDocPermissions(ownerId) {
  return [
    perm.readUser(ownerId), perm.readTeam(),
    perm.updateUser(ownerId), perm.updateTeam(),
    perm.deleteTeam(),
  ];
}
function videoDocPermissions(creatorId, { publicRead }) {
  return publicRead
    ? [perm.readAny(), perm.updateUser(creatorId), perm.updateTeam(), perm.deleteUser(creatorId), perm.deleteTeam()]
    : [perm.readUser(creatorId), perm.readTeam(), perm.updateUser(creatorId), perm.updateTeam(), perm.deleteUser(creatorId), perm.deleteTeam()];
}
function storyDocPermissions(ownerId, { publicRead }) {
  return publicRead
    ? [perm.readAny(), perm.updateUser(ownerId), perm.updateTeam(), perm.deleteUser(ownerId), perm.deleteTeam()]
    : [perm.readUser(ownerId), perm.readTeam(), perm.updateUser(ownerId), perm.updateTeam(), perm.deleteUser(ownerId), perm.deleteTeam()];
}
function filePermissions(ownerId, { publicRead }) {
  return publicRead
    ? [perm.readAny(), perm.updateUser(ownerId), perm.updateTeam(), perm.deleteUser(ownerId), perm.deleteTeam()]
    : [perm.readUser(ownerId), perm.readTeam(), perm.updateUser(ownerId), perm.updateTeam(), perm.deleteUser(ownerId), perm.deleteTeam()];
}
function notificationPermissions(addresseeId) {
  return [perm.readUser(addresseeId), perm.updateUser(addresseeId), perm.deleteUser(addresseeId)];
}

// A storage_path / thumbnail_path value that names a file in the media
// bucket (a file $id), as opposed to a data URL or an external URL,
// which have no file to flip or delete.
function isFileId(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > 64) return false;
  return !text.startsWith("data:") && !/^https?:\/\//i.test(text) && !text.includes("/") && !text.includes(" ");
}

// Flip one file's permissions. Best-effort in the moderation paths:
// the document update has already happened, and a file that stays
// owner-only is unplayable (the safe direction), whereas failing the
// whole moderation call after the row was written would be worse.
// Returns null on success, or the error message on failure.
async function flipFile(storage, fileId, ownerId, { publicRead }) {
  if (!isFileId(fileId)) return null;
  try {
    const file = await storage.getFile({ bucketId: MEDIA_BUCKET, fileId });
    await storage.updateFile({
      bucketId: MEDIA_BUCKET,
      fileId,
      name: file.name,
      permissions: filePermissions(ownerId, { publicRead }),
    });
    return null;
  } catch (e) {
    if (isNotFound(e)) return null;
    return e && e.message ? String(e.message) : "File flip failed.";
  }
}

async function insertNotification(db, cfg, { userId, type, actorId, videoId, commentId }) {
  const data = { user_id: userId, type, is_read: false };
  if (actorId) data.actor_id = actorId;
  if (videoId) data.video_id = videoId;
  if (commentId) data.comment_id = commentId;
  return createRow(db, cfg, COL.notifications, ID.unique(), data, notificationPermissions(userId));
}

// The seven safe public-profile fields (never role / is_suspended;
// verified is handled only by decide-verification, never here).
function safePublicFields(profile) {
  return {
    username: profile.username,
    display_name: profile.display_name === undefined || profile.display_name === null ? "" : String(profile.display_name),
    bio: profile.bio === undefined || profile.bio === null ? "" : String(profile.bio),
    avatar_url: profile.avatar_url === undefined || profile.avatar_url === null ? null : String(profile.avatar_url),
    website: profile.website === undefined || profile.website === null ? "" : String(profile.website),
    private_account: profile.private_account === true,
  };
}

// --- Actions ----------------------------------------------------------

// --- Merged standalone handlers (2026-11-04) ------------------------
// `create-upload` and `delete-account` were standalone functions.
// Appwrite Free allows only 2 functions per project and `api` +
// `events` already occupy them, so both handlers live here as
// router actions. Their contracts are preserved exactly as the
// standalone files had them (functions/create-upload/index.js and
// functions/delete-account/index.js are retained as history and
// must not be deployed standalone). Router helpers are reused
// only where semantically identical to the standalone logic;
// where a router helper differs, the standalone logic is kept
// inline below and the difference is noted in the comment.

// Permission strings arrive as `read("user:<id>")` / `update("user:<id>")`
// / `delete("user:<id>")` — never the bare `user:<id>`. Ownership checks
// must match the quoted form (plus the bare legacy form), or every
// permissioned file looks foreign. (2026-11-05: the bare comparison
// rejected every real upload with "does not belong to the caller".)
function permissionNamesUser(p, callerId) {
  const s = String(p);
  return s === `user:${callerId}` || s.includes(`"user:${callerId}"`);
}

// Delete an orphaned upload, but only when the file demonstrably
// belongs to the caller (its permission list names them). Never
// delete a file that belongs to someone else. Standalone
// `deleteOrphanIfOwned` kept inline: no router helper does the
// ownership-gated delete.
async function deleteOrphanIfOwned(storage, fileId, callerId, logFn) {
  if (!isFileId(fileId)) return;
  try {
    const file = await storage.getFile({ bucketId: MEDIA_BUCKET, fileId });
    const permissions = file.$permissions || [];
    const owned = permissions.some((p) => permissionNamesUser(p, callerId));
    if (permissions.length > 0 && !owned) {
      logFn(`create-upload: refusing to delete file ${fileId} (not owned by caller)`);
      return;
    }
    await storage.deleteFile({ bucketId: MEDIA_BUCKET, fileId });
  } catch (e) {
    // Orphan cleanup is best-effort; the 400 response below is what
    // matters. A leftover file stays owner-only and unreferenced.
    logFn(`create-upload: orphan cleanup failed for ${fileId}: ${e && e.message ? e.message : e}`);
  }
}

// Standalone `normalizeFilePermissions` kept inline: the router's
// flipFile returns an error string instead of logging and
// continuing, so it is not equivalent here. Uses the router's
// filePermissions template, which is identical to the standalone
// one (same permission set for the same publicRead value).
async function normalizeFilePermissions(storage, fileId, ownerId, { publicRead }, logFn) {
  if (!isFileId(fileId)) return;
  try {
    const file = await storage.getFile({ bucketId: MEDIA_BUCKET, fileId });
    await storage.updateFile({
      bucketId: MEDIA_BUCKET,
      fileId,
      name: file.name,
      permissions: filePermissions(ownerId, { publicRead }),
    });
  } catch (e) {
    // Safe direction: the file keeps whatever permissions the client
    // upload gave it (owner-only), so a live public video whose flip
    // failed stays unplayable rather than leaking. Log and continue.
    logFn(`create-upload: file permission normalisation failed for ${fileId}: ${e && e.message ? e.message : e}`);
  }
}

// Standalone `deleteFileBestEffort` kept inline (delete-account
// only): a missing file counts as success, any other failure is
// collected and reported by the caller before any document is
// deleted. No router helper collects failures this way.
async function deleteFileBestEffort(storage, fileId, failures, label) {
  if (!isFileId(fileId)) return;
  try {
    await storage.deleteFile({ bucketId: MEDIA_BUCKET, fileId });
  } catch (e) {
    if (isNotFound(e)) return;
    failures.push(`${label} file ${fileId}: ${e && e.message ? e.message : "failed"}`);
  }
}

// Null one attribute on every matching row (SET NULL semantics for
// delete-account history rows). Standalone `nullAttributeByQuery`
// kept inline, adapted to the router's listAll/updateRow helpers
// (updateRow with no permissions argument leaves document
// permissions untouched, as the standalone direct call did).
async function nullAttributeByQuery(db, cfg, tableId, attribute, value, nullField) {
  const rows = await listAll(db, cfg, tableId, [Query.equal(attribute, value)]);
  for (const row of rows) {
    await updateRow(db, cfg, tableId, row.$id, { [nullField]: null });
  }
  return rows.length;
}

async function actionCreateUpload(ctx, body) {
  // Port of the standalone `create-upload` handler, preserving its
  // entire contract: caller auth (done by the dispatcher) + the
  // suspended check below, validation order, file verification,
  // live/draft creation, permission normalisation, moderation
  // event, @mention notifications, and best-effort original-sound
  // registration. Reused router helpers, all semantically
  // identical to the standalone equivalents: getRow (404 -> null),
  // listOne, createRow/updateRow, videoDocPermissions (same set as
  // the standalone videoPermissions), filePermissions (same set),
  // notificationPermissions (same set as the standalone mention
  // permissions), isFileId, and registerOriginalSound (same dedupe,
  // title, fields, and permissions; its storage-path skip can
  // never trigger here because storage_path is always the
  // uploaded file id). The standalone handler's own catch block
  // (orphan cleanup on 400/403, then the error envelope) is
  // reproduced as the try/catch below; the dispatcher supplies
  // the { ok: false, error } envelope and the log line, so this
  // action only cleans up and rethrows. The action returns the
  // created video document itself, exactly as the standalone
  // handler's `data` was, so the dispatcher envelope is identical.
  const { db, storage, callerId, logFn } = ctx;
  let uploadedFileId = null;
  let thumbnailFileId = null;
  try {
    // Suspended callers may not upload (mirrors the standalone
    // handler: a missing profile is treated the same as a
    // suspended one).
    const profile = await getRow(db, ctx.cfg, COL.profiles, callerId);
    if (!profile || profile.is_suspended) throw forbidden("Account not allowed to upload.");

    // File ids: canonical names first, legacy/alternate names second.
    const rawFileId = body.fileId || body.file_id || body.storage_path || null;
    uploadedFileId = typeof rawFileId === "string" && isFileId(rawFileId) ? rawFileId.trim() : null;
    const rawThumbId = body.thumbnailFileId || body.thumbnail_file_id || null;
    thumbnailFileId = typeof rawThumbId === "string" && isFileId(rawThumbId) ? rawThumbId.trim() : null;
    const thumbnailPathRaw = typeof body.thumbnail_path === "string" ? body.thumbnail_path : "";
    if (!thumbnailFileId && isFileId(thumbnailPathRaw)) thumbnailFileId = thumbnailPathRaw.trim();

    if (!uploadedFileId) {
      throw badRequest("fileId (the uploaded media file id) is required. Upload the file to the media bucket first, then call this function.");
    }

    // --- Metadata validation (400 on any failure; orphan cleanup in
    // the catch block below) ---
    const duration = Number(body.duration_seconds);
    const claimedSize = Number(body.size_bytes || 0);
    if (!(duration > 0) || duration > MAX_SECONDS) {
      throw badRequest(`Videos must be ${MAX_SECONDS - 0.5} seconds or shorter.`);
    }
    if (claimedSize > MAX_BYTES) throw badRequest("Video file is too large.");

    const filter = FILTERS.includes(body.filter) ? body.filter : "normal";
    const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : "public";

    // Poll: all-or-none — an incomplete/invalid poll is dropped,
    // not an error. Flat field names are accepted as a fallback
    // to the `poll` object.
    let pollQuestion = null;
    let pollOptionA = null;
    let pollOptionB = null;
    const pollObj = body.poll && typeof body.poll === "object" ? body.poll : null;
    if (pollObj) {
      const q = String(pollObj.question || "").slice(0, 80).trim();
      const opts = Array.isArray(pollObj.options) ? pollObj.options : [];
      const o1 = String(opts[0] || "").slice(0, 30).trim();
      const o2 = String(opts[1] || "").slice(0, 30).trim();
      if (q && o1 && o2) {
        pollQuestion = q;
        pollOptionA = o1;
        pollOptionB = o2;
      }
    } else if (body.poll_question || body.poll_option_a || body.poll_option_b) {
      const q = String(body.poll_question || "").slice(0, 80).trim();
      const o1 = String(body.poll_option_a || "").slice(0, 30).trim();
      const o2 = String(body.poll_option_b || "").slice(0, 30).trim();
      if (q && o1 && o2) {
        pollQuestion = q;
        pollOptionA = o1;
        pollOptionB = o2;
      }
    }

    let duetOf = null;
    if (typeof body.duet_of === "string" && body.duet_of.trim()) {
      duetOf = body.duet_of.trim();
      const duet = await getRow(db, ctx.cfg, COL.videos, duetOf);
      if (!duet) throw badRequest("duet_of does not name an existing video.");
    }

    let replyCommentId = null;
    let replyVideoId = null;
    if (typeof body.reply_comment_id === "string" && body.reply_comment_id.trim()) {
      const commentId = body.reply_comment_id.trim();
      const comment = await getRow(db, ctx.cfg, COL.comments, commentId);
      if (!comment) throw badRequest("reply_comment_id does not name an existing comment.");
      replyCommentId = comment.$id;
      replyVideoId = comment.video_id;
    }

    // Categories: REMOVED from the upload flow (2026-11-03). The
    // `category_ids` field no longer exists in this contract and is
    // ignored when sent (never validated, never stored, no
    // video_categories rows are created). The categories collection
    // and seed remain for the Discover page only.
    //
    // Sounds: the creator's chosen sound is stored on the video row
    // as sound_id / sound_title / sound_category, exactly as sent
    // by the client (title/category are display copies of the
    // catalog entry; sound_id is stored opaquely and is NOT
    // FK-validated against the catalog). An unknown
    // sound_category becomes null rather than failing the upload.
    // No music field of any kind is accepted or stored.
    let soundId = null;
    let soundTitle = null;
    let soundCategory = null;
    if (typeof body.sound_id === "string") {
      const trimmed = body.sound_id.trim().slice(0, MAX_SOUND_ID);
      if (trimmed) soundId = trimmed;
    }
    if (typeof body.sound_title === "string") {
      const trimmed = body.sound_title.trim().slice(0, MAX_SOUND_TITLE);
      if (trimmed) soundTitle = trimmed;
    }
    if (typeof body.sound_category === "string" && SOUND_CATEGORIES.includes(body.sound_category.trim())) {
      soundCategory = body.sound_category.trim();
    }
    //
    // Location: optional free-text place name from the post screen,
    // trimmed and capped at 256 chars; empty/absent becomes null.
    let location = null;
    if (typeof body.location === "string") {
      const trimmed = body.location.trim().slice(0, MAX_LOCATION);
      if (trimmed) location = trimmed;
    }
    //
    // Post-screen extras: trim_start_seconds / trim_end_seconds are
    // numbers in seconds; absent or non-numeric values default to
    // the full video (0 .. duration) and out-of-range values are
    // clamped into [0, duration]. content_disclosure is a boolean,
    // true only when the client sends exactly true. link_url is a
    // string sliced to 300 chars; empty/absent becomes null. None
    // of these ever fails the upload.
    const trimStartRaw = Number(body.trim_start_seconds);
    const trimEndRaw = Number(body.trim_end_seconds);
    const trimStartSeconds = Number.isFinite(trimStartRaw)
      ? Math.min(Math.max(trimStartRaw, 0), duration) : 0;
    const trimEndSeconds = Number.isFinite(trimEndRaw)
      ? Math.min(Math.max(trimEndRaw, trimStartSeconds), duration) : duration;
    const contentDisclosure = body.content_disclosure === true;
    let linkUrl = null;
    if (typeof body.link_url === "string") {
      const trimmedLink = body.link_url.trim().slice(0, 300);
      if (trimmedLink) linkUrl = trimmedLink;
    }

    // --- File verification (server-side size is ground truth) ---
    let file;
    try {
      file = await storage.getFile({ bucketId: MEDIA_BUCKET, fileId: uploadedFileId });
    } catch (e) {
      if (isNotFound(e)) throw badRequest("Uploaded file was not found. Upload the file first, then call this function.");
      throw e;
    }
    const serverSize = typeof file.sizeOriginal === "number" ? file.sizeOriginal : claimedSize;
    if (serverSize > MAX_BYTES) throw badRequest("Video file is too large.");
    // Ownership: if the file carries permissions and none of them
    // names the caller, the file is not theirs to publish.
    const filePerms = file.$permissions || [];
    if (filePerms.length > 0 && !filePerms.some((p) => permissionNamesUser(p, callerId))) {
      throw forbidden("Uploaded file does not belong to the caller.");
    }
    if (thumbnailFileId) {
      try {
        await storage.getFile({ bucketId: MEDIA_BUCKET, fileId: thumbnailFileId });
      } catch (e) {
        if (isNotFound(e)) throw badRequest("Thumbnail file was not found.");
        throw e;
      }
    }

    const isDraft = body.is_draft === true;
    const caption = String(body.caption || "").slice(0, 300);
    // Direct publish (2026-11-03, no pre-publication review): a
    // non-draft post is created LIVE with the exact status value the
    // feed query already uses ("approved") and published_at set now.
    // A draft stays "draft" with no published_at until
    // publish-draft flips it live.
    const nowIso = new Date().toISOString();
    const liveStatus = isDraft ? "draft" : "approved";
    const publicRead = liveStatus === "approved" && visibility === "public";
    // thumbnail_path: a file id when the thumbnail was uploaded as a
    // file; a short data URL / external URL verbatim when it fits the
    // 2048-char attribute; otherwise null. Slicing a data URL would
    // corrupt it, so never slice.
    let thumbnailPath = null;
    if (thumbnailFileId) thumbnailPath = thumbnailFileId;
    else if (thumbnailPathRaw && thumbnailPathRaw.length <= 2048) thumbnailPath = thumbnailPathRaw;

    const video = await createRow(db, ctx.cfg, COL.videos, ID.unique(), {
      creator_id: callerId,
      caption,
      location,
      sound_id: soundId,
      sound_title: soundTitle,
      sound_category: soundCategory,
      trim_start_seconds: trimStartSeconds,
      trim_end_seconds: trimEndSeconds,
      content_disclosure: contentDisclosure,
      link_url: linkUrl,
      storage_provider: "appwrite",
      storage_path: uploadedFileId,
      thumbnail_path: thumbnailPath,
      duration_seconds: duration,
      size_bytes: serverSize || null,
      visibility,
      moderation_status: liveStatus,
      rejection_reason: null,
      published_at: isDraft ? null : nowIso,
      like_count: 0,
      comment_count: 0,
      view_count: 0,
      filter,
      poll_question: pollQuestion,
      poll_option_a: pollOptionA,
      poll_option_b: pollOptionB,
      duet_of: duetOf,
      reply_comment_id: replyCommentId,
      reply_video_id: replyVideoId,
    }, videoDocPermissions(callerId, { publicRead }));

    // No video_categories rows are created (categories removed from
    // the upload flow 2026-11-03). Legacy rows for older videos
    // are cleaned up only by delete-video / delete-account.

    await createRow(db, ctx.cfg, COL.moderationEvents, ID.unique(), {
      video_id: video.$id,
      event_type: "uploaded",
      details: JSON.stringify({ duration_seconds: duration, size_bytes: serverSize, moderation_status: liveStatus }),
    });

    // @mentions, best-effort and never blocking; drafts notify on
    // publish instead (the client sends those).
    if (!isDraft) {
      try {
        const names = [...new Set([...caption.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
        for (const name of names) {
          try {
            const target = await listOne(db, ctx.cfg, COL.publicProfiles, [Query.equal("username", name)]);
            if (!target || String(target.$id) === String(callerId)) continue;
            await createRow(db, ctx.cfg, COL.notifications, ID.unique(), {
              user_id: target.$id, type: "mention", actor_id: callerId, video_id: video.$id, is_read: false,
            }, notificationPermissions(target.$id));
          } catch (_e) {
            // One failed mention never blocks the upload or others.
          }
        }
      } catch (_e) {
        // Mentions never block an upload.
      }
    }

    await normalizeFilePermissions(storage, uploadedFileId, callerId, { publicRead }, logFn);
    if (thumbnailFileId) await normalizeFilePermissions(storage, thumbnailFileId, callerId, { publicRead }, logFn);

    // Original audio, live post only: register the video's own
    // audio as a catalog sound (best-effort; never fails the
    // upload — see registerOriginalSound; a warning is logged
    // here in the standalone handler's log format).
    if (!isDraft && !soundId) {
      const soundWarning = await registerOriginalSound(db, ctx.cfg, { video, creatorId: callerId, videoId: video.$id });
      if (soundWarning) logFn(`create-upload: original-sound registration failed for video ${video.$id}: ${soundWarning}`);
    }

    return video;
  } catch (e) {
    const status = e instanceof HttpError ? e.status : appwriteStatus(e);
    // Orphan cleanup on validation failure (400/403): delete the
    // uploaded file (and thumbnail) when they belong to the caller,
    // so a refused upload leaves no unreferenced file behind.
    // The dispatcher supplies the error envelope and log line.
    if ((status === 400 || status === 403) && storage && callerId) {
      if (uploadedFileId) await deleteOrphanIfOwned(storage, uploadedFileId, callerId, logFn);
      if (thumbnailFileId) await deleteOrphanIfOwned(storage, thumbnailFileId, callerId, logFn);
    }
    throw e;
  }
}

async function actionDeleteAccount(ctx, body) {
  // Port of the standalone `delete-account` handler, preserving its
  // cascade order and semantics exactly. The request body is
  // ignored; the target id always comes from the caller's JWT
  // (ctx.callerId, resolved by the dispatcher), never from the
  // body. Reused router helpers, all semantically identical to
  // the standalone equivalents: listAll, deleteRow (404 -> false),
  // deleteRowsByQuery (re-lists from offset 0 each round), and
  // isNotFound. The Users delete runs LAST, only after data
  // deletion succeeds; partial failure is an error, never silent
  // success, and deleting an already-deleted document or file
  // counts as success (idempotent retry). No return value: the
  // dispatcher JSON-drops `data: undefined`, so the wire response
  // is exactly { ok: true } as the standalone handler returned.
  void body;
  const { db, storage, teams, users, callerId, errFn } = ctx;
  const userId = callerId;
  const failures = [];

  // 1. Files: collect file ids from the user's videos and stories
  // before deleting any document that names them.
  const videos = await listAll(db, ctx.cfg, COL.videos, [Query.equal("creator_id", userId)]);
  const videoIds = videos.map((v) => String(v.$id));
  for (const video of videos) {
    await deleteFileBestEffort(storage, video.storage_path, failures, "video");
    await deleteFileBestEffort(storage, video.thumbnail_path, failures, "thumbnail");
  }
  const stories = await listAll(db, ctx.cfg, COL.stories, [Query.equal("user_id", userId)]);
  for (const story of stories) {
    await deleteFileBestEffort(storage, story.storage_path, failures, "story");
  }
  if (failures.length > 0) {
    throw new HttpError(500, `Account deletion failed while deleting files: ${failures.join("; ")}`);
  }

  // 2a. Per-video children, then the video documents themselves.
  for (const video of videos) {
    const videoId = String(video.$id);
    const comments = await listAll(db, ctx.cfg, COL.comments, [Query.equal("video_id", videoId)]);
    for (const comment of comments) {
      await deleteRowsByQuery(db, ctx.cfg, COL.commentLikes, "comment_id", comment.$id);
      await deleteRow(db, ctx.cfg, COL.comments, comment.$id);
    }
    await deleteRowsByQuery(db, ctx.cfg, COL.videoCategories, "video_id", videoId);
    await deleteRowsByQuery(db, ctx.cfg, COL.videoLikes, "video_id", videoId);
    await deleteRowsByQuery(db, ctx.cfg, COL.savedVideos, "video_id", videoId);
    await deleteRowsByQuery(db, ctx.cfg, COL.pollVotes, "video_id", videoId);
    await deleteRowsByQuery(db, ctx.cfg, COL.watchHistory, "video_id", videoId);
    await deleteRow(db, ctx.cfg, COL.videos, videoId);
  }
  // 2b. Per-story children, then the story documents.
  for (const story of stories) {
    await deleteRowsByQuery(db, ctx.cfg, COL.storyViews, "story_id", story.$id);
    await deleteRow(db, ctx.cfg, COL.stories, story.$id);
  }

  // 2c. Every other collection that references the user.
  await deleteRowsByQuery(db, ctx.cfg, COL.follows, "follower_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.follows, "following_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.videoLikes, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.savedVideos, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.blockedUsers, "blocker_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.blockedUsers, "blocked_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.commentLikes, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.pollVotes, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.watchHistory, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.storyViews, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.messages, "sender_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.messages, "recipient_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.notifications, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.reports, "reporter_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.verificationRequests, "user_id", userId);
  await deleteRowsByQuery(db, ctx.cfg, COL.accountEvents, "user_id", userId);
  // Remaining comments authored by the user on other creators'
  // videos (their own videos' comments were removed above).
  const ownComments = await listAll(db, ctx.cfg, COL.comments, [Query.equal("user_id", userId)]);
  for (const comment of ownComments) {
    await deleteRowsByQuery(db, ctx.cfg, COL.commentLikes, "comment_id", comment.$id);
    await deleteRow(db, ctx.cfg, COL.comments, comment.$id);
  }

  // 2d. SET NULL history (kept, references cleared).
  await nullAttributeByQuery(db, ctx.cfg, COL.moderationReviews, "reviewer_id", userId, "reviewer_id");
  await nullAttributeByQuery(db, ctx.cfg, COL.adminActions, "admin_id", userId, "admin_id");
  for (const videoId of videoIds) {
    await nullAttributeByQuery(db, ctx.cfg, COL.moderationEvents, "video_id", videoId, "video_id");
  }

  // 2e. The user's own single-id documents. The public copy is
  // deleted directly as well as via the `events` sync, so no
  // ordering assumption on the sync is needed.
  await deleteRow(db, ctx.cfg, COL.userPreferences, userId);
  await deleteRow(db, ctx.cfg, COL.publicProfiles, userId);
  await deleteRow(db, ctx.cfg, COL.profiles, userId);

  // 3. Team membership (single first page, as the standalone
  // handler did; a failure here is logged and never blocks the
  // Auth delete below).
  try {
    const memberships = await teams.listMemberships({
      teamId: TEAM_ID,
      queries: [Query.limit(100), Query.offset(0)],
    });
    const list = memberships.memberships || memberships.documents || [];
    for (const m of list) {
      if (String(m.userId) === String(userId)) {
        await teams.deleteMembership({ teamId: TEAM_ID, membershipId: m.$id });
      }
    }
  } catch (e) {
    if (!isNotFound(e)) {
      errFn(`delete-account: team removal failed (continuing): ${e && e.message ? e.message : e}`);
    }
  }

  // 4. Auth user, last.
  await users.delete({ userId });
}

async function actionCreateProfile(ctx, body) {
  const { db, callerId } = ctx;
  const rawUsername = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME_RE.test(rawUsername)) {
    throw badRequest("Username must be 3-24 characters: lowercase letters, numbers, underscore, or dot.");
  }
  const displayName = sliceText(body.display_name !== undefined ? body.display_name : rawUsername, 60);

  const existing = await getRow(db, ctx.cfg, COL.profiles, callerId);
  if (existing) return { profile: existing, existing: true };

  // Uniqueness against both the public copy (the lookup other users
  // use) and the private table. The unique indexes are the backstop;
  // a 409 from either create below is mapped to the same message.
  const clashPublic = await listOne(db, ctx.cfg, COL.publicProfiles, [Query.equal("username", rawUsername)]);
  if (clashPublic && String(clashPublic.$id) !== String(callerId)) {
    throw conflict("That username is taken.");
  }
  const clashProfile = await listOne(db, ctx.cfg, COL.profiles, [Query.equal("username", rawUsername)]);
  if (clashProfile) throw conflict("That username is taken.");

  const profileData = {
    username: rawUsername,
    display_name: displayName,
    bio: "",
    avatar_url: null,
    website: "",
    role: "user",
    is_suspended: false,
    verified: false,
    private_account: false,
  };
  let profile;
  try {
    profile = await createRow(db, ctx.cfg, COL.profiles, callerId, profileData, profileDocPermissions(callerId));
  } catch (e) {
    if (isConflict(e)) throw conflict("That username is taken.");
    throw e;
  }
  // Create the public copy synchronously so signup is immediately
  // consistent; the `events` sync remains as the backstop/repair path
  // and is idempotent against this row.
  try {
    await createRow(db, ctx.cfg, COL.publicProfiles, callerId, {
      ...safePublicFields(profile),
      verified: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      await deleteRow(db, ctx.cfg, COL.profiles, callerId);
      throw conflict("That username is taken.");
    }
    // A public-copy failure must not leave a profile with no public
    // presence: roll the profile back so the caller can retry cleanly.
    await deleteRow(db, ctx.cfg, COL.profiles, callerId);
    throw e;
  }
  return { profile };
}

async function actionIncrementView(ctx, body) {
  const { db } = ctx;
  const videoId = requireString(body.videoId || body.video_id, "videoId");
  const video = await getRow(db, ctx.cfg, COL.videos, videoId);
  if (!video) throw notFound("Video not found.");
  if (video.moderation_status !== "approved") {
    return { videoId, view_count: video.view_count || 0, counted: false };
  }
  const next = (typeof video.view_count === "number" ? video.view_count : 0) + 1;
  const updated = await updateRow(db, ctx.cfg, COL.videos, videoId, { view_count: next });
  return { videoId, view_count: updated.view_count ?? next, counted: true };
}

// Best-effort original-sound registration for publish-draft (also
// used by the merged `create-upload` action below). Only for videos
// with no sound_id, deduped by a `sounds`
// query on video_id first, title "Original sound — @<username>" from
// a best-effort public_profiles lookup (fallback "Original sound"),
// category "original", creator_id = the video creator, video_id,
// storage_path = the video's storage path, duration_seconds = the
// video duration, source_type "original", status "live",
// report_count 0, source "Original sound from video". Never throws:
// every failure is caught and returned as a warning string, so
// registration can never fail a publish whose video row is already
// live. The api dispatcher has no logger in ctx, so the warning is
// surfaced through the action's warnings array (the same pattern
// the file flips use), like create-upload's log line. Returns null
// on success or when skipped (already registered, or no usable
// storage path: sounds.storage_path is required in schema.json, so
// an empty path cannot be stored and registration is skipped
// silently rather than failing the publish).
async function registerOriginalSound(db, cfg, { video, creatorId, videoId }) {
  try {
    const id = video.$id || videoId;
    const storagePath = typeof video.storage_path === "string" ? video.storage_path.trim() : "";
    if (!storagePath) return null;
    const existing = await listOne(db, cfg, COL.sounds, [Query.equal("video_id", id)]);
    if (existing) return null;
    let username = null;
    try {
      const pub = await getRow(db, cfg, COL.publicProfiles, creatorId);
      if (pub && typeof pub.username === "string" && pub.username.trim()) {
        username = pub.username.trim();
      }
    } catch (_e) {
      // Username lookup is best-effort; the fallback title below
      // is used when the profile is missing or unreadable.
    }
    await createRow(db, cfg, COL.sounds, ID.unique(), {
      title: username ? `Original sound — @${username}` : "Original sound",
      category: "original",
      duration_seconds: video.duration_seconds,
      storage_path: storagePath,
      source: "Original sound from video",
      creator_id: creatorId,
      video_id: id,
      source_type: "original",
      status: "live",
      report_count: 0,
    }, soundDocPermissions());
    return null;
  } catch (e) {
    return `original sound: ${e && e.message ? e.message : "failed"}`;
  }
}

async function actionPublishDraft(ctx, body) {
  // Direct publish (2026-11-03): publishing a draft puts it LIVE
  // immediately — moderation_status "approved" (the exact value the
  // feed query uses), published_at set, document + file permissions
  // flipped to the live template. There is no "pending" step and no
  // pre-publication review for videos. (Stories keep their own
  // pre-publication review via moderate-story; this action is
  // videos only.) Mention notifications on publish remain the
  // client's job, as before. Original sounds: when a draft with no
  // sound_id goes live, an original sound is registered best-effort
  // (mirroring create-upload) — a registration failure never fails
  // the publish (see registerOriginalSound above).
  const { db, storage, callerId } = ctx;
  const videoId = requireString(body.videoId || body.video_id, "videoId");
  const video = await getRow(db, ctx.cfg, COL.videos, videoId);
  if (!video) throw notFound("Video not found.");
  if (String(video.creator_id) !== String(callerId)) throw forbidden("Only the owner can publish this draft.");
  if (video.moderation_status !== "draft") throw new HttpError(409, "Video is not a draft.");
  const creatorId = String(video.creator_id);
  const publicRead = video.visibility === "public";
  const nowIso = new Date().toISOString();
  const updated = await updateRow(
    db, ctx.cfg, COL.videos, videoId,
    { moderation_status: "approved", published_at: video.published_at || nowIso, rejection_reason: null },
    videoDocPermissions(creatorId, { publicRead }),
  );
  await createRow(db, ctx.cfg, COL.moderationEvents, ID.unique(), {
    video_id: videoId,
    event_type: "published",
    details: JSON.stringify({ from: "draft", moderation_status: "approved" }),
  });
  const warnings = [];
  const videoFlip = await flipFile(storage, video.storage_path, creatorId, { publicRead });
  if (videoFlip) warnings.push(`video file: ${videoFlip}`);
  const thumbFlip = await flipFile(storage, video.thumbnail_path, creatorId, { publicRead });
  if (thumbFlip) warnings.push(`thumbnail file: ${thumbFlip}`);
  // Original audio, live post only: register the video's own audio
  // as a catalog sound, after the video row is live (best-effort;
  // never fails the publish — see registerOriginalSound).
  if (!video.sound_id) {
    const soundWarning = await registerOriginalSound(db, ctx.cfg, { video, creatorId, videoId });
    if (soundWarning) warnings.push(soundWarning);
  }
  return { video: updated, warnings };
}

async function actionSetCommentPin(ctx, body) {
  const { db, callerId } = ctx;
  const commentId = requireString(body.commentId || body.comment_id || body.p_comment_id, "commentId");
  const comment = await getRow(db, ctx.cfg, COL.comments, commentId);
  if (!comment) throw notFound("Comment not found.");
  const video = await getRow(db, ctx.cfg, COL.videos, comment.video_id);
  if (!video) throw notFound("Video not found.");
  if (String(video.creator_id) !== String(callerId)) {
    throw forbidden("Only the video creator can pin comments.");
  }
  let pinned;
  if (typeof body.pinned === "boolean") pinned = body.pinned;
  else if (typeof body.p_pinned === "boolean") pinned = body.p_pinned;
  else pinned = comment.is_pinned !== true;
  if (pinned) {
    const pinnedOthers = await listAll(db, ctx.cfg, COL.comments, [
      Query.equal("video_id", comment.video_id),
      Query.equal("is_pinned", true),
    ]);
    for (const other of pinnedOthers) {
      if (String(other.$id) !== String(commentId)) {
        await updateRow(db, ctx.cfg, COL.comments, other.$id, { is_pinned: false });
      }
    }
  }
  const updated = await updateRow(db, ctx.cfg, COL.comments, commentId, { is_pinned: pinned });
  return { comment: updated };
}

async function actionModerateVideo(ctx, body) {
  // POST-moderation only (2026-11-03): new videos are published
  // live by create-upload and NEVER pass through this action as a
  // gate. This action exists to act on live/reported videos after
  // publication: "rejected" removes/hides a video (feed + file go
  // private), "needs_review" flags it the same way, and "approved"
  // restores a removed/flagged video to live. There is no
  // "approve to publish" step for new posts.
  const { db, storage, callerId } = ctx;
  const videoId = requireString(body.videoId || body.video_id, "videoId");
  const decision = requireString(body.decision || body.moderation_status || body.status, "decision");
  if (!VIDEO_DECISIONS.includes(decision)) throw badRequest("decision must be approved, rejected, or needs_review.");
  const reason500 = optionalString(body.reason || body.rejection_reason, 500);
  const reason1000 = optionalString(body.reason || body.rejection_reason, 1000);

  const video = await getRow(db, ctx.cfg, COL.videos, videoId);
  if (!video) throw notFound("Video not found.");
  const creatorId = String(video.creator_id);
  const isPublic = video.visibility === "public";
  const nowIso = new Date().toISOString();
  const patch = {
    moderation_status: decision,
    rejection_reason: decision === "rejected" ? reason500 : null,
  };
  if (decision === "approved" && !video.published_at) patch.published_at = nowIso;
  const publicRead = decision === "approved" && isPublic;
  const updated = await updateRow(
    db, ctx.cfg, COL.videos, videoId, patch, videoDocPermissions(creatorId, { publicRead }),
  );

  await createRow(db, ctx.cfg, COL.moderationReviews, ID.unique(), {
    video_id: videoId,
    reviewer_id: callerId,
    decision,
    reason: reason1000,
  });
  await createRow(db, ctx.cfg, COL.moderationEvents, ID.unique(), {
    video_id: videoId,
    event_type: decision,
    details: JSON.stringify({ decision, reason: reason1000, reviewer_id: callerId }),
  });

  // File flips after the row write (safe direction: a failed flip
  // leaves the file private/unplayable rather than public).
  const warnings = [];
  const videoFlip = await flipFile(storage, video.storage_path, creatorId, { publicRead });
  if (videoFlip) warnings.push(`video file: ${videoFlip}`);
  const thumbFlip = await flipFile(storage, video.thumbnail_path, creatorId, { publicRead });
  if (thumbFlip) warnings.push(`thumbnail file: ${thumbFlip}`);

  // Creator notification is best-effort: it must never roll back an
  // approval that has already been written and audited.
  try {
    await insertNotification(db, ctx.cfg, {
      userId: creatorId, type: "moderation", actorId: callerId, videoId,
    });
  } catch (e) {
    warnings.push(`notification: ${e && e.message ? e.message : "failed"}`);
  }
  return { video: updated, warnings };
}

async function actionModerateStory(ctx, body) {
  const { db, storage } = ctx;
  const storyId = requireString(body.storyId || body.story_id, "storyId");
  const status = requireString(body.status || body.decision || body.moderation_status, "status");
  if (!STORY_STATUSES.includes(status)) throw badRequest("status must be pending, approved, or rejected.");
  const story = await getRow(db, ctx.cfg, COL.stories, storyId);
  if (!story) throw notFound("Story not found.");
  const ownerId = String(story.user_id);
  const publicRead = status === "approved";
  const updated = await updateRow(
    db, ctx.cfg, COL.stories, storyId,
    { moderation_status: status },
    storyDocPermissions(ownerId, { publicRead }),
  );
  const warnings = [];
  const flip = await flipFile(storage, story.storage_path, ownerId, { publicRead });
  if (flip) warnings.push(`story file: ${flip}`);
  return { story: updated, warnings };
}

async function actionModerateComment(ctx, body) {
  const { db } = ctx;
  const commentId = requireString(body.commentId || body.comment_id, "commentId");
  const status = requireString(body.status || body.decision || body.moderation_status, "status");
  if (!COMMENT_STATUSES.includes(status)) throw badRequest("status must be visible, hidden, or removed.");
  const comment = await getRow(db, ctx.cfg, COL.comments, commentId);
  if (!comment) throw notFound("Comment not found.");
  const authorId = String(comment.user_id);
  const permissions = status === "visible"
    ? [perm.readAny(), perm.updateUser(authorId), perm.updateTeam(), perm.deleteUser(authorId), perm.deleteTeam()]
    : [perm.readUser(authorId), perm.readTeam(), perm.updateUser(authorId), perm.updateTeam(), perm.deleteUser(authorId), perm.deleteTeam()];
  const updated = await updateRow(
    db, ctx.cfg, COL.comments, commentId, { moderation_status: status }, permissions,
  );
  return { comment: updated };
}

async function actionDecideVerification(ctx, body) {
  const { db, callerId } = ctx;
  const requestId = requireString(body.requestId || body.request_id || body.id, "requestId");
  const decision = requireString(body.decision || body.status, "decision");
  if (!VERIFICATION_DECISIONS.includes(decision)) throw badRequest("decision must be approved or rejected.");
  const request = await getRow(db, ctx.cfg, COL.verificationRequests, requestId);
  if (!request) throw notFound("Verification request not found.");
  const nowIso = new Date().toISOString();
  const updated = await updateRow(db, ctx.cfg, COL.verificationRequests, requestId, {
    status: decision,
    decided_at: nowIso,
    decided_by: callerId,
  });
  const warnings = [];
  if (decision === "approved") {
    const applicantId = String(request.user_id);
    const profile = await getRow(db, ctx.cfg, COL.profiles, applicantId);
    if (profile) {
      await updateRow(db, ctx.cfg, COL.profiles, applicantId, { verified: true });
      const pub = await getRow(db, ctx.cfg, COL.publicProfiles, applicantId);
      if (pub) {
        await updateRow(db, ctx.cfg, COL.publicProfiles, applicantId, { verified: true });
      } else {
        try {
          await createRow(db, ctx.cfg, COL.publicProfiles, applicantId, {
            ...safePublicFields(profile),
            verified: true,
          });
        } catch (e) {
          warnings.push(`public profile repair: ${e && e.message ? e.message : "failed"}`);
        }
      }
    } else {
      warnings.push("applicant profile not found; verified flag was not set.");
    }
    try {
      await insertNotification(db, ctx.cfg, { userId: applicantId, type: "system" });
    } catch (e) {
      warnings.push(`notification: ${e && e.message ? e.message : "failed"}`);
    }
  }
  return { request: updated, warnings };
}

async function actionDecideReport(ctx, body) {
  const { db } = ctx;
  const reportId = requireString(body.reportId || body.report_id || body.id, "reportId");
  const status = requireString(body.status, "status");
  if (!REPORT_STATUSES.includes(status)) throw badRequest("status must be open, reviewed, or dismissed.");
  const report = await getRow(db, ctx.cfg, COL.reports, reportId);
  if (!report) throw notFound("Report not found.");
  const updated = await updateRow(db, ctx.cfg, COL.reports, reportId, { status });
  return { report: updated };
}

// Flip every approved+public video/story file of one creator between
// public read and owner+team-only read. Used by suspend/unsuspend.
async function flipCreatorFiles(ctx, userId, { publicRead }) {
  const { db, storage } = ctx;
  const warnings = [];
  const videos = await listAll(db, ctx.cfg, COL.videos, [Query.equal("creator_id", userId)]);
  for (const video of videos) {
    if (!(video.moderation_status === "approved" && video.visibility === "public")) continue;
    const flip = await flipFile(storage, video.storage_path, userId, { publicRead });
    if (flip) warnings.push(`video ${video.$id}: ${flip}`);
    const thumbFlip = await flipFile(storage, video.thumbnail_path, userId, { publicRead });
    if (thumbFlip) warnings.push(`thumbnail ${video.$id}: ${thumbFlip}`);
  }
  const stories = await listAll(db, ctx.cfg, COL.stories, [Query.equal("user_id", userId)]);
  for (const story of stories) {
    if (story.moderation_status !== "approved") continue;
    const flip = await flipFile(storage, story.storage_path, userId, { publicRead });
    if (flip) warnings.push(`story ${story.$id}: ${flip}`);
  }
  return warnings;
}

async function actionSuspendUser(ctx, body, { suspend }) {
  const { db } = ctx;
  const userId = requireString(body.userId || body.user_id, "userId");
  const profile = await getRow(db, ctx.cfg, COL.profiles, userId);
  if (!profile) throw notFound("Profile not found.");
  const updated = await updateRow(db, ctx.cfg, COL.profiles, userId, { is_suspended: suspend });
  if (suspend) {
    await deleteRow(db, ctx.cfg, COL.publicProfiles, userId);
  } else {
    const existing = await getRow(db, ctx.cfg, COL.publicProfiles, userId);
    if (!existing) {
      await createRow(db, ctx.cfg, COL.publicProfiles, userId, {
        ...safePublicFields(updated),
        // The profile row is the source of truth for the badge; the
        // sync event deliberately never copies it, so unsuspend must
        // restore it from here or a verified user loses the tick.
        verified: updated.verified === true,
      });
    }
  }
  const warnings = await flipCreatorFiles(ctx, userId, { publicRead: !suspend });
  return { profile: updated, warnings };
}

async function actionSetRole(ctx, body) {
  const { db, teams, callerId } = ctx;
  void callerId;
  const userId = requireString(body.userId || body.user_id, "userId");
  const role = requireString(body.role, "role");
  if (!ROLES.includes(role)) throw badRequest("role must be user, moderator, or admin.");
  // The mirror may only follow a membership that already exists: the
  // caller creates/removes the Team membership in the Console first.
  const targetRoles = await teamRoles(teams, userId);
  const matches =
    role === "admin"
      ? targetRoles.has("admin") || targetRoles.has("owner")
      : role === "moderator"
        ? targetRoles.has("moderator")
        : !targetRoles.has("admin") && !targetRoles.has("moderator") && !targetRoles.has("owner");
  if (!matches) {
    throw new HttpError(409, "Team membership does not match the requested role. Create or remove the membership first, then set the role mirror.");
  }
  const profile = await getRow(db, ctx.cfg, COL.profiles, userId);
  if (!profile) throw notFound("Profile not found.");
  const updated = await updateRow(db, ctx.cfg, COL.profiles, userId, { role });
  return { profile: updated };
}

async function deleteRowsByQuery(db, cfg, tableId, attribute, value) {
  let deleted = 0;
  for (let round = 0; round < 100; round++) {
    const res = await db.listRows({
      ...dbArgs(cfg, tableId),
      queries: [Query.equal(attribute, value), Query.limit(100), Query.offset(0)],
    });
    const batch = res.rows || res.documents || [];
    if (batch.length === 0) break;
    for (const row of batch) {
      await deleteRow(db, cfg, tableId, row.$id);
      deleted++;
    }
  }
  return deleted;
}

async function actionDeleteVideo(ctx, body) {
  const { db, storage, callerId, isStaff } = ctx;
  const videoId = requireString(body.videoId || body.video_id, "videoId");
  const video = await getRow(db, ctx.cfg, COL.videos, videoId);
  if (!video) throw notFound("Video not found.");
  if (!isStaff && String(video.creator_id) !== String(callerId)) {
    throw forbidden("Only the owner or a moderator can delete this video.");
  }
  const creatorId = String(video.creator_id);
  // Children first (no cascades exist): comments and their likes,
  // then the remaining per-video rows, then files, then the video.
  const comments = await listAll(db, ctx.cfg, COL.comments, [Query.equal("video_id", videoId)]);
  for (const comment of comments) {
    await deleteRowsByQuery(db, ctx.cfg, COL.commentLikes, "comment_id", comment.$id);
    await deleteRow(db, ctx.cfg, COL.comments, comment.$id);
  }
  await deleteRowsByQuery(db, ctx.cfg, COL.videoCategories, "video_id", videoId);
  await deleteRowsByQuery(db, ctx.cfg, COL.videoLikes, "video_id", videoId);
  await deleteRowsByQuery(db, ctx.cfg, COL.savedVideos, "video_id", videoId);
  await deleteRowsByQuery(db, ctx.cfg, COL.pollVotes, "video_id", videoId);
  // Watch history is not in the spec's delete-video list, but leaving
  // rows that point at a deleted video is exactly the orphan a
  // cascade exists to prevent; deleting them is harmless (the client
  // drops missing videos from history joins anyway).
  await deleteRowsByQuery(db, ctx.cfg, COL.watchHistory, "video_id", videoId);

  const warnings = [];
  for (const fileId of [video.storage_path, video.thumbnail_path]) {
    if (!isFileId(fileId)) continue;
    try {
      await storage.deleteFile({ bucketId: MEDIA_BUCKET, fileId });
    } catch (e) {
      if (!isNotFound(e)) warnings.push(`file ${fileId}: ${e && e.message ? e.message : "failed"}`);
    }
  }
  void creatorId;
  await deleteRow(db, ctx.cfg, COL.videos, videoId);
  // Moderation review/event rows are audit history and are kept.
  return { deleted: videoId, warnings };
}

async function actionNotify(ctx, body) {
  const { db, callerId } = ctx;
  const userId = requireString(body.userId || body.user_id || body.toUserId, "userId");
  const type = requireString(body.type, "type");
  if (!NOTIFICATION_TYPES.includes(type) || type === "system") {
    throw badRequest("type must be follow, like, comment, share, or mention (system notices are function-only).");
  }
  if (userId === callerId) throw badRequest("Cannot notify yourself.");
  const notification = await insertNotification(db, ctx.cfg, {
    userId,
    type,
    actorId: callerId,
    videoId: body.videoId || body.video_id || null,
    commentId: body.commentId || body.comment_id || null,
  });
  return { notification };
}

async function actionFileReport(ctx, body) {
  const { db, callerId } = ctx;
  const targetType = requireString(body.target_type || body.targetType, "target_type");
  if (!REPORT_TYPES.includes(targetType)) throw badRequest("target_type must be video, comment, user, or sound.");
  const targetId = requireString(body.target_id || body.targetId, "target_id");
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw badRequest("reason must be 3-500 characters.");
  }
  const report = await createRow(db, ctx.cfg, COL.reports, ID.unique(), {
    reporter_id: callerId,
    target_type: targetType,
    target_id: targetId,
    reason,
    status: "open",
  }, [
    perm.readUser(callerId), perm.readTeam(),
    perm.updateTeam(), perm.deleteTeam(),
  ]);
  return { report };
}

async function actionSendMessage(ctx, body) {
  const { db, callerId } = ctx;
  const recipientId = requireString(body.recipientId || body.recipient_id || body.toUserId, "recipientId");
  if (recipientId === callerId) throw badRequest("You cannot message yourself.");
  const text = String(body.body !== undefined ? body.body : body.message || "").trim();
  if (text.length < 1 || text.length > 1000) {
    throw badRequest("body must be 1-1000 characters.");
  }
  const message = await createRow(db, ctx.cfg, COL.messages, ID.unique(), {
    sender_id: callerId,
    recipient_id: recipientId,
    body: text,
    is_read: false,
  }, [
    perm.readUser(callerId), perm.readUser(recipientId),
    perm.updateUser(recipientId),
  ]);
  return { message };
}

async function actionCheckAllowPrefs(ctx, body) {
  const { db } = ctx;
  const userId = requireString(body.userId || body.user_id, "userId");
  const defaults = {
    allow_comment: "everyone",
    allow_mention: "everyone",
    allow_like: "everyone",
    allow_download: "everyone",
    view_follow_list: "everyone",
  };
  const prefs = await getRow(db, ctx.cfg, COL.userPreferences, userId);
  if (!prefs) return { userId, ...defaults };
  const out = { userId };
  for (const key of ALLOW_KEYS) {
    out[key] = ALLOW_KEYS.includes(key) && typeof prefs[key] === "string" ? prefs[key] : defaults[key];
  }
  return out;
}

// --- Sounds (user-added, direct-to-library; R7 superseded 2026-11-03) ---

// Best-effort staff check for actions whose auth level is
// "signed-in" but whose behaviour depends on staff status
// (create-sound sets source_type "admin" for team staff). Never
// throws: a failed lookup means "not staff", never a denied call.
async function callerIsStaff(teams, callerId) {
  try {
    const roles = await teamRoles(teams, callerId);
    return roles.has("admin") || roles.has("moderator") || roles.has("owner");
  } catch (_e) {
    return false;
  }
}

// The shape the client library expects for a sounds row: the
// document fields under stable client names ($id -> id), plus the
// ownership/status fields the library and staff tooling read.
function mapSoundRow(row) {
  if (!row) return null;
  return {
    id: row.$id,
    title: row.title,
    category: row.category,
    duration_seconds: row.duration_seconds === undefined ? null : row.duration_seconds,
    storage_path: row.storage_path,
    source: row.source === undefined ? null : row.source,
    creator_id: row.creator_id === undefined ? null : row.creator_id,
    source_type: row.source_type === undefined ? null : row.source_type,
    video_id: row.video_id === undefined ? null : row.video_id,
    status: row.status === undefined ? null : row.status,
    report_count: row.report_count === undefined ? null : row.report_count,
  };
}

function soundDocPermissions() {
  // The §5.24 document-permission template: public read, team-only
  // update/delete. Every sounds row created by a function carries
  // exactly this set, whoever the creator is.
  return [perm.readAny(), perm.updateTeam(), perm.deleteTeam()];
}

async function actionCreateSound(ctx, body) {
  const { db, teams, callerId } = ctx;
  const title = requireString(body.title, "title", { max: 80 });
  const rawCategory = typeof body.category === "string" ? body.category.trim() : "";
  if (!SOUND_CATEGORIES.includes(rawCategory)) {
    // "original" is deliberately absent from SOUND_CATEGORIES: it
    // is auto-only (create-upload registers original sounds) and
    // must be rejected from this action, as must any unknown tab.
    throw badRequest("category must be sound-effects, naat, taqreer, or islamic.");
  }
  const storagePath = requireString(body.storage_path || body.storagePath, "storage_path", { max: 512 });
  let durationSeconds = null;
  if (body.duration_seconds !== undefined && body.duration_seconds !== null) {
    const parsed = Number(body.duration_seconds);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw badRequest("duration_seconds must be a number >= 0 when supplied.");
    }
    durationSeconds = parsed;
  }
  const source = body.source === undefined || body.source === null
    ? null
    : String(body.source).slice(0, 120) || null;
  // Server-decided fields only: creator_id, source_type and status
  // are NEVER accepted from the caller body, even if sent.
  const isStaff = await callerIsStaff(teams, callerId);
  const row = await createRow(db, ctx.cfg, COL.sounds, ID.unique(), {
    title,
    category: rawCategory,
    duration_seconds: durationSeconds,
    storage_path: storagePath,
    source,
    creator_id: callerId,
    source_type: isStaff ? "admin" : "user",
    video_id: null,
    status: "live",
    report_count: 0,
  }, soundDocPermissions());
  return { sound: mapSoundRow(row) };
}

async function actionReportSound(ctx, body) {
  const { db, callerId } = ctx;
  const soundId = requireString(body.sound_id || body.soundId, "sound_id");
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 500) {
    throw badRequest("reason is required and must be at most 500 characters.");
  }
  const sound = await getRow(db, ctx.cfg, COL.sounds, soundId);
  if (!sound) throw notFound("Sound not found.");
  // Mirrors actionFileReport: reporter forced to the caller,
  // status "open", reporter+team document permissions. The
  // reports target_type enum gains "sound" for this action
  // (schema.json §reports); reported sounds stay visible — there
  // is no auto-hide. Staff removal is the separate remove-sound
  // action.
  const report = await createRow(db, ctx.cfg, COL.reports, ID.unique(), {
    reporter_id: callerId,
    target_type: "sound",
    target_id: soundId,
    reason,
    status: "open",
  }, [
    perm.readUser(callerId), perm.readTeam(),
    perm.updateTeam(), perm.deleteTeam(),
  ]);
  // Best-effort report_count increment: a failed increment must
  // never roll back the report that was just filed.
  const warnings = [];
  try {
    const current = typeof sound.report_count === "number" ? sound.report_count : 0;
    await updateRow(db, ctx.cfg, COL.sounds, soundId, { report_count: current + 1 });
  } catch (e) {
    warnings.push(`report_count: ${e && e.message ? e.message : "failed"}`);
  }
  return { report_id: report.$id, report, warnings };
}

async function actionRemoveSound(ctx, body) {
  const { db, callerId } = ctx;
  const soundId = requireString(body.sound_id || body.soundId, "sound_id");
  const reason = body.reason === undefined || body.reason === null
    ? null
    : String(body.reason).slice(0, 500) || null;
  const sound = await getRow(db, ctx.cfg, COL.sounds, soundId);
  if (!sound) throw notFound("Sound not found.");
  if (sound.status === "removed") return { sound: mapSoundRow(sound), warnings: [] };
  const updated = await updateRow(db, ctx.cfg, COL.sounds, soundId, { status: "removed" });
  // Audit trail: no admin-action write pattern exists in this file
  // (no handler writes admin_actions), so the removal is recorded
  // in the admin_actions collection (§5.14 shape) best-effort,
  // following the schema's field names. The row itself is NOT
  // deleted and its audio file is NOT deleted — status "removed"
  // keeps the audit trail and stable references. A failed audit
  // write never rolls back a removal that already happened.
  const warnings = [];
  try {
    await createRow(db, ctx.cfg, COL.adminActions, ID.unique(), {
      admin_id: callerId,
      action: "remove-sound",
      target_type: "sound",
      target_id: soundId,
      details: JSON.stringify({ reason, previous_status: sound.status || "live" }),
    });
  } catch (e) {
    warnings.push(`admin_actions: ${e && e.message ? e.message : "failed"}`);
  }
  return { sound: mapSoundRow(updated), warnings };
}

// --- Dispatcher -------------------------------------------------------

const HANDLERS = {
  "create-profile": { fn: actionCreateProfile, auth: "signed-in" },
  "create-upload": { fn: actionCreateUpload, auth: "signed-in" },
  "delete-account": { fn: actionDeleteAccount, auth: "signed-in" },
  "increment-view": { fn: actionIncrementView, auth: "guest" },
  "publish-draft": { fn: actionPublishDraft, auth: "signed-in" },
  "set-comment-pin": { fn: actionSetCommentPin, auth: "signed-in" },
  "moderate-video": { fn: actionModerateVideo, auth: "staff" },
  "moderate-story": { fn: actionModerateStory, auth: "staff" },
  "moderate-comment": { fn: actionModerateComment, auth: "staff" },
  "decide-verification": { fn: actionDecideVerification, auth: "staff" },
  "decide-report": { fn: actionDecideReport, auth: "staff" },
  "suspend-user": { fn: (ctx, body) => actionSuspendUser(ctx, body, { suspend: true }), auth: "admin" },
  "unsuspend-user": { fn: (ctx, body) => actionSuspendUser(ctx, body, { suspend: false }), auth: "admin" },
  // Aliases kept for callers that use the shorter names; the spec
  // names above are canonical.
  suspend: { fn: (ctx, body) => actionSuspendUser(ctx, body, { suspend: true }), auth: "admin" },
  unsuspend: { fn: (ctx, body) => actionSuspendUser(ctx, body, { suspend: false }), auth: "admin" },
  "set-role": { fn: actionSetRole, auth: "admin" },
  "delete-video": { fn: actionDeleteVideo, auth: "signed-in" },
  notify: { fn: actionNotify, auth: "signed-in" },
  "file-report": { fn: actionFileReport, auth: "signed-in" },
  "send-message": { fn: actionSendMessage, auth: "signed-in" },
  "check-allow-prefs": { fn: actionCheckAllowPrefs, auth: "signed-in" },
  "create-sound": { fn: actionCreateSound, auth: "signed-in" },
  "report-sound": { fn: actionReportSound, auth: "signed-in" },
  "remove-sound": { fn: actionRemoveSound, auth: "staff" },
  // Alias for the store method name `getAllowPrefs`; same behaviour.
  "get-allow-prefs": { fn: actionCheckAllowPrefs, auth: "signed-in" },
};

function respond(res, status, payload) {
  if (res && typeof res.json === "function") return res.json(payload, status);
  if (res && typeof res.send === "function") {
    return res.send(JSON.stringify(payload), status, { "Content-Type": "application/json" });
  }
  return payload;
}

export default async ({ req, res, log, error: logError }) => {
  const logFn = typeof log === "function" ? log : () => {};
  const errFn = typeof logError === "function" ? logError : (...a) => logFn(...a);
  try {
    if (req && req.method && String(req.method).toUpperCase() !== "POST") {
      return respond(res, 405, { ok: false, error: "Use POST with a JSON body." });
    }
    const cfg = envConfig();
    const body = parseBody(req);
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const handler = HANDLERS[action];
    if (!action || !handler) {
      throw badRequest(action ? `Unknown action: ${action}` : "action is required.");
    }
    // Guest actions skip the 401: authenticateOptional returns null
    // for anonymous callers, and the handler must not need a caller id.
    const callerId = handler.auth === "guest"
      ? await authenticateOptional(req, cfg)
      : await authenticate(req, cfg);
    const client = privilegedClient(cfg);
    const db = new TablesDB(client);
    const storage = new Storage(client);
    const teams = new Teams(client);
    const users = new Users(client);
    let isStaff = false;
    if (handler.auth === "staff") {
      await requireTeam(teams, callerId, { adminOnly: false });
      isStaff = true;
    } else if (handler.auth === "admin") {
      await requireTeam(teams, callerId, { adminOnly: true });
      isStaff = true;
    } else if (handler.auth === "signed-in" && action === "delete-video") {
      // delete-video allows owners as well as staff; resolve staff
      // status without failing so the handler can apply the
      // owner-or-staff rule itself.
      try {
        await requireTeam(teams, callerId, { adminOnly: false });
        isStaff = true;
      } catch (_e) {
        isStaff = false;
      }
    }
    const ctx = { cfg, db, storage, teams, users, callerId, isStaff, logFn, errFn };
    const data = await handler.fn(ctx, body);
    return respond(res, 200, { ok: true, data });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : appwriteStatus(e);
    const message = e && e.message ? String(e.message) : "Internal error.";
    errFn(`api failed: ${message}`);
    return respond(res, status, { ok: false, error: message });
  }
};
