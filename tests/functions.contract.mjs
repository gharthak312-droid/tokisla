// Tokisla backend contract test (plain Node, no dependencies).
// Static checks on the Appwrite backend: schema.json counts/attributes,
// create-upload + api source behaviour (direct publish, no categories,
// location + sound fields), and zero Supabase usage in function code.
// These tests verify the OFFLINE contract only; nothing here calls Appwrite.
// Run: node tests/functions.contract.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra); }
};
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

console.log("schema.json");
const schema = JSON.parse(read("schema.json"));
const counts = schema.meta.counts;
ok("counts declare 25 collections", counts.collections === 25, JSON.stringify(counts));
ok("counts declare 139 attributes", counts.attributes === 139);
ok("counts declare 41 indexes", counts.indexes === 41);
ok("collection count matches", schema.collections.length === counts.collections);
ok("attribute count matches", schema.collections.reduce((n, c) => n + c.attributes.length, 0) === counts.attributes);
ok("index count matches", schema.collections.reduce((n, c) => n + c.indexes.length, 0) === counts.indexes);
ok("bucket count matches", schema.buckets.length === counts.buckets);
ok("function count matches", schema.functions.length === counts.functions);
const byId = Object.fromEntries(schema.collections.map((c) => [c.id, c]));
const videos = byId.videos;
const attr = Object.fromEntries(videos.attributes.map((a) => [a.key, a]));
ok("videos.location exists: string 256, optional", attr.location && attr.location.type === "string" && attr.location.size === 256 && attr.location.required === false);
ok("videos.sound_id exists: string 64, optional", attr.sound_id && attr.sound_id.type === "string" && attr.sound_id.size === 64 && attr.sound_id.required === false);
ok("videos.sound_title exists: string 80, optional", attr.sound_title && attr.sound_title.type === "string" && attr.sound_title.size === 80 && attr.sound_title.required === false);
ok("videos.sound_category enum has exactly the 4 library tabs", attr.sound_category && attr.sound_category.type === "enum" && JSON.stringify(attr.sound_category.elements) === JSON.stringify(["sound-effects", "naat", "taqreer", "islamic"]));
ok("videos.trim_start_seconds exists: double 0-20.5, default 0, optional", attr.trim_start_seconds && attr.trim_start_seconds.type === "double" && attr.trim_start_seconds.min === 0 && attr.trim_start_seconds.max === 20.5 && attr.trim_start_seconds.default === 0 && attr.trim_start_seconds.required === false);
ok("videos.trim_end_seconds exists: double 0-20.5, optional, no default", attr.trim_end_seconds && attr.trim_end_seconds.type === "double" && attr.trim_end_seconds.min === 0 && attr.trim_end_seconds.max === 20.5 && attr.trim_end_seconds.default === null && attr.trim_end_seconds.required === false);
ok("videos.content_disclosure exists: boolean, default false, optional", attr.content_disclosure && attr.content_disclosure.type === "boolean" && attr.content_disclosure.default === false && attr.content_disclosure.required === false);
ok("videos.link_url exists: string 300, optional", attr.link_url && attr.link_url.type === "string" && attr.link_url.size === 300 && attr.link_url.required === false);
ok("catalog file path is documented in soundsLibrary", schema.soundsLibrary.catalog.includes("sounds-catalog.json"));
ok("soundsLibrary enforcement no longer says extras are ignored", !/are ignored by create-upload/.test(schema.soundsLibrary.enforcement) && /trim_start_seconds/.test(schema.soundsLibrary.enforcement));
ok("no category_ids attribute on videos", !attr.category_ids);
ok("no music attribute on videos", !videos.attributes.some((a) => /music/i.test(a.key)));
ok("sounds collection exists", !!byId.sounds);
const sAttr = Object.fromEntries(byId.sounds.attributes.map((a) => [a.key, a]));
ok("sounds has exactly the 10 user-added/original attributes",
  JSON.stringify(Object.keys(sAttr).sort()) === JSON.stringify(["category", "creator_id", "duration_seconds", "report_count", "source", "source_type", "status", "storage_path", "title", "video_id"]));
ok("sounds.title required string 80", sAttr.title.required === true && sAttr.title.size === 80);
ok("sounds.category required, 5-value enum incl. original (auto-only)", sAttr.category.required === true && JSON.stringify(sAttr.category.elements) === JSON.stringify(["sound-effects", "naat", "taqreer", "islamic", "original"]));
ok("sounds.creator_id optional string 36", sAttr.creator_id && sAttr.creator_id.type === "string" && sAttr.creator_id.size === 36 && sAttr.creator_id.required === false);
ok("sounds.source_type enum admin/user/original, optional", sAttr.source_type && sAttr.source_type.type === "enum" && JSON.stringify(sAttr.source_type.elements) === JSON.stringify(["admin", "user", "original"]) && sAttr.source_type.required === false);
ok("sounds.video_id optional string 36", sAttr.video_id && sAttr.video_id.type === "string" && sAttr.video_id.size === 36 && sAttr.video_id.required === false);
ok("sounds.status enum live/removed, default live, optional", sAttr.status && sAttr.status.type === "enum" && JSON.stringify(sAttr.status.elements) === JSON.stringify(["live", "removed"]) && sAttr.status.default === "live" && sAttr.status.required === false);
ok("sounds.report_count integer, min 0, default 0, optional", sAttr.report_count && sAttr.report_count.type === "integer" && sAttr.report_count.min === 0 && sAttr.report_count.default === 0 && sAttr.report_count.required === false);
ok("sounds.source optional string 120", sAttr.source && sAttr.source.type === "string" && sAttr.source.size === 120 && sAttr.source.required === false);
ok("sounds.storage_path required string 512", sAttr.storage_path.required === true && sAttr.storage_path.size === 512);
ok("sounds has the category index", byId.sounds.indexes.some((i) => i.key === "category_idx" && i.attributes.includes("category")));
ok("sounds has the video_id index, key type (deliberately NOT unique)", byId.sounds.indexes.some((i) => i.key === "video_id_idx" && i.attributes.includes("video_id") && i.type === "key"));
ok("sounds has exactly 2 indexes", byId.sounds.indexes.length === 2);
ok("soundsLibrary records the collection addition", schema.soundsLibrary.collectionAdded === true && schema.soundsLibrary.collection.startsWith("sounds") && schema.soundsLibrary.collection.includes("10 attributes, 2 indexes"));
ok("soundsLibrary decision marks R7 superseded", /R7 superseded/i.test(schema.soundsLibrary.decision));
ok("judgment J14 supersedes R7 (user-added sounds direct-to-library)", (schema.judgmentCalls || []).some((j) => j.id === "J14" && /SUPERSEDES R7/.test(j.decision)));
ok("residual risk R7 is marked SUPERSEDED, not an open risk", (schema.residualRisks || []).some((r) => r.id === "R7" && String(r.risk).startsWith("SUPERSEDED")));
ok("sounds collection notes mark R7 superseded", (byId.sounds.notes || []).join(" ").includes("R7 SUPERSEDED"));
const rAttr = Object.fromEntries(byId.reports.attributes.map((a) => [a.key, a]));
ok("reports.target_type enum includes sound", rAttr.target_type && rAttr.target_type.type === "enum" && JSON.stringify(rAttr.target_type.elements) === JSON.stringify(["video", "comment", "user", "sound"]));
ok("media bucket allows audio extensions", schema.buckets.find((b) => b.id === "media").allowedExtensions.includes("mp3"));
ok("video_categories retained for Discover/legacy only", !!byId.video_categories);

console.log("create-upload contract");
const cu = read("functions/create-upload/index.js");
ok("no category_ids string in create-upload code", !/category_ids/.test(cu.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
ok("no pending status assigned in create-upload", !/pending/.test(cu));
ok("duration cap is 20.5s", /MAX_SECONDS\s*=\s*20\.5/.test(cu));
ok("size cap is 25 MiB", /MAX_BYTES\s*=\s*25\s*\*\s*1024\s*\*\s*1024/.test(cu));
ok("location cap is 256", /MAX_LOCATION\s*=\s*256/.test(cu));
ok("new non-draft row is approved with published_at", /moderation_status:\s*liveStatus/.test(cu) && /liveStatus\s*=\s*isDraft\s*\?\s*"draft"\s*:\s*"approved"/.test(cu));
ok("published_at set for live rows only", /published_at:\s*isDraft\s*\?\s*null\s*:\s*nowIso/.test(cu));
ok("location stored on the video row", /location,/.test(cu) || /location:/.test(cu));
ok("sound fields stored on the video row", /sound_id:\s*soundId/.test(cu) && /sound_title:\s*soundTitle/.test(cu) && /sound_category:\s*soundCategory/.test(cu));
ok("sound category allow-list is the 4 tabs", /SOUND_CATEGORIES\s*=\s*\[.*"sound-effects".*"naat".*"taqreer".*"islamic"/s.test(cu));
ok("create-upload SOUND_CATEGORIES excludes original", (() => { const m = /const SOUND_CATEGORIES = \[([^\]]*)\]/.exec(cu); return !!m && !/original/.test(m[1]); })());
const regFn = cu.slice(cu.indexOf("async function registerOriginalSound"), cu.indexOf("function respond", cu.indexOf("async function registerOriginalSound")));
ok("create-upload registers originals only for live, no-sound videos", /if \(!isDraft && !soundId\)/.test(cu) && /await registerOriginalSound\(db, cfg/.test(cu));
ok("original registration dedupes by a video_id lookup first", /Query\.equal\("video_id", video\.\$id\)/.test(regFn) && /if \(rows\.length > 0\) return;/.test(regFn));
ok("original title uses the creator username with a plain fallback", /title: username \? `Original sound — @\$\{username\}` : "Original sound"/.test(regFn));
ok("original row: category original, source_type original, status live, report_count 0", /category: ORIGINAL_SOUND_CATEGORY/.test(regFn) && /source_type: "original"/.test(regFn) && /status: "live"/.test(regFn) && /report_count: 0/.test(regFn));
ok("original row carries creator_id, video_id, storage_path + the video source note", /creator_id: callerId/.test(regFn) && /video_id: video\.\$id/.test(regFn) && /storage_path: video\.storage_path/.test(regFn) && /source: "Original sound from video"/.test(regFn));
ok("original username comes from a best-effort public_profiles lookup", /tableId: "public_profiles"/.test(regFn) && /rowId: callerId/.test(regFn));
ok("original registration never fails the upload (caught + logged only)", /catch \(e\) \{\s*logFn\(`create-upload: original-sound registration failed/.test(regFn));
ok("post-screen extras stored on the video row", /trim_start_seconds:\s*trimStartSeconds/.test(cu) && /trim_end_seconds:\s*trimEndSeconds/.test(cu) && /content_disclosure:\s*contentDisclosure/.test(cu) && /link_url:\s*linkUrl/.test(cu));
ok("content_disclosure stored only on exact true", /body\.content_disclosure === true/.test(cu));
ok("trim values clamped to the video duration", /trimStartSeconds/.test(cu) && /Math\.min\(Math\.max\(trimEndRaw/.test(cu));
ok("link_url sliced to 300 chars", /trimmedLink/.test(cu) && /\.slice\(0, 300\)/.test(cu));

console.log("api contract");
const api = read("functions/api/index.js");
ok("publish-draft sets approved", /moderation_status:\s*"approved"/.test(api));
ok("moderate-video retained (post-moderation)", /moderate-video/.test(api) && /moderation_status:\s*decision/.test(api));
ok("no video row is created pending by api", !/moderation_status:\s*"pending"/.test(api));
ok("story review statuses untouched (pending/approved/rejected)", /STORY_STATUSES/.test(api) || /"pending"/.test(api));

console.log("api sound handlers (create-sound / report-sound / remove-sound)");
const handlers = api.slice(api.indexOf("const HANDLERS"));
ok("HANDLERS: create-sound is signed-in", /"create-sound":\s*\{\s*fn:\s*actionCreateSound,\s*auth:\s*"signed-in"\s*\}/.test(handlers));
ok("HANDLERS: report-sound is signed-in", /"report-sound":\s*\{\s*fn:\s*actionReportSound,\s*auth:\s*"signed-in"\s*\}/.test(handlers));
ok("HANDLERS: remove-sound is staff", /"remove-sound":\s*\{\s*fn:\s*actionRemoveSound,\s*auth:\s*"staff"\s*\}/.test(handlers));
const sec = (src, start, end) => { const i = src.indexOf(start); if (i < 0) return ""; const j = end ? src.indexOf(end, i + start.length) : src.length; return src.slice(i, j < 0 ? src.length : j); };
const createSound = sec(api, "async function actionCreateSound", "async function actionReportSound");
ok("create-sound rejects original + unknown categories (4-tab allow-list only)", /const SOUND_CATEGORIES = \["sound-effects", "naat", "taqreer", "islamic"\]/.test(api) && /category must be sound-effects, naat, taqreer, or islamic/.test(createSound));
ok("create-sound requires a title (max 80) and a storage_path (max 512)", /requireString\(body\.title, "title", \{ max: 80 \}\)/.test(createSound) && /requireString\(body\.storage_path \|\| body\.storagePath, "storage_path", \{ max: 512 \}\)/.test(createSound));
ok("create-sound decides creator/source_type/status/report_count/video_id server-side", /creator_id: callerId/.test(createSound) && /source_type: isStaff \? "admin" : "user"/.test(createSound) && /video_id: null/.test(createSound) && /status: "live"/.test(createSound) && /report_count: 0/.test(createSound));
ok("create-sound never reads caller-sent ownership/status fields", !/body\.(source_type|creator_id|video_id|report_count|status)\b/.test(createSound));
ok("create-sound returns { sound }", /return \{ sound: mapSoundRow\(row\) \};/.test(createSound));
const reportSound = sec(api, "async function actionReportSound", "async function actionRemoveSound");
ok("report-sound requires a reason of 1-500 chars", /if \(!reason \|\| reason\.length > 500\)/.test(reportSound));
ok("report-sound: unknown sound is 404", /if \(!sound\) throw notFound\("Sound not found\."\)/.test(reportSound));
ok("report-sound files an open sound report (no auto-hide)", /target_type: "sound"/.test(reportSound) && /status: "open"/.test(reportSound) && !/status: "removed"/.test(reportSound));
ok("report-sound best-effort increments report_count without rolling back the report", /report_count: current \+ 1/.test(reportSound) && /warnings\.push\(`report_count:/.test(reportSound));
ok("report-sound returns { report_id, report, warnings }", /return \{ report_id: report\.\$id, report, warnings \};/.test(reportSound));
const removeSound = sec(api, "async function actionRemoveSound", "const HANDLERS");
ok("remove-sound: unknown sound is 404", /if \(!sound\) throw notFound\("Sound not found\."\)/.test(removeSound));
ok("remove-sound flips status to removed only (never deletes row/file)", /updateRow\(db, ctx\.cfg, COL\.sounds, soundId, \{ status: "removed" \}\)/.test(removeSound) && !/deleteRow|deleteFile/.test(removeSound));
ok("remove-sound on an already-removed row returns it unchanged, no duplicate audit row", /if \(sound\.status === "removed"\) return \{ sound: mapSoundRow\(sound\), warnings: \[\] \};/.test(removeSound));
ok("remove-sound writes an admin_actions audit row best-effort", /tableId: "admin_actions"|COL\.adminActions/.test(removeSound) && /action: "remove-sound"/.test(removeSound) && /warnings\.push\(`admin_actions:/.test(removeSound));

console.log("honest empty states: no bundled audio, empty catalog file");
ok("shipped sounds-catalog.json is an empty array", JSON.parse(read("sounds-catalog.json")).length === 0);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"]);
const audioFiles = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (audioExts.has(path.extname(ent.name).toLowerCase())) audioFiles.push(path.relative(root, p));
  }
})(root);
ok("zero audio files anywhere in the tree (no sound is bundled or invented)", audioFiles.length === 0, audioFiles.join(", "));

console.log("no Supabase in function code");
for (const f of ["functions/create-upload/index.js", "functions/api/index.js", "functions/events/index.js", "functions/delete-account/index.js"]) {
  const src = read(f);
  ok(`${f} has zero supabase references`, !/supabase/i.test(src));
  ok(`${f} has zero category_ids references outside comments`, !/category_ids/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
