// MERGED INTO api — do not deploy standalone (Free 2-function limit);
// the live implementation is the `create-upload` action in
// functions/api/index.js. This file is retained as history only.
// Tokisla — `create-upload` function (Appwrite Cloud Functions, Node.js, ESM).
//
// HTTP execution trigger. The ONLY video-creation path, per
// APPWRITE_SETUP.md §8.3 (judgment call J9, inverted flow: Appwrite
// has no signed-upload-URL equivalent).
//
// Flow:
//   1. The client uploads the file bytes FIRST, directly to the
//      `media` bucket (bucket create permission), with owner-only
//      file permissions, and keeps the resulting file $id.
//   2. The client calls this function with that file $id plus the
//      metadata the frozen app sends (caption, location, visibility,
//      duration_seconds, size_bytes, filter, poll, duet_of,
//      reply_comment_id, is_draft, filename, content_type,
//      thumbnail file $id when present, and — when the creator
//      picked a library sound — sound_id / sound_title /
//      sound_category — plus the post-screen extras
//      trim_start_seconds, trim_end_seconds, content_disclosure
//      and link_url, which are stored on the video row. There is
//      NO category_ids field in this
//      contract (2026-11-03: categories were removed from the
//      upload/post flow; the categories collection and seed remain
//      for the Discover page only). The sounds library itself
//      (catalog rows + audio files) lives in the `sounds`
//      collection + `media` bucket (APPWRITE_SETUP.md §5.24/§7.3);
//      this function only stores the creator's chosen sound on the
//      video row. There is no music handling anywhere here: no
//      music field is accepted or stored.
//   3. This function authenticates the caller, rejects suspended
//      callers, validates everything, verifies the file exists (and
//      its server-side size) via the API key, creates the video
//      document LIVE (moderation_status "approved", published_at
//      set — direct publish, no pre-publication review, 2026-11-03;
//      "draft" only when is_draft), normalises the file permissions
//      to the live template (public read for approved+public videos,
//      creator+team only otherwise), logs a moderation_events row,
//      sends @mention notifications best-effort (drafts skip
//      mentions), and returns the created video document:
//      { ok: true, data: <video> }.
//      Post-moderation (reports, admin remove/hide, suspend) happens
//      afterwards through the `api` function, never as a gate here.
//      There is NO upload_url in this contract — the file is already
//      uploaded. The client store must unwrap this envelope and hand
//      the video row (or { video, upload_url: null }) to the frozen
//      upload code, which skips its PUT step when no upload_url is
//      present.
//
//   On validation failure AFTER upload, the orphaned file is deleted
//   and 400 is returned — but only after verifying the file belongs
//   to the caller, so a caller can never delete another user's file
//   by naming its $id.
//
// Environment variables only (no secret, endpoint, or project id is
// hardcoded anywhere in this file):
//   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
//   (runtime-injected APPWRITE_FUNCTION_* fallbacks accepted),
//   APPWRITE_DATABASE_ID (defaults to the schema constant `tokisla`).
//
// Caps (same as the original Deno function): duration > 0 and
// <= 20.5s, size <= 25 MiB (26,214,400 bytes), caption <= 300 chars,
// location <= 256 chars (optional free-text place name), poll
// question <= 80, poll options <= 30 each, link_url <= 300 chars,
// trim_start_seconds / trim_end_seconds clamped to [0, duration],
// content_disclosure stored as a boolean (true only when exactly
// true is sent).
//
// Strictness vs the original Deno function, per the spec's validation
// table (§8.3): a `duet_of` that names no existing video, and a
// `reply_comment_id` that names no existing comment, are rejected
// with 400 here. The Deno function passed `duet_of` through
// unchecked and silently dropped a missing reply comment. This
// stricter behaviour is deliberate and is recorded in
// functions/README.md.
//
// Unverified at authoring time (no live Appwrite project or
// credentials were available; nothing here was executed against
// Appwrite): the object-form TablesDB / Storage shapes of the pinned
// node-appwrite major, `Client.setJWT` + `Account.get()` caller
// resolution, `getFile` returning `sizeOriginal` and `$permissions`,
// and `updateFile` accepting { bucketId, fileId, name, permissions }.
// See functions/README.md.

import {
  Account,
  Client,
  ID,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
} from "node-appwrite";

const TEAM_ID = "admins";
const MEDIA_BUCKET = "media";
const DB_FALLBACK = "tokisla";
const MAX_SECONDS = 20.5;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_LOCATION = 256;
const FILTERS = ["normal", "warm", "cool", "mono", "vivid"];
const VISIBILITIES = ["public", "followers", "private"];
const SOUND_CATEGORIES = ["sound-effects", "naat", "taqreer", "islamic"];
const MAX_SOUND_ID = 64;
const MAX_SOUND_TITLE = 80;
const MENTION_RE = /@([a-z0-9_.]+)/gi;

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
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue(req, "authorization") || "").trim());
  return match ? match[1].trim() : "";
}

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
  } catch (_e) {
    throw unauthorized();
  }
  if (!me || !me.$id) throw unauthorized();
  return String(me.$id);
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

function appwriteStatus(e) {
  const code = e && (e.code || e.status);
  return typeof code === "number" && code >= 400 && code <= 599 ? code : 500;
}
function isNotFound(e) {
  return appwriteStatus(e) === 404;
}

// A storage_path / thumbnail_path value that names a file in the media
// bucket (a file $id), as opposed to a data URL or an external URL.
function isFileId(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > 64) return false;
  return !text.startsWith("data:") && !/^https?:\/\//i.test(text) && !text.includes("/") && !text.includes(" ");
}

const perm = {
  readUser: (id) => Permission.read(Role.user(id)),
  readTeam: () => Permission.read(Role.team(TEAM_ID)),
  readAny: () => Permission.read(Role.any()),
  updateUser: (id) => Permission.update(Role.user(id)),
  updateTeam: () => Permission.update(Role.team(TEAM_ID)),
  deleteUser: (id) => Permission.delete(Role.user(id)),
  deleteTeam: () => Permission.delete(Role.team(TEAM_ID)),
};

function videoPermissions(creatorId, { publicRead }) {
  return publicRead
    ? [
        perm.readAny(),
        perm.updateUser(creatorId), perm.updateTeam(),
        perm.deleteUser(creatorId), perm.deleteTeam(),
      ]
    : [
        perm.readUser(creatorId), perm.readTeam(),
        perm.updateUser(creatorId), perm.updateTeam(),
        perm.deleteUser(creatorId), perm.deleteTeam(),
      ];
}
function filePermissions(ownerId, { publicRead }) {
  return videoPermissions(ownerId, { publicRead });
}

// Delete an orphaned upload, but only when the file demonstrably
// belongs to the caller (its permission list names them). Never
// delete a file that belongs to someone else.
async function deleteOrphanIfOwned(storage, fileId, callerId, logFn) {
  if (!isFileId(fileId)) return;
  try {
    const file = await storage.getFile({ bucketId: MEDIA_BUCKET, fileId });
    const permissions = file.$permissions || [];
    const owned = permissions.some((p) => p === `user:${callerId}`);
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

const ORIGINAL_SOUND_CATEGORY = "original";

// Best-effort original-sound registration. Called only for live
// (approved, non-draft) videos created with no sound_id. Never
// throws: every failure is caught and logged, so registration can
// never fail an upload whose video row is already live. Dedupe is
// by video_id lookup first (the sounds collection carries a key
// index on video_id, deliberately NOT unique — see schema.json);
// the lookup + create are not atomic, so a concurrent duplicate is
// possible in principle and harmless (same video_id, same title).
async function registerOriginalSound(db, cfg, { video, callerId, logFn }) {
  try {
    const found = await db.listRows({
      databaseId: cfg.databaseId,
      tableId: "sounds",
      queries: [Query.equal("video_id", video.$id), Query.limit(1)],
    });
    const rows = found.rows || found.documents || [];
    if (rows.length > 0) return;
    let username = null;
    try {
      const pub = await db.getRow({
        databaseId: cfg.databaseId,
        tableId: "public_profiles",
        rowId: callerId,
      });
      if (pub && typeof pub.username === "string" && pub.username.trim()) {
        username = pub.username.trim();
      }
    } catch (_e) {
      // Username lookup is best-effort; the fallback title below
      // is used when the profile is missing or unreadable.
    }
    await db.createRow({
      databaseId: cfg.databaseId,
      tableId: "sounds",
      rowId: ID.unique(),
      data: {
        title: username ? `Original sound — @${username}` : "Original sound",
        category: ORIGINAL_SOUND_CATEGORY,
        duration_seconds: video.duration_seconds,
        storage_path: video.storage_path,
        source: "Original sound from video",
        creator_id: callerId,
        video_id: video.$id,
        source_type: "original",
        status: "live",
        report_count: 0,
      },
      permissions: [
        perm.readAny(),
        perm.updateTeam(),
        perm.deleteTeam(),
      ],
    });
  } catch (e) {
    logFn(`create-upload: original-sound registration failed for video ${video.$id}: ${e && e.message ? e.message : e}`);
  }
}

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
  let uploadedFileId = null;
  let thumbnailFileId = null;
  let callerId = null;
  let storage = null;
  try {
    if (req && req.method && String(req.method).toUpperCase() !== "POST") {
      return respond(res, 405, { ok: false, error: "Use POST with a JSON body." });
    }
    const cfg = envConfig();
    callerId = await authenticate(req, cfg);
    const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    const db = new TablesDB(client);
    storage = new Storage(client);
    const body = parseBody(req);

    // Suspended callers may not upload (mirrors the Deno function:
    // a missing profile is treated the same as a suspended one).
    let profile = null;
    try {
      profile = await db.getRow({ databaseId: cfg.databaseId, tableId: "profiles", rowId: callerId });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
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

    // Poll: all-or-none, exactly as the Deno function handled it — an
    // incomplete/invalid poll is dropped, not an error. Flat field
    // names are accepted as a fallback to the `poll` object.
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
      let duet = null;
      try {
        duet = await db.getRow({ databaseId: cfg.databaseId, tableId: "videos", rowId: duetOf });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      if (!duet) throw badRequest("duet_of does not name an existing video.");
    }

    let replyCommentId = null;
    let replyVideoId = null;
    if (typeof body.reply_comment_id === "string" && body.reply_comment_id.trim()) {
      const commentId = body.reply_comment_id.trim();
      let comment = null;
      try {
        comment = await db.getRow({ databaseId: cfg.databaseId, tableId: "comments", rowId: commentId });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      if (!comment) throw badRequest("reply_comment_id does not name an existing comment.");
      replyCommentId = comment.$id;
      replyVideoId = comment.video_id;
    }

    // Categories: REMOVED from the upload flow (2026-11-03). The
    // `category_ids` field no longer exists in this contract and is
    // ignored when sent (never validated, never stored, no
    // video_categories rows are created). The categories collection
    // and seed remain for the Discover page only. Videos carrying no
    // categories must render everywhere; nothing here depends on
    // category data.
    //
    // Sounds: the library catalog lives in the `sounds`
    // collection + `media` bucket (APPWRITE_SETUP.md §5.24/§7.3).
    // The creator's chosen sound is stored on the video row as
    // sound_id / sound_title / sound_category, exactly as sent by
    // the client (title/category are display copies of the catalog
    // entry; sound_id is stored opaquely and is NOT FK-validated
    // against the catalog, so built-in catalog entries need no
    // server-side row). An unknown sound_category becomes null
    // rather than failing the upload. No music field of any kind
    // is accepted or stored; any other sound/music/audio field in
    // the body is ignored.
    //
    // Original-sound auto-register (2026-11-03, user-added sounds):
    // when an APPROVED (live, non-draft) video is created with NO
    // sound_id — i.e. original audio — this function best-effort
    // creates a `sounds` row for it (category "original",
    // source_type "original", video_id = the new video's $id,
    // storage_path = the video's file $id, title "Original sound
    // — @<username>" from public_profiles, falling back to
    // "Original sound"). It first queries `sounds` by video_id
    // and skips when a row already exists, so an original is
    // never registered twice. Registration NEVER fails the
    // upload: every failure is caught and logged, and the video
    // row (already live) is returned regardless. Drafts are
    // skipped — a draft has no live original sound to register.
    // Post-screen extras sent by the client
    // (trim_*, content_disclosure, link_url) ARE stored on the
    // video row (see below); they were added 2026-11-03 because the
    // Crop/Trim, content-disclosure and Add-link controls on the
    // post screen must survive live, exactly as in the demo store.
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
    // Post-screen extras (2026-11-03 fix-up): shapes match the demo
    // store exactly. trim_start_seconds / trim_end_seconds are
    // numbers in seconds; absent or non-numeric values default to
    // the full video (0 .. duration) and out-of-range values are
    // clamped into [0, duration] so playback can never start past
    // the end. content_disclosure is a boolean, true only when the
    // client sends exactly true. link_url is a string sliced to
    // 300 chars; empty/absent becomes null. None of these ever
    // fails the upload.
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
    if (filePerms.length > 0 && !filePerms.some((p) => p === `user:${callerId}`)) {
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
    // feed query already uses ("approved", see store.js feed /
    // APPWRITE_SETUP.md §6.2) and published_at set now, so it
    // appears in the feed immediately. A draft stays "draft" with
    // no published_at until publish-draft flips it live.
    const nowIso = new Date().toISOString();
    const liveStatus = isDraft ? "draft" : "approved";
    const publicRead = liveStatus === "approved" && visibility === "public";
    // thumbnail_path: a file id when the thumbnail was uploaded as a
    // file; a short data URL / external URL verbatim when it fits the
    // 2048-char attribute; otherwise null (the client poster falls
    // back). Slicing a data URL would corrupt it, so never slice.
    let thumbnailPath = null;
    if (thumbnailFileId) thumbnailPath = thumbnailFileId;
    else if (thumbnailPathRaw && thumbnailPathRaw.length <= 2048) thumbnailPath = thumbnailPathRaw;

    const video = await db.createRow({
      databaseId: cfg.databaseId,
      tableId: "videos",
      rowId: ID.unique(),
      data: {
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
      },
      permissions: videoPermissions(callerId, { publicRead }),
    });

    // No video_categories rows are created (categories removed from
    // the upload flow 2026-11-03; see above). Legacy rows for older
    // videos are cleaned up only by delete-video / delete-account.

    await db.createRow({
      databaseId: cfg.databaseId,
      tableId: "moderation_events",
      rowId: ID.unique(),
      data: {
        video_id: video.$id,
        event_type: "uploaded",
        details: JSON.stringify({ duration_seconds: duration, size_bytes: serverSize, moderation_status: liveStatus }),
      },
    });

    // @mentions, best-effort and never blocking; drafts notify on
    // publish instead (the client sends those).
    if (!isDraft) {
      try {
        const names = [...new Set([...caption.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
        for (const name of names) {
          try {
            const found = await db.listRows({
              databaseId: cfg.databaseId,
              tableId: "public_profiles",
              queries: [Query.equal("username", name), Query.limit(1)],
            });
            const rows = found.rows || found.documents || [];
            const target = rows[0];
            if (!target || String(target.$id) === String(callerId)) continue;
            await db.createRow({
              databaseId: cfg.databaseId,
              tableId: "notifications",
              rowId: ID.unique(),
              data: { user_id: target.$id, type: "mention", actor_id: callerId, video_id: video.$id, is_read: false },
              permissions: [
                perm.readUser(target.$id), perm.updateUser(target.$id), perm.deleteUser(target.$id),
              ],
            });
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
    // upload — see registerOriginalSound).
    if (!isDraft && !soundId) {
      await registerOriginalSound(db, cfg, { video, callerId, logFn });
    }

    return respond(res, 200, { ok: true, data: video });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : appwriteStatus(e);
    const message = e && e.message ? String(e.message) : "Internal error.";
    errFn(`create-upload failed: ${message}`);
    // Orphan cleanup on validation failure (400/403): delete the
    // uploaded file (and thumbnail) when they belong to the caller,
    // so a refused upload leaves no unreferenced file behind.
    if ((status === 400 || status === 403) && storage && callerId) {
      if (uploadedFileId) await deleteOrphanIfOwned(storage, uploadedFileId, callerId, logFn);
      if (thumbnailFileId) await deleteOrphanIfOwned(storage, thumbnailFileId, callerId, logFn);
    }
    return respond(res, status, { ok: false, error: message });
  }
};
