// Tokisla merged-actions contract test (plain Node, no dependencies).
// Executes the REAL merged functions/api/index.js with a stubbed
// `node-appwrite` module (tests/node-appwrite-stub.mjs, redirected by
// tests/node-appwrite-hooks.mjs via module.register). No Appwrite
// project is contacted, no network is used, no secrets are involved:
// the stub is an in-memory TablesDB/Storage/Teams/Users fake and the
// env vars below are dummy placeholders (names only).
// Covers the two actions merged into `api` on 2026-11-04 (Free
// 2-function limit): `create-upload` and `delete-account` —
// validation-error shapes, auth-required behaviour, happy-path doc
// creation, and the delete-account cascade ORDER asserted from the
// mock operation log.
// Run: node tests/functions.merged-actions.test.mjs
import { register } from "node:module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

register("./node-appwrite-hooks.mjs", import.meta.url);

import {
  mockState, resetMock, resetIdSeq, seedRow, seedFile, tableRows, getRow,
} from "./node-appwrite-stub.mjs";

const handler = (await import("../functions/api/index.js")).default;

process.env.APPWRITE_ENDPOINT = "https://example.invalid/v1";
process.env.APPWRITE_PROJECT_ID = "test-project";
process.env.APPWRITE_API_KEY = "test-key-placeholder";
process.env.APPWRITE_DATABASE_ID = "tokisla";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra); }
};
const eq = (name, actual, expected) => ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

async function invoke(body, { jwt = true, method = "POST" } = {}) {
  const logs = [];
  const errors = [];
  let captured = null;
  const req = {
    method,
    headers: jwt ? { "x-appwrite-user-jwt": "jwt-test" } : {},
    body,
  };
  const res = {
    json(payload, status) { captured = { status, payload }; return payload; },
  };
  await handler({ req, res, log: (...a) => logs.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) });
  return { ...captured, logs, errors };
}
const hasOp = (prefix) => mockState.ops.some((o) => o.startsWith(prefix));
const opIndex = (prefix) => mockState.ops.findIndex((o) => o.startsWith(prefix));
const firstDeleteRow = () => opIndex("deleteRow:");
const firstDeleteFile = () => opIndex("deleteFile:");

function seedUploadScenario({ suspended = false } = {}) {
  resetMock({ callerId: "u-1" });
  resetIdSeq();
  seedRow("profiles", "u-1", { username: "caller_user", is_suspended: suspended });
  seedRow("public_profiles", "u-1", { username: "caller_user" });
  seedRow("public_profiles", "u-friend", { username: "friend" });
  seedFile("file-1", { sizeOriginal: 100, $permissions: ["user:u-1"] });
  seedFile("file-thumb", { sizeOriginal: 10, $permissions: ["user:u-1"] });
}
const uploadBody = (overrides = {}) => ({
  action: "create-upload",
  fileId: "file-1",
  duration_seconds: 10,
  size_bytes: 100,
  caption: "hello",
  visibility: "public",
  filter: "normal",
  ...overrides,
});

console.log("merged routing (static)");
const apiSrc = read("functions/api/index.js");
ok("HANDLERS routes create-upload as signed-in", /"create-upload":\s*\{\s*fn:\s*actionCreateUpload,\s*auth:\s*"signed-in"\s*\}/.test(apiSrc));
ok("HANDLERS routes delete-account as signed-in", /"delete-account":\s*\{\s*fn:\s*actionDeleteAccount,\s*auth:\s*"signed-in"\s*\}/.test(apiSrc));
const storeSrc = read("store.js");
ok("store calls create-upload via callApi (no standalone function id)", storeSrc.includes('callApi("create-upload"') && !storeSrc.includes("CREATE_UPLOAD_FUNCTION"));
ok("store calls delete-account via callApi (no standalone function id)", storeSrc.includes('callApi("delete-account"') && !storeSrc.includes("DELETE_ACCOUNT_FUNCTION"));

console.log("dispatcher: parse-before-auth + method + config gates");
resetMock(); resetIdSeq();
{
  const r = await invoke({}, { jwt: false });
  eq("empty body without JWT returns 400 action-required (parse before auth)", r.status, 400);
  eq("empty-body error is exactly 'action is required.'", r.payload.error, "action is required.");
  ok("empty-body unauthenticated call performs no DB work", mockState.ops.length === 0, mockState.ops.join(","));
}
{
  const r = await invoke("{not json", { jwt: false });
  eq("invalid JSON without JWT returns 400", r.status, 400);
  ok("invalid-JSON error names the JSON problem", /not valid JSON/.test(r.payload.error));
}
{
  const r = await invoke({ action: "no-such-action" }, { jwt: false });
  eq("unknown action without JWT returns 400", r.status, 400);
  ok("unknown-action error names the action", /Unknown action: no-such-action/.test(r.payload.error));
}
{
  const r = await invoke({ action: "create-upload" }, { jwt: false, method: "GET" });
  eq("non-POST returns 405", r.status, 405);
}
{
  const saved = { e: process.env.APPWRITE_ENDPOINT, p: process.env.APPWRITE_PROJECT_ID, k: process.env.APPWRITE_API_KEY };
  delete process.env.APPWRITE_ENDPOINT; delete process.env.APPWRITE_PROJECT_ID; delete process.env.APPWRITE_API_KEY;
  const r = await invoke({ action: "create-profile" }, { jwt: false });
  eq("missing env vars returns 500 before auth", r.status, 500);
  ok("missing-env error names configuration", /not configured/.test(r.payload.error));
  process.env.APPWRITE_ENDPOINT = saved.e; process.env.APPWRITE_PROJECT_ID = saved.p; process.env.APPWRITE_API_KEY = saved.k;
}
console.log("auth-required behaviour");
seedUploadScenario();
{
  const r = await invoke(uploadBody(), { jwt: false });
  eq("create-upload without JWT returns 401", r.status, 401);
  eq("create-upload 401 error is 'Not signed in.'", r.payload.error, "Not signed in.");
  ok("unauthenticated create-upload creates no video", tableRows("videos").length === 0);
  ok("unauthenticated create-upload leaves the file in place", mockState.files.has("file-1"));
}
{
  mockState.authFail = true;
  const r = await invoke(uploadBody());
  eq("create-upload with a rejected session returns 401", r.status, 401);
  mockState.authFail = false;
}
{
  const r = await invoke({ action: "delete-account" }, { jwt: false });
  eq("delete-account without JWT returns 401", r.status, 401);
  ok("delete-account 401 envelope has ok:false", r.payload.ok === false);
}

console.log("create-upload: validation errors (400/403) + orphan cleanup");
seedUploadScenario();
{
  const r = await invoke(uploadBody({ duration_seconds: 0 }));
  eq("duration 0 returns 400", r.status, 400);
  ok("duration error states the 20-second cap", /20 seconds/.test(r.payload.error));
  ok("duration failure deletes the orphaned file", hasOp("deleteFile:file-1") && !mockState.files.has("file-1"));
  ok("duration failure creates no video", tableRows("videos").length === 0);
  ok("failure is logged with the api prefix", r.errors.join(" ").includes("api failed:"), r.errors.join(" "));
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ duration_seconds: 21 }));
  eq("duration 21 returns 400", r.status, 400);
  ok("duration-21 failure deletes the orphaned file", !mockState.files.has("file-1"));
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ size_bytes: 26214401 }));
  eq("claimed size over 25 MiB returns 400", r.status, 400);
  ok("oversize failure deletes the orphaned file", !mockState.files.has("file-1"));
}
seedUploadScenario();
{
  mockState.files.get("file-1").sizeOriginal = 26214401;
  const r = await invoke(uploadBody({ size_bytes: 100 }));
  eq("server-side size over 25 MiB returns 400 (ground truth)", r.status, 400);
}
seedUploadScenario();
{
  const r = await invoke({ action: "create-upload", duration_seconds: 10, size_bytes: 100 });
  eq("missing fileId returns 400", r.status, 400);
  ok("missing fileId performs no file deletion", !hasOp("deleteFile:"));
  ok("missing fileId creates no video", tableRows("videos").length === 0);
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ duet_of: "vid-missing" }));
  eq("unknown duet_of returns 400", r.status, 400);
  ok("duet failure deletes the orphaned file", !mockState.files.has("file-1"));
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ reply_comment_id: "c-missing" }));
  eq("unknown reply_comment_id returns 400", r.status, 400);
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ fileId: "file-gone" }));
  eq("missing uploaded file returns 400", r.status, 400);
  ok("missing-file error names the upload-first flow", /Upload the file first/.test(r.payload.error));
}
seedUploadScenario();
{
  seedFile("file-foreign", { sizeOriginal: 100, $permissions: ["user:u-other"] });
  const r = await invoke(uploadBody({ fileId: "file-foreign" }));
  eq("another user's file returns 403", r.status, 403);
  ok("foreign file is NOT deleted (refused, not owned by caller)", mockState.files.has("file-foreign"));
  ok("foreign-file failure creates no video", tableRows("videos").length === 0);
}
seedUploadScenario({ suspended: true });
{
  const r = await invoke(uploadBody());
  eq("suspended caller returns 403", r.status, 403);
  eq("suspended error message", r.payload.error, "Account not allowed to upload.");
  ok("suspended caller creates no video", tableRows("videos").length === 0);
}
seedUploadScenario();
{
  seedRow("profiles", "u-1", { username: "caller_user", is_suspended: false });
  // No profile row at all: treated the same as suspended.
  mockState.tables.get("profiles").delete("u-1");
  const r = await invoke(uploadBody());
  eq("caller with no profile row returns 403", r.status, 403);
}

console.log("create-upload: happy path (live, mentions, original sound)");
seedUploadScenario();
{
  const longCaption = "x".repeat(350);
  const longLocation = "y".repeat(300);
  const longLink = "https://example.invalid/" + "z".repeat(400);
  const r = await invoke(uploadBody({
    caption: `@friend @caller_user ${longCaption}`,
    location: longLocation,
    link_url: longLink,
    sound_id: "snd-1",
    sound_title: "t".repeat(100),
    sound_category: "bogus-tab",
    trim_start_seconds: 2,
    trim_end_seconds: 8,
    content_disclosure: true,
    thumbnailFileId: "file-thumb",
  }));
  eq("live upload returns 200", r.status, 200);
  ok("live upload envelope is ok:true", r.payload.ok === true);
  const video = r.payload.data;
  ok("live upload returns the created video document", !!video && typeof video.$id === "string");
  eq("live video is approved", video.moderation_status, "approved");
  ok("live video has published_at set", typeof video.published_at === "string" && !!video.published_at);
  eq("caption sliced to 300", video.caption.length, 300);
  eq("location sliced to 256", video.location.length, 256);
  eq("link_url sliced to 300", video.link_url.length, 300);
  eq("sound_id stored opaquely", video.sound_id, "snd-1");
  eq("sound_title sliced to 80", video.sound_title.length, 80);
  eq("unknown sound_category stored as null", video.sound_category, null);
  eq("trim start stored", video.trim_start_seconds, 2);
  eq("trim end stored", video.trim_end_seconds, 8);
  eq("content_disclosure true on exact true", video.content_disclosure, true);
  ok("counters start at 0", video.like_count === 0 && video.comment_count === 0 && video.view_count === 0);
  eq("storage_path is the uploaded file id", video.storage_path, "file-1");
  eq("thumbnail_path is the thumbnail file id", video.thumbnail_path, "file-thumb");
  const events = tableRows("moderation_events");
  ok("moderation_events uploaded row logged", events.some((e) => e.event_type === "uploaded" && e.video_id === video.$id));
  const notes = tableRows("notifications");
  ok("mention notification created for @friend", notes.some((n) => n.user_id === "u-friend" && n.type === "mention" && n.video_id === video.$id));
  ok("no mention notification for the caller's own @mention", !notes.some((n) => n.user_id === "u-1"));
  ok("no original sound when a library sound was chosen", tableRows("sounds").length === 0);
  const fileUpdate = mockState.ops.find((o) => o === "updateFile:file-1");
  ok("video file permissions normalised", !!fileUpdate);
  const updated = mockState.files.get("file-1");
  ok("live public file carries read(any)", (updated.$permissions || []).includes('read("any")'), JSON.stringify(updated.$permissions));
  ok("no video_categories rows created", tableRows("video_categories").length === 0);
}
console.log("create-upload: happy path (original sound + draft + clamps)");
seedUploadScenario();
{
  const r = await invoke(uploadBody({ caption: "no sound here" }));
  eq("original-sound upload returns 200", r.status, 200);
  const video = r.payload.data;
  const sounds = tableRows("sounds");
  eq("one original sound row auto-registered", sounds.length, 1);
  const s = sounds[0];
  eq("original sound category", s.category, "original");
  eq("original sound video_id is the video id", s.video_id, video.$id);
  eq("original sound title uses the creator username", s.title, "Original sound — @caller_user");
  eq("original sound storage_path is the video file", s.storage_path, "file-1");
  eq("original sound source_type", s.source_type, "original");
  eq("original sound status live", s.status, "live");
  eq("original sound report_count 0", s.report_count, 0);
  eq("original sound creator", s.creator_id, "u-1");
  eq("original sound duration is the video duration", s.duration_seconds, 10);
  eq("trim defaults: start 0", video.trim_start_seconds, 0);
  eq("trim defaults: end is the duration", video.trim_end_seconds, 10);
  eq("content_disclosure defaults false", video.content_disclosure, false);
  eq("link_url defaults null", video.link_url, null);
  ok("sound fields default null (original audio)", video.sound_id === null && video.sound_title === null && video.sound_category === null);
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ is_draft: true, caption: "draft @friend" }));
  eq("draft upload returns 200", r.status, 200);
  const video = r.payload.data;
  eq("draft status", video.moderation_status, "draft");
  eq("draft has no published_at", video.published_at, null);
  ok("draft creates no mention notification", tableRows("notifications").length === 0);
  ok("draft creates no original sound", tableRows("sounds").length === 0);
  const updated = mockState.files.get("file-1");
  ok("draft file stays creator+team only (no read any)", !(updated.$permissions || []).includes('read("any")'), JSON.stringify(updated.$permissions));
}
seedUploadScenario();
{
  seedRow("videos", "vid-source", { creator_id: "u-other", caption: "source" });
  seedRow("comments", "c-reply", { video_id: "vid-source", user_id: "u-other", body: "hi" });
  const r = await invoke(uploadBody({
    poll: { question: "Q?", options: ["A", "B"] },
    duet_of: "vid-source",
    reply_comment_id: "c-reply",
    trim_start_seconds: -5,
    trim_end_seconds: 99,
    content_disclosure: "yes",
  }));
  eq("poll/duet/reply upload returns 200", r.status, 200);
  const video = r.payload.data;
  eq("poll question stored", video.poll_question, "Q?");
  ok("poll options stored", video.poll_option_a === "A" && video.poll_option_b === "B");
  eq("duet_of stored", video.duet_of, "vid-source");
  eq("reply_video_id derived from the comment", video.reply_video_id, "vid-source");
  eq("trim start clamped to 0", video.trim_start_seconds, 0);
  eq("trim end clamped to duration", video.trim_end_seconds, 10);
  eq("content_disclosure false unless exactly true", video.content_disclosure, false);
}
seedUploadScenario();
{
  const r = await invoke(uploadBody({ poll: { question: "only?" } }));
  eq("incomplete poll is dropped, not an error", r.status, 200);
  eq("incomplete poll stores nulls", r.payload.data.poll_question, null);
}

console.log("delete-account: cascade order + exact {ok:true}");
resetMock({ callerId: "u-del" });
resetIdSeq();
seedRow("profiles", "u-del", { username: "leaver" });
seedRow("profiles", "u-other", { username: "stayer" });
seedRow("public_profiles", "u-del", { username: "leaver" });
seedRow("user_preferences", "u-del", { allow_comment: "everyone" });
seedRow("videos", "vid-1", { creator_id: "u-del", storage_path: "file-v1", thumbnail_path: "file-t1" });
seedRow("videos", "vid-2", { creator_id: "u-del", storage_path: "file-v2", thumbnail_path: null });
seedRow("videos", "vid-other", { creator_id: "u-other", storage_path: "file-keep", thumbnail_path: null });
seedRow("comments", "c-1", { video_id: "vid-1", user_id: "u-other" });
seedRow("comments", "c-2", { video_id: "vid-2", user_id: "u-del" });
seedRow("comments", "c-3", { video_id: "vid-other", user_id: "u-del" });
seedRow("comment_likes", "cl-1", { comment_id: "c-1", user_id: "u-del" });
seedRow("comment_likes", "cl-2", { comment_id: "c-3", user_id: "u-other" });
seedRow("video_categories", "vc-1", { video_id: "vid-1", category_id: "funny" });
seedRow("video_likes", "vl-1", { video_id: "vid-1", user_id: "u-other" });
seedRow("video_likes", "vl-2", { video_id: "vid-other", user_id: "u-del" });
seedRow("saved_videos", "sv-1", { video_id: "vid-1", user_id: "u-other" });
seedRow("saved_videos", "sv-2", { video_id: "vid-other", user_id: "u-del" });
seedRow("poll_votes", "pv-1", { video_id: "vid-1", user_id: "u-other" });
seedRow("watch_history", "wh-1", { video_id: "vid-1", user_id: "u-other" });
seedRow("watch_history", "wh-2", { video_id: "vid-other", user_id: "u-del" });
seedRow("stories", "st-1", { user_id: "u-del", storage_path: "file-s1" });
seedRow("stories", "st-other", { user_id: "u-other", storage_path: "file-keep-story" });
seedRow("story_views", "svw-1", { story_id: "st-1", user_id: "u-other" });
seedRow("story_views", "svw-2", { story_id: "st-other", user_id: "u-del" });
seedRow("follows", "f-1", { follower_id: "u-del", following_id: "u-other" });
seedRow("follows", "f-2", { follower_id: "u-other", following_id: "u-del" });
seedRow("blocked_users", "b-1", { blocker_id: "u-del", blocked_id: "u-other" });
seedRow("blocked_users", "b-2", { blocker_id: "u-other", blocked_id: "u-del" });
seedRow("messages", "m-1", { sender_id: "u-del", recipient_id: "u-other" });
seedRow("messages", "m-2", { sender_id: "u-other", recipient_id: "u-del" });
seedRow("notifications", "n-1", { user_id: "u-del", actor_id: "u-other", type: "like" });
seedRow("notifications", "n-2", { user_id: "u-other", actor_id: "u-del", type: "like" });
seedRow("reports", "r-1", { reporter_id: "u-del" });
seedRow("reports", "r-2", { reporter_id: "u-other" });
seedRow("verification_requests", "vr-1", { user_id: "u-del" });
seedRow("account_events", "ae-1", { user_id: "u-del" });
seedRow("moderation_reviews", "mr-1", { reviewer_id: "u-del" });
seedRow("moderation_reviews", "mr-2", { reviewer_id: "u-other" });
seedRow("admin_actions", "aa-1", { admin_id: "u-del" });
seedRow("moderation_events", "me-1", { video_id: "vid-1" });
seedRow("moderation_events", "me-2", { video_id: "vid-other" });
mockState.memberships = [
  { $id: "mem-1", userId: "u-del", roles: ["admin"] },
  { $id: "mem-2", userId: "u-other", roles: ["user"] },
];
seedFile("file-v1", { $permissions: ["user:u-del"] });
seedFile("file-t1", { $permissions: ["user:u-del"] });
seedFile("file-v2", { $permissions: ["user:u-del"] });
seedFile("file-s1", { $permissions: ["user:u-del"] });
seedFile("file-keep", { $permissions: ["user:u-other"] });
seedFile("file-keep-story", { $permissions: ["user:u-other"] });
{
  const r = await invoke({ action: "delete-account" });
  eq("delete-account returns 200", r.status, 200);
  eq("delete-account wire body is exactly {ok:true}", JSON.stringify(r.payload), '{"ok":true}');
  ok("files are deleted before any document", firstDeleteFile() >= 0 && firstDeleteFile() < firstDeleteRow(), mockState.ops.join(","));
  ok("all four owned files deleted", ["file-v1", "file-t1", "file-v2", "file-s1"].every((f) => !mockState.files.has(f)));
  ok("other users' files untouched", mockState.files.has("file-keep") && mockState.files.has("file-keep-story"));
  const usersIdx = opIndex("users.delete:u-del");
  ok("Auth user delete is the LAST operation", usersIdx === mockState.ops.length - 1, mockState.ops.join(","));
  ok("team removal happens before Auth delete", opIndex("deleteMembership:mem-1") >= 0 && opIndex("deleteMembership:mem-1") < usersIdx);
  ok("other member is not removed", mockState.memberships.some((m) => m.$id === "mem-2") && !mockState.memberships.some((m) => m.$id === "mem-1"));
  ok("comment likes deleted before their comment", opIndex("deleteRow:comment_likes:cl-1") < opIndex("deleteRow:comments:c-1"));
  ok("per-video children deleted before the video row", opIndex("deleteRow:video_categories:vc-1") < opIndex("deleteRow:videos:vid-1") && opIndex("deleteRow:video_likes:vl-1") < opIndex("deleteRow:videos:vid-1"));
  ok("story views deleted before the story row", opIndex("deleteRow:story_views:svw-1") < opIndex("deleteRow:stories:st-1"));
  ok("own videos deleted", tableRows("videos").every((v) => v.$id === "vid-other") && tableRows("videos").length === 1);
  ok("all own comments deleted (own videos + others')", tableRows("comments").length === 0);
  for (const [table, want] of [["follows", 0], ["video_likes", 0], ["saved_videos", 0], ["blocked_users", 0], ["comment_likes", 0], ["poll_votes", 0], ["watch_history", 0], ["story_views", 0], ["messages", 0], ["reports", 1], ["verification_requests", 0], ["account_events", 0], ["stories", 1]]) {
    ok(`${table} cascade leaves ${want} row(s)`, tableRows(table).length === want, `${table}: ${tableRows(table).length}`);
  }
  ok("notifications addressed to the user deleted, actor-only kept", tableRows("notifications").length === 1 && tableRows("notifications")[0].$id === "n-2");
  ok("other user's report kept", tableRows("reports")[0].$id === "r-2");
  ok("own profile + public copy + preferences deleted", !getRow("profiles", "u-del") && !getRow("public_profiles", "u-del") && !getRow("user_preferences", "u-del"));
  ok("other user's profile kept", !!getRow("profiles", "u-other"));
  const mr1 = getRow("moderation_reviews", "mr-1");
  ok("moderation_reviews row kept with reviewer_id nulled", !!mr1 && mr1.reviewer_id === null);
  ok("other reviewer's row untouched", getRow("moderation_reviews", "mr-2").reviewer_id === "u-other");
  const aa1 = getRow("admin_actions", "aa-1");
  ok("admin_actions row kept with admin_id nulled", !!aa1 && aa1.admin_id === null);
  const me1 = getRow("moderation_events", "me-1");
  ok("moderation_events row kept with video_id nulled", !!me1 && me1.video_id === null);
  ok("other video's moderation event untouched", getRow("moderation_events", "me-2").video_id === "vid-other");
  eq("Auth user deleted is the caller", mockState.authDeleted, "u-del");
}
console.log("delete-account: file failure aborts + body user_id ignored");
resetMock({ callerId: "u-del" });
resetIdSeq();
seedRow("profiles", "u-del", { username: "leaver" });
seedRow("videos", "vid-1", { creator_id: "u-del", storage_path: "file-bad", thumbnail_path: null });
seedFile("file-bad", { $permissions: ["user:u-del"] });
mockState.failDeleteFileIds.add("file-bad");
{
  const r = await invoke({ action: "delete-account" });
  eq("file-delete failure returns 500", r.status, 500);
  ok("file failure error names file deletion", /deleting files/.test(r.payload.error));
  ok("file failure deletes no documents", !hasOp("deleteRow:"));
  ok("file failure does not delete the Auth user", mockState.authDeleted === null);
  ok("video row survives a file failure", !!getRow("videos", "vid-1"));
}
resetMock({ callerId: "u-del" });
resetIdSeq();
seedRow("profiles", "u-del", { username: "leaver" });
seedRow("profiles", "u-victim", { username: "victim" });
{
  const r = await invoke({ action: "delete-account", user_id: "u-victim" });
  eq("body user_id ignored: returns 200", r.status, 200);
  ok("caller profile deleted", !getRow("profiles", "u-del"));
  ok("body-named victim profile untouched", !!getRow("profiles", "u-victim"));
  eq("Auth delete targets the JWT caller, not the body id", mockState.authDeleted, "u-del");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
