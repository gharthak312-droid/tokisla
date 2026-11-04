// MERGED INTO api — do not deploy standalone (Free 2-function limit);
// the live implementation is the `delete-account` action in
// functions/api/index.js. This file is retained as history only.
// Tokisla — `delete-account` function (Appwrite Cloud Functions, Node.js, ESM).
//
// HTTP execution trigger. The caller deletes ONLY their own account;
// the target id always comes from the caller's JWT, never from the
// request body (the body is `{}` in the original contract and is
// ignored here).
//
// Appwrite has no foreign keys and no cascade deletes, so the cascade
// is enumerated explicitly, in this order (APPWRITE_SETUP.md §8.4):
//   1. Delete the user's files (video, thumbnail, and story files in
//      the `media` bucket, by file $id from their documents).
//   2. Delete the user's documents across every collection that
//      references them; null the SET NULL references instead of
//      deleting history rows (moderation_reviews.reviewer_id,
//      moderation_events.video_id, admin_actions.admin_id).
//   3. Remove the user from Team `admins` if a member.
//   4. Delete the Auth user via the Users API — LAST, and only after
//      the data deletion succeeds.
//   5. Return { ok: true } exactly (no `data` field, matching the
//      spec's contract for this function).
//
// Partial failure is reported as an error, never as silent success:
// the client retries, and the function is idempotent (deleting an
// already-deleted document or file counts as success). If a hard
// failure happens mid-cascade, the Auth user is NOT deleted, so a
// retry can finish the job.
//
// Environment variables only (no secret, endpoint, or project id is
// hardcoded anywhere in this file):
//   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
//   (runtime-injected APPWRITE_FUNCTION_* fallbacks accepted),
//   APPWRITE_DATABASE_ID (defaults to the schema constant `tokisla`).
//
// Unverified at authoring time (no live Appwrite project or
// credentials were available; nothing here was executed against
// Appwrite): the object-form TablesDB / Users / Teams / Storage
// shapes of the pinned node-appwrite major, `Client.setJWT` +
// `Account.get()` caller resolution, and that passing `null` for a
// nullable string attribute in updateRow clears it. See
// functions/README.md.

import {
  Account,
  Client,
  Query,
  Storage,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";

const TEAM_ID = "admins";
const MEDIA_BUCKET = "media";
const DB_FALLBACK = "tokisla";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
  if (!jwt) throw new HttpError(401, "Not signed in.");
  const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId);
  if (typeof client.setJWT !== "function") {
    throw new HttpError(500, "Caller verification is unavailable in this SDK build (setJWT missing).");
  }
  client.setJWT(jwt);
  let me;
  try {
    me = await new Account(client).get();
  } catch (_e) {
    throw new HttpError(401, "Not signed in.");
  }
  if (!me || !me.$id) throw new HttpError(401, "Not signed in.");
  return String(me.$id);
}

function appwriteStatus(e) {
  const code = e && (e.code || e.status);
  return typeof code === "number" && code >= 400 && code <= 599 ? code : 500;
}
function isNotFound(e) {
  return appwriteStatus(e) === 404;
}

function isFileId(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length > 64) return false;
  return !text.startsWith("data:") && !/^https?:\/\//i.test(text) && !text.includes("/") && !text.includes(" ");
}

// List every matching row (offset paging, 50-page runaway guard).
async function listAll(db, cfg, tableId, queries = []) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await db.listRows({
      databaseId: cfg.databaseId,
      tableId,
      queries: [...queries, Query.limit(100), Query.offset(offset)],
    });
    const batch = res.rows || res.documents || [];
    rows.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return rows;
}

async function deleteRow(db, cfg, tableId, rowId) {
  try {
    await db.deleteRow({ databaseId: cfg.databaseId, tableId, rowId });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

// Delete every row matching one equality, re-listing from offset 0
// each round: deleting while offset-paging would skip rows as the
// list shifts underneath the cursor.
async function deleteByQuery(db, cfg, tableId, attribute, value) {
  let deleted = 0;
  for (let round = 0; round < 100; round++) {
    const res = await db.listRows({
      databaseId: cfg.databaseId,
      tableId,
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

async function deleteFileBestEffort(storage, fileId, failures, label) {
  if (!isFileId(fileId)) return;
  try {
    await storage.deleteFile({ bucketId: MEDIA_BUCKET, fileId });
  } catch (e) {
    if (isNotFound(e)) return;
    failures.push(`${label} file ${fileId}: ${e && e.message ? e.message : "failed"}`);
  }
}

// Null one attribute on every matching row (SET NULL semantics).
// Passing `null` for a nullable string attribute is assumed to clear
// it; if the deployed SDK rejects null, this step must be revisited
// (see functions/README.md).
async function nullAttributeByQuery(db, cfg, tableId, attribute, value, nullField) {
  const rows = await listAll(db, cfg, tableId, [Query.equal(attribute, value)]);
  for (const row of rows) {
    await db.updateRow({
      databaseId: cfg.databaseId,
      tableId,
      rowId: row.$id,
      data: { [nullField]: null },
    });
  }
  return rows.length;
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
  try {
    if (req && req.method && String(req.method).toUpperCase() !== "POST") {
      return respond(res, 405, { ok: false, error: "Use POST with a JSON body." });
    }
    const cfg = envConfig();
    const userId = await authenticate(req, cfg);
    const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    const db = new TablesDB(client);
    const storage = new Storage(client);
    const teams = new Teams(client);
    const users = new Users(client);
    const failures = [];

    // 1. Files: collect file ids from the user's videos and stories
    // before deleting any document that names them.
    const videos = await listAll(db, cfg, "videos", [Query.equal("creator_id", userId)]);
    const videoIds = videos.map((v) => String(v.$id));
    for (const video of videos) {
      await deleteFileBestEffort(storage, video.storage_path, failures, "video");
      await deleteFileBestEffort(storage, video.thumbnail_path, failures, "thumbnail");
    }
    const stories = await listAll(db, cfg, "stories", [Query.equal("user_id", userId)]);
    const storyIds = stories.map((s) => String(s.$id));
    for (const story of stories) {
      await deleteFileBestEffort(storage, story.storage_path, failures, "story");
    }
    if (failures.length > 0) {
      throw new HttpError(500, `Account deletion failed while deleting files: ${failures.join("; ")}`);
    }

    // 2a. Per-video children, then the video documents themselves.
    for (const video of videos) {
      const videoId = String(video.$id);
      const comments = await listAll(db, cfg, "comments", [Query.equal("video_id", videoId)]);
      for (const comment of comments) {
        await deleteByQuery(db, cfg, "comment_likes", "comment_id", comment.$id);
        await deleteRow(db, cfg, "comments", comment.$id);
      }
      await deleteByQuery(db, cfg, "video_categories", "video_id", videoId);
      await deleteByQuery(db, cfg, "video_likes", "video_id", videoId);
      await deleteByQuery(db, cfg, "saved_videos", "video_id", videoId);
      await deleteByQuery(db, cfg, "poll_votes", "video_id", videoId);
      await deleteByQuery(db, cfg, "watch_history", "video_id", videoId);
      await deleteRow(db, cfg, "videos", videoId);
    }
    // 2b. Per-story children, then the story documents.
    for (const story of stories) {
      await deleteByQuery(db, cfg, "story_views", "story_id", story.$id);
      await deleteRow(db, cfg, "stories", story.$id);
    }

    // 2c. Every other collection that references the user.
    await deleteByQuery(db, cfg, "follows", "follower_id", userId);
    await deleteByQuery(db, cfg, "follows", "following_id", userId);
    await deleteByQuery(db, cfg, "video_likes", "user_id", userId);
    await deleteByQuery(db, cfg, "saved_videos", "user_id", userId);
    await deleteByQuery(db, cfg, "blocked_users", "blocker_id", userId);
    await deleteByQuery(db, cfg, "blocked_users", "blocked_id", userId);
    await deleteByQuery(db, cfg, "comment_likes", "user_id", userId);
    await deleteByQuery(db, cfg, "poll_votes", "user_id", userId);
    await deleteByQuery(db, cfg, "watch_history", "user_id", userId);
    await deleteByQuery(db, cfg, "story_views", "user_id", userId);
    await deleteByQuery(db, cfg, "messages", "sender_id", userId);
    await deleteByQuery(db, cfg, "messages", "recipient_id", userId);
    await deleteByQuery(db, cfg, "notifications", "user_id", userId);
    await deleteByQuery(db, cfg, "reports", "reporter_id", userId);
    await deleteByQuery(db, cfg, "verification_requests", "user_id", userId);
    await deleteByQuery(db, cfg, "account_events", "user_id", userId);
    // Remaining comments authored by the user on other creators'
    // videos (their own videos' comments were removed above).
    const ownComments = await listAll(db, cfg, "comments", [Query.equal("user_id", userId)]);
    for (const comment of ownComments) {
      await deleteByQuery(db, cfg, "comment_likes", "comment_id", comment.$id);
      await deleteRow(db, cfg, "comments", comment.$id);
    }

    // 2d. SET NULL history (kept, references cleared).
    await nullAttributeByQuery(db, cfg, "moderation_reviews", "reviewer_id", userId, "reviewer_id");
    await nullAttributeByQuery(db, cfg, "admin_actions", "admin_id", userId, "admin_id");
    for (const videoId of videoIds) {
      await nullAttributeByQuery(db, cfg, "moderation_events", "video_id", videoId, "video_id");
    }

    // 2e. The user's own single-id documents. The public copy is
    // deleted directly as well as via the `events` sync, so no
    // ordering assumption on the sync is needed.
    await deleteRow(db, cfg, "user_preferences", userId);
    await deleteRow(db, cfg, "public_profiles", userId);
    await deleteRow(db, cfg, "profiles", userId);

    // 3. Team membership.
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

    return respond(res, 200, { ok: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : appwriteStatus(e);
    const message = e && e.message ? String(e.message) : "Internal error.";
    errFn(`delete-account failed: ${message}`);
    return respond(res, status, { ok: false, error: message });
  }
};
