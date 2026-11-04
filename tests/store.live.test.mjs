// Tokisla LIVE-store sound tests (mocked Appwrite services, no network,
// no live Appwrite execution). The live store is only reachable when the
// config carries a project ID at module load, so this file runs in its
// own process with TOKISLA_CONFIG set before requiring store.js.
// Run: node tests/store.live.test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
global.window = undefined;
globalThis.TOKISLA_CONFIG = { APPWRITE_ENDPOINT: "https://example.invalid/v1", APPWRITE_PROJECT_ID: "live-test-project", MAX_VIDEO_SECONDS: 20, MAX_VIDEO_MB: 15, APP_NAME: "Tokisla" };
const { createStore } = require("../store.js");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };
const throws = async (name, fn) => { try { await fn(); ok(name, false); } catch (e) { ok(name + " (" + String(e.message).slice(0, 50) + ")", true); } };

/* Minimal in-memory TablesDB mock. Queries are ignored (tables here are
 * tiny); JS-side filtering in the store does the real work, exactly as
 * listIn's fallback path expects. Rows keep $id/$createdAt shapes. */
function makeMock() {
  const db = { sounds: new Map(), reports: new Map(), profiles: new Map(), public_profiles: new Map() };
  const calls = { createRow: [], updateRow: [], deleteRow: [], listRows: [], createFile: [], executions: [] };
  const fail = { createRowOnce: null, updateRow: null, deleteRow: null, listRows: null, createReport: null };
  let seq = 0;
  const doc = (table, rowId, data) => Object.assign({ $id: rowId, $createdAt: "2026-11-03T00:00:00.000Z" }, data);
  const tables = {
    async listRows({ tableId }) {
      calls.listRows.push(tableId);
      if (fail.listRows) throw fail.listRows;
      const rows = [...(db[tableId] || new Map()).values()];
      return { rows, total: rows.length };
    },
    async createRow({ tableId, rowId, data }) {
      calls.createRow.push({ tableId, rowId, data: JSON.parse(JSON.stringify(data || {})) });
      if (fail.createRowOnce) { const e = fail.createRowOnce; fail.createRowOnce = null; throw e; }
      if (tableId === "reports" && fail.createReport) throw fail.createReport;
      const d = doc(tableId, rowId, data);
      (db[tableId] ||= new Map()).set(rowId, d);
      return d;
    },
    async updateRow({ tableId, rowId, data }) {
      calls.updateRow.push({ tableId, rowId, data });
      if (fail.updateRow) throw fail.updateRow;
      const cur = (db[tableId] || new Map()).get(rowId);
      if (!cur) { const e = new Error("Row not found."); e.code = 404; throw e; }
      const next = Object.assign({}, cur, data);
      db[tableId].set(rowId, next);
      return next;
    },
    async deleteRow({ tableId, rowId }) {
      calls.deleteRow.push({ tableId, rowId });
      if (fail.deleteRow) throw fail.deleteRow;
      (db[tableId] || new Map()).delete(rowId);
    },
    async getRow({ tableId, rowId }) {
      const cur = (db[tableId] || new Map()).get(rowId);
      if (!cur) { const e = new Error("Row not found."); e.code = 404; throw e; }
      return cur;
    },
  };
  const Query = {
    equal: (a, v) => JSON.stringify({ method: "equal", attribute: a, values: Array.isArray(v) ? v : [v] }),
    orderAsc: (a) => JSON.stringify({ method: "orderAsc", attribute: a }),
    orderDesc: (a) => JSON.stringify({ method: "orderDesc", attribute: a }),
    limit: (v) => JSON.stringify({ method: "limit", values: [v] }),
    search: (a, v) => JSON.stringify({ method: "search", attribute: a, values: [v] }),
  };
  const Permission = {
    read: (r) => "read(\"" + r + "\")",
    update: (r) => "update(\"" + r + "\")",
    delete: (r) => "delete(\"" + r + "\")",
  };
  const Role = { any: () => "any", user: (id) => "user:" + id, team: (id) => "team:" + id };
  const ID = { unique: () => "mock-id-" + (++seq), custom: (id) => id };
  /* Controllable auth behavior for the session-robustness tests below:
   * session toggles account.get, createError makes account.create fail,
   * sessionErrorQueue fails the next session creations in order. */
  const authState = {
    session: true,
    createError: null,
    sessionErrorQueue: [],
    createCalls: [],
    sessionCalls: [],
    deleteCalls: [],
  };
  const account = {
    async get() {
      if (!authState.session) { const e = new Error("No session."); e.code = 401; throw e; }
      return { $id: mock.meId };
    },
    async create({ userId, email, password, name }) {
      authState.createCalls.push({ userId, email, name });
      if (authState.createError) throw authState.createError;
      return { $id: userId, email, name };
    },
    async createEmailPasswordSession({ email, password }) {
      authState.sessionCalls.push(email);
      const err = authState.sessionErrorQueue.shift();
      if (err) throw err;
      authState.session = true;
      return { $id: "sess-1", userId: mock.meId };
    },
    async deleteSession({ sessionId }) {
      authState.deleteCalls.push(sessionId);
      authState.session = false;
    },
  };
  const storage = {
    async createFile({ fileId }) { calls.createFile.push(fileId); return { $id: fileId }; },
    getFileView({ fileId }) { return "view://" + fileId; },
  };
  const functions = {
    async createExecution({ body }) {
      calls.executions.push(JSON.parse(body));
      if (mock.execFail) throw new Error(mock.execFail);
      return { status: "completed", responseStatusCode: 200, responseBody: JSON.stringify({ ok: true, data: {} }) };
    },
  };
  const mock = {
    db, calls, fail, meId: "u-live-1", execFail: null, auth: authState,
    bundle: { tables, account, storage, functions, Query, Permission, Role, ID },
    seed(table, rowId, data) { (db[table] ||= new Map()).set(rowId, doc(table, rowId, data)); },
  };
  return mock;
}

const mock = makeMock();
mock.seed("profiles", "u-live-1", { username: "live_user", role: "user" });
mock.seed("public_profiles", "u-creator-9", { username: "original_creator" });
const L = createStore(null, mock.bundle);
ok("live mode selected (project ID present)", L.mode === "live");

console.log("Live listSounds: merge, removed filter, defaults, enrichment, dedupe");
mock.seed("sounds", "snd-live", { title: "Live rain", category: "sound-effects", duration_seconds: 30, storage_path: "https://example.invalid/rain.mp3", source: "CC0", creator_id: "u-live-1", creator_username: "live_user", source_type: "user", status: "live", report_count: 2, video_id: null });
mock.seed("sounds", "snd-removed", { title: "Gone", category: "naat", storage_path: "https://example.invalid/gone.mp3", source: "", creator_id: null, source_type: "admin", status: "removed", report_count: 0, video_id: null });
mock.seed("sounds", "original-vid-7", { title: "Original sound — @original_creator", category: "original", duration_seconds: 12, storage_path: "fileVid7", source: "Original sound from video", creator_id: "u-creator-9", source_type: "original", status: "live", report_count: 0, video_id: "vid-7" });
mock.seed("sounds", "snd-legacy", { title: "Legacy live row", category: "taqreer", storage_path: "https://example.invalid/legacy.mp3" });
await L.loadSoundsCatalog(async () => ({ ok: true, json: async () => [{ id: "snd-live", title: "Catalog version", category: "sound-effects", src: "https://example.invalid/cat.mp3", source: "CC0" }, { id: "cat-only", title: "Catalog only", category: "islamic", src: "fileCat9", source: "CC0" }] }));
const listed = await L.listSounds();
ok("removed rows are filtered out", !listed.some((s) => s.id === "snd-removed"));
ok("catalog + row merge dedupes by id (catalog entry wins)", listed.filter((s) => s.id === "snd-live").length === 1 && listed.find((s) => s.id === "snd-live").title === "Catalog version");
ok("catalog-only entries merge in with source_type catalog", listed.some((s) => s.id === "cat-only" && s.source_type === "catalog"));
ok("original rows merge in and keep creator fields", listed.some((s) => s.id === "original-vid-7" && s.source_type === "original" && s.category === "original" && s.video_id === "vid-7"));
ok("creator_username is enriched best-effort from public_profiles", listed.find((s) => s.id === "original-vid-7").creator_username === "original_creator");
ok("file-id src resolves to a view URL", listed.find((s) => s.id === "original-vid-7").src === "view://fileVid7" && listed.find((s) => s.id === "cat-only").src === "view://fileCat9");
const legacyLive = listed.find((s) => s.id === "snd-legacy");
ok("legacy rows default to admin/live with the owner source note", !!legacyLive && legacyLive.source_type === "admin" && legacyLive.status === "live" && legacyLive.source === "Added by the owner" && legacyLive.report_count === 0 && legacyLive.creator_id === null);
mock.fail.listRows = new Error("sounds table missing");
const degraded = await L.listSounds();
mock.fail.listRows = null;
ok("listSounds degrades to the catalog when the sounds table read fails", degraded.some((s) => s.id === "cat-only") && !degraded.some((s) => s.id === "original-vid-7"));

console.log("Live addSound: validation, no role check, full shape, legacy fallback");
const createsBefore = mock.calls.createRow.length;
await throws("live addSound rejects an unsigned caller", () => L.addSound(null, { title: "X", category: "naat", src: "https://example.invalid/x.mp3" }));
await throws("live addSound rejects an empty title", () => L.addSound("u-live-1", { title: " ", category: "naat", src: "https://example.invalid/x.mp3" }));
await throws("live addSound rejects category original", () => L.addSound("u-live-1", { title: "X", category: "original", src: "https://example.invalid/x.mp3" }));
await throws("live addSound rejects a missing file", () => L.addSound("u-live-1", { title: "X", category: "naat" }));
ok("validation failures create no rows and upload no files", mock.calls.createRow.length === createsBefore && mock.calls.createFile.length === 0);
const full = await L.addSound("u-live-1", { title: "User upload", category: "naat", src: "https://example.invalid/user.mp3", duration_seconds: 20 });
const fullCall = mock.calls.createRow[mock.calls.createRow.length - 1];
ok("full-shape create carries creator/source_type/status/report_count", fullCall.tableId === "sounds" && fullCall.data.creator_id === "u-live-1" && fullCall.data.source_type === "user" && fullCall.data.status === "live" && fullCall.data.report_count === 0 && fullCall.data.title === "User upload" && fullCall.data.storage_path === "https://example.invalid/user.mp3");
ok("returned sound keeps the stored fields + live user source note", full.creator_id === "u-live-1" && full.source_type === "user" && full.status === "live" && full.report_count === 0 && full.source === "Added by a user" && full.src === "https://example.invalid/user.mp3");
ok("src-only add uploads no file", mock.calls.createFile.length === 0);
const withFile = await L.addSound("u-live-1", { title: "File upload", category: "sound-effects", file: { name: "a.mp3" } });
ok("file add uploads to the media bucket and stores the file id", mock.calls.createFile.length === 1 && withFile.src.startsWith("view://"));
// Staff profile: same addSound, no role gate, source_type admin + owner note.
mock.seed("profiles", "u-live-1", { username: "live_user", role: "admin" });
const staffAdded = await L.addSound("u-live-1", { title: "Staff upload", category: "islamic", src: "https://example.invalid/staff.mp3" });
ok("staff addSound stores source_type admin with the owner note", staffAdded.source_type === "admin" && staffAdded.source === "Added by the owner");
mock.seed("profiles", "u-live-1", { username: "live_user", role: "user" });
// Legacy fallback: first create rejects unknown attributes, retry is legacy-only.
mock.fail.createRowOnce = new Error("unknown attribute: creator_id does not exist in table sounds");
const legacyRetry = await L.addSound("u-live-1", { title: "Legacy table", category: "taqreer", src: "https://example.invalid/legacy2.mp3" });
const retryCalls = mock.calls.createRow.slice(-2);
ok("unknown-attribute rejection retries with the 5-field legacy shape", retryCalls.length === 2 && retryCalls[0].data.creator_id === "u-live-1" && JSON.stringify(Object.keys(retryCalls[1].data).sort()) === JSON.stringify(["category", "duration_seconds", "source", "storage_path", "title"]));
ok("legacy retry still returns the in-session metadata", legacyRetry.creator_id === "u-live-1" && legacyRetry.source_type === "user" && legacyRetry.status === "live");
mock.fail.createRowOnce = new Error("boom: quota exceeded");
await throws("non-unknown-attribute failures surface (no legacy retry)", () => L.addSound("u-live-1", { title: "Quota", category: "naat", src: "https://example.invalid/q.mp3" }));
mock.fail.createRowOnce = null;

console.log("Live deleteSound: update-first, delete fallback, original error");
const updBefore = mock.calls.updateRow.length;
await L.deleteSound("u-live-1", "snd-live");
ok("deleteSound updates status to removed first, without deleting", mock.calls.updateRow.length === updBefore + 1 && mock.calls.updateRow[mock.calls.updateRow.length - 1].data.status === "removed" && mock.calls.deleteRow.length === 0);
mock.fail.updateRow = new Error("update not permitted by permissions");
const delBefore = mock.calls.deleteRow.length;
await L.deleteSound("u-live-1", "snd-legacy");
ok("failed update falls back to row delete", mock.calls.deleteRow.length === delBefore + 1);
mock.fail.deleteRow = new Error("delete also failed");
let bothFailMsg = "";
try { await L.deleteSound("u-live-1", "snd-legacy"); } catch (e) { bothFailMsg = e.message; }
ok("update + delete both failing surfaces the original update error", /update not permitted/.test(bothFailMsg));
mock.fail.updateRow = null;
mock.fail.deleteRow = null;

console.log("Live reportSound: direct row, fallback, slicing, validation");
await throws("live reportSound rejects an unsigned reporter", () => L.reportSound(null, "snd-live", "Contains music"));
await throws("live reportSound rejects an empty reason", () => L.reportSound("u-live-1", "snd-live", "  "));
const repBefore = mock.calls.createRow.filter((c) => c.tableId === "reports").length;
await L.reportSound("u-live-1", "snd-live", "y".repeat(600));
const repCall = mock.calls.createRow.filter((c) => c.tableId === "reports").pop();
ok("direct reports row carries target_type sound + reason sliced to 500", mock.calls.createRow.filter((c) => c.tableId === "reports").length === repBefore + 1 && repCall.data.target_type === "sound" && repCall.data.target_id === "snd-live" && repCall.data.reason.length === 500 && repCall.data.reporter_id === "u-live-1");
ok("successful direct report does not call the api function", mock.calls.executions.length === 0);
mock.fail.createReport = new Error("permission denied on reports");
await L.reportSound("u-live-1", "snd-live", "Contains music");
ok("failed direct report falls back to the api file-report action", mock.calls.executions.length === 1 && mock.calls.executions[0].action === "file-report" && mock.calls.executions[0].target_type === "sound" && mock.calls.executions[0].target_id === "snd-live");
mock.execFail = "api function failed";
let reportFailMsg = "";
try { await L.reportSound("u-live-1", "snd-live", "Contains music"); } catch (e) { reportFailMsg = e.message; }
ok("direct + fallback both failing surfaces the direct error", /permission denied/.test(reportFailMsg));
mock.fail.createReport = null;
mock.execFail = null;

console.log("Live usernameAvailable: format-first, honest failure");
const mock2 = makeMock();
const L2 = createStore(null, mock2.bundle);
ok("usernameAvailable true for a free name on an empty table", (await L2.usernameAvailable("free_name")) === true);
const listCallsBefore = mock2.calls.listRows.length;
ok("usernameAvailable false for an invalid format without querying", (await L2.usernameAvailable("bad name!")) === false && mock2.calls.listRows.length === listCallsBefore);
mock2.seed("public_profiles", "u-taken", { username: "taken_name" });
ok("usernameAvailable false for a taken name", (await L2.usernameAvailable("taken_name")) === false);
mock2.fail.listRows = new Error("Table public_profiles not found.");
await throws("usernameAvailable throws when the query fails (never silently available)", () => L2.usernameAvailable("free_name"));
mock2.fail.listRows = null;

console.log("Live auth: stale sessions and already-existing accounts");
const auth = mock.auth;
const resetAuth = () => { auth.session = true; auth.createError = null; auth.sessionErrorQueue = []; auth.createCalls = []; auth.sessionCalls = []; auth.deleteCalls = []; mock.execFail = null; };
const sessionActiveErr = () => { const e = new Error("Creation of a session is prohibited when a session is active."); e.code = 401; return e; };
const execBefore = mock.calls.executions.length;
resetAuth();
const created1 = await L.signUp("fresh@example.com", "password123", "fresh_user");
ok("signup with a stale session deletes it first and proceeds", !!created1 && created1.id === auth.createCalls[0].userId && auth.deleteCalls[0] === "current" && auth.sessionCalls.length === 1 && mock.calls.executions.length === execBefore + 1);
resetAuth();
const existsErr = new Error("A user with the same id, email, or phone already exists."); existsErr.code = 409; existsErr.type = "user_already_exists";
auth.createError = existsErr;
const created2 = await L.signUp("old@example.com", "password123", "old_user");
ok("signup with an already-existing account proceeds to session + profile", !!created2 && created2.id === mock.meId && created2.email === "old@example.com" && auth.sessionCalls.length === 1 && mock.calls.executions.length === execBefore + 2);
resetAuth();
auth.sessionErrorQueue = [sessionActiveErr()];
const created3 = await L.signUp("retry@example.com", "password123", "retry_user");
ok("session-active error deletes the session and retries once", !!created3 && auth.sessionCalls.length === 2 && auth.deleteCalls.length === 2);
resetAuth();
auth.sessionErrorQueue = [sessionActiveErr(), sessionActiveErr()];
await throws("session-active twice throws after exactly one retry", () => L.signUp("twice@example.com", "password123", "twice_user"));
ok("no second retry beyond the single retry", auth.sessionCalls.length === 2);
resetAuth();
auth.sessionErrorQueue = [sessionActiveErr()];
const loggedIn = await L.logIn("old@example.com", "password123");
ok("logIn retries once after a session-active error", !!loggedIn && loggedIn.username === "live_user" && auth.sessionCalls.length === 2);
resetAuth();
mock.execFail = "profile function unavailable";
await throws("create-profile failure still surfaces (no faked profile)", () => L.signUp("noprof@example.com", "password123", "noprof_user"));
mock.execFail = null;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
