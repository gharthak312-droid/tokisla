// Tokisla — `events` function (Appwrite Cloud Functions, Node.js, ESM).
//
// Database-event trigger only; no HTTP execution permission for
// clients. Reactions, per APPWRITE_SETUP.md §8.2:
//
//   video_likes create/delete -> recount videos.like_count
//   comments    create/delete -> recount videos.comment_count
//   profiles    create/update -> sync the public_profiles copy
//   profiles    delete        -> delete the public_profiles copy
//
// Every handler is idempotent (recounts and upserts only), because
// event delivery is at-least-once. This function never writes to
// `profiles`, never flips file permissions, and never writes audit
// rows — the `api` actions do those synchronously.
//
// Event strings: use the Console Events picker; do NOT hand-type
// event strings. The TablesDB rename changed the event format, and
// the picker shows the format for this project's Appwrite version.
// This code therefore accepts BOTH the old
// `databases.<db>.collections.<coll>.documents.<id>.<op>` form and
// the new `databases.<db>.tables.<table>.rows.<id>.<op>` form, from
// the `x-appwrite-event` header, falling back to the resource's
// `$collectionId` / `$tableId` fields in the body. The logical
// triggers are listed in functions/README.md.
//
// Environment variables only (no secret, endpoint, or project id is
// hardcoded anywhere in this file):
//   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
//   (runtime-injected APPWRITE_FUNCTION_* fallbacks accepted),
//   APPWRITE_DATABASE_ID (defaults to the schema constant `tokisla`).
//
// Unverified at authoring time (no live Appwrite project or
// credentials were available; nothing here was executed against
// Appwrite): the exact post-rename event-string format and header
// name, whether `listRows` with `total: true` + `Query.limit(1)`
// returns the full matched count, and that omitting `permissions`
// on updateRow leaves existing permissions untouched. See
// functions/README.md.

import { Client, Query, TablesDB } from "node-appwrite";

const DB_FALLBACK = "tokisla";
const COL = {
  profiles: "profiles",
  publicProfiles: "public_profiles",
  videos: "videos",
  videoLikes: "video_likes",
  comments: "comments",
};

function envConfig() {
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "";
  const projectId = process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID || "";
  const apiKey = process.env.APPWRITE_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY || "";
  const databaseId = process.env.APPWRITE_DATABASE_ID || process.env.APPWRITE_FUNCTION_DATABASE_ID || DB_FALLBACK;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("Function is not configured (missing endpoint, project, or API key variables).");
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

function parseBody(req) {
  const raw = req ? req.body : undefined;
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "object" && !(raw instanceof Uint8Array)) return raw;
  const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function appwriteStatus(e) {
  const code = e && (e.code || e.status);
  return typeof code === "number" && code >= 400 && code <= 599 ? code : 500;
}
function isNotFound(e) {
  return appwriteStatus(e) === 404;
}

async function getRow(db, cfg, tableId, rowId) {
  try {
    return await db.getRow({ databaseId: cfg.databaseId, tableId, rowId });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

// Count every row matching `queries`. Prefer the server-computed
// total; fall back to a paged scan if `total` is not returned, so a
// counting-semantics surprise degrades to slower-but-correct.
async function countRows(db, cfg, tableId, queries) {
  const first = await db.listRows({
    databaseId: cfg.databaseId,
    tableId,
    queries: [...queries, Query.limit(1)],
    total: true,
  });
  if (typeof first.total === "number") return first.total;
  let count = 0;
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await db.listRows({
      databaseId: cfg.databaseId,
      tableId,
      queries: [...queries, Query.limit(100), Query.offset(offset)],
    });
    const batch = res.rows || res.documents || [];
    count += batch.length;
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return count;
}

// The six safe public-profile fields. `verified` is deliberately
// absent: only `api` decide-verification writes it, so a tampered
// `profiles.verified` can never reach the public copy via sync.
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

async function upsertPublicProfile(db, cfg, profile) {
  const fields = safePublicFields(profile);
  const existing = await getRow(db, cfg, COL.publicProfiles, profile.$id);
  if (existing) {
    // Partial update of the safe fields only: `verified` (and any
    // other field) already on the public row is preserved.
    await db.updateRow({
      databaseId: cfg.databaseId,
      tableId: COL.publicProfiles,
      rowId: profile.$id,
      data: fields,
    });
    return "updated";
  }
  await db.createRow({
    databaseId: cfg.databaseId,
    tableId: COL.publicProfiles,
    rowId: profile.$id,
    data: { ...fields, verified: false },
  });
  return "created";
}

async function deletePublicProfile(db, cfg, userId) {
  try {
    await db.deleteRow({ databaseId: cfg.databaseId, tableId: COL.publicProfiles, rowId: userId });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

async function recount(db, cfg, { tableId, attribute, videoId, column }) {
  const video = await getRow(db, cfg, COL.videos, videoId);
  if (!video) return { skipped: true, reason: "video not found" };
  const count = await countRows(db, cfg, tableId, [Query.equal(attribute, videoId)]);
  const safe = Math.max(0, count);
  await db.updateRow({
    databaseId: cfg.databaseId,
    tableId: COL.videos,
    rowId: videoId,
    data: { [column]: safe },
  });
  return { videoId, [column]: safe };
}

// Parse (collection, operation) from an Appwrite event string, in
// either the pre-rename or post-rename vocabulary.
function parseEventString(event) {
  const parts = String(event || "").split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const operation = parts[parts.length - 1];
  if (!["create", "update", "delete"].includes(operation)) return null;
  const collIdx = parts.indexOf("collections");
  const tableIdx = parts.indexOf("tables");
  const idx = collIdx >= 0 ? collIdx : tableIdx;
  if (idx < 0 || idx + 1 >= parts.length) return null;
  return { collection: parts[idx + 1], operation };
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
    const cfg = envConfig();
    const body = parseBody(req);
    // Debug/manual shape (Console test runs only; this function has
    // no client execute permission): { collection, operation,
    // document }.
    let collection = null;
    let operation = null;
    let document = body;
    if (typeof body.collection === "string" && typeof body.operation === "string" && body.document && typeof body.document === "object") {
      collection = body.collection;
      operation = body.operation;
      document = body.document;
    } else {
      const headerEvent = headerValue(req, "x-appwrite-event") || headerValue(req, "x-appwrite-webhook-event");
      const parsed = parseEventString(String(headerEvent).split(",")[0]);
      if (parsed) {
        collection = parsed.collection;
        operation = parsed.operation;
      } else {
        collection = body.$collectionId || body.$tableId || body.collectionId || body.tableId || null;
        operation = null;
      }
    }
    if (!collection || !operation) {
      logFn(`events: ignoring payload without a recognisable event (collection=${collection}, operation=${operation})`);
      return respond(res, 200, { ok: true, ignored: true, reason: "no recognisable event" });
    }

    const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    const db = new TablesDB(client);

    if (collection === COL.videoLikes && (operation === "create" || operation === "delete")) {
      const videoId = document && document.video_id ? String(document.video_id) : null;
      if (!videoId) return respond(res, 200, { ok: true, ignored: true, reason: "like event without video_id" });
      const result = await recount(db, cfg, { tableId: COL.videoLikes, attribute: "video_id", videoId, column: "like_count" });
      return respond(res, 200, { ok: true, data: result });
    }
    if (collection === COL.comments && (operation === "create" || operation === "delete")) {
      const videoId = document && document.video_id ? String(document.video_id) : null;
      if (!videoId) return respond(res, 200, { ok: true, ignored: true, reason: "comment event without video_id" });
      // Count ALL comments for the video, any status — mirrors the
      // SQL trigger, which counted hidden comments too.
      const result = await recount(db, cfg, { tableId: COL.comments, attribute: "video_id", videoId, column: "comment_count" });
      return respond(res, 200, { ok: true, data: result });
    }
    if (collection === COL.profiles) {
      const profile = document;
      const userId = profile && profile.$id ? String(profile.$id) : null;
      if (!userId) return respond(res, 200, { ok: true, ignored: true, reason: "profile event without $id" });
      if (operation === "delete") {
        await deletePublicProfile(db, cfg, userId);
        return respond(res, 200, { ok: true, data: { userId, action: "public profile deleted" } });
      }
      if (operation === "create" || operation === "update") {
        if (profile.is_suspended === true) {
          await deletePublicProfile(db, cfg, userId);
          return respond(res, 200, { ok: true, data: { userId, action: "public profile deleted (suspended)" } });
        }
        // A sync failure must never delete the public document: on
        // a username-conflict (another user took the name) the old
        // public document is left in place for manual resolution.
        try {
          const action = await upsertPublicProfile(db, cfg, profile);
          return respond(res, 200, { ok: true, data: { userId, action } });
        } catch (e) {
          errFn(`events: public-profile sync failed for ${userId}: ${e && e.message ? e.message : e}`);
          return respond(res, 200, { ok: true, data: { userId, action: "sync failed; old public document left in place" } });
        }
      }
    }
    logFn(`events: ignoring ${collection}.${operation}`);
    return respond(res, 200, { ok: true, ignored: true, reason: `unhandled ${collection}.${operation}` });
  } catch (e) {
    errFn(`events failed: ${e && e.message ? e.message : e}`);
    // Event handlers should report failure (so the execution log
    // shows it) without throwing an unhandled exception.
    return respond(res, 500, { ok: false, error: e && e.message ? String(e.message) : "Internal error." });
  }
};
