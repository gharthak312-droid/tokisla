// Tokisla admin smoke test (jsdom): demo admin login -> post-moderation queue
// (direct publish: new posts go live at once; the queue holds only flagged
// / older pending videos) -> reject/approve -> reports -> sounds library
// (seeded videos auto-register original sounds) -> sound-report removal.
// Run: node tests/admin.smoke.mjs
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const raw = fs.readFileSync(root + "/admin.html", "utf8");
const inline = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
const html = raw
  .replace(/<script src="[^"]+"><\/script>/g, "")
  .replace(/<script>[\s\S]*?<\/script>/, "");

const dom = new JSDOM(html, { url: "http://localhost/admin.html", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};

const run = (file) => window.eval(fs.readFileSync(root + "/" + file, "utf8"));
run("config.js");
// Force DEMO mode for this harness: config.js now ships the real project
// ID, which would make the store live (and throw without an Appwrite
// client). Clearing the ID in memory only — config.js itself is untouched.
window.TOKISLA_CONFIG.APPWRITE_PROJECT_ID = "";
run("store.js");
// The built-in sample queue items were removed at the owner's request,
// and new posts go live immediately (direct publish), so this test submits
// real items through the store API and flags two of them for post-moderation.
const seedStore = window.TokislaStore.createStore(window.localStorage, null);
const seederA = await seedStore.signUp("ahmed@demo.pk", "demo123", "review.ahmed");
const vidA = await seedStore.submitVideo(seederA.id, { duration_seconds: 12, caption: "Live item one #dua", visibility: "public", storage_path: "blob:demo", location: "Quetta, Pakistan", sound_title: "Birds chirping", sound_category: "sound-effects" });
const seederB = await seedStore.signUp("bilal@demo.pk", "demo123", "review.bilal");
const vidB = await seedStore.submitVideo(seederB.id, { duration_seconds: 9, caption: "Flagged item two #reminder", visibility: "public", storage_path: "assets/user/user-1.mp4", location: "Quetta, Pakistan", sound_title: "Birds chirping", sound_category: "sound-effects" });
await seedStore.adminDecide("admin", vidB.id, "needs_review");
const vidC = await seedStore.submitVideo(seederB.id, { duration_seconds: 7, caption: "Flagged item three", visibility: "public", storage_path: "blob:demo" });
await seedStore.adminDecide("admin", vidC.id, "needs_review");
// Direct publish: both flagged videos were already live before flagging.
await seedStore.report(seederA.id, "video", vidA.id, "Spam or misleading");
await seedStore.submitStory(seederA.id, { media_type: "image", storage_path: "data:image/png;base64,iVBORw==", caption: "Story review item" });
// The sound report is filed BEFORE the panel script loads: the panel's
// store instance reads localStorage once at boot, so a report filed
// afterwards through the seeder store would stay invisible to it.
const seedOriginals = await seedStore.listSounds();
const seedAhmedOrig = seedOriginals.find((s) => s.creator_username === "review.ahmed" && s.source_type === "original");
if (!seedAhmedOrig) throw new Error("seed original sound missing");
await seedStore.reportSound(seederA.id, seedAhmedOrig.id, "Contains music");
window.eval(inline);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => Array.from(window.document.querySelectorAll(s));

await sleep(250);
console.log("Login gate");
ok("demo creds box shown in demo mode", !$("#demoCreds").classList.contains("hidden"));
ok("login card visible before login", !$("#loginCard").classList.contains("hidden"));

console.log("Wrong-role refusal");
$("#loginEmail").value = "nobody@example.com";
$("#loginPassword").value = "secret1";
$("#loginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await sleep(250);
ok("unknown account refused with error", !$("#loginError").classList.contains("hidden"));

console.log("Admin login");
$("#loginEmail").value = "admin@tokisla.app";
$("#loginPassword").value = "admin123";
$("#loginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await sleep(350);
ok("panel opens for admin", !$("#panel").classList.contains("hidden"));
ok("admin name shown", $("#adminName").textContent.includes("tokisla_admin"));

console.log("Dashboard + post-moderation queue");
ok("stat cards render", $$("#statCards .stat").length === 5);
ok("live post is in the feed, not waiting for review", (await seedStore.feed(seederA.id, "foryou")).some((v) => v.id === vidA.id));
const items = $$("#queueList .queue-item");
ok("queue shows only the 2 flagged items (live posts do not wait here)", items.length === 2);
ok("queue shows location + sound of the flagged video", $("#queueList").textContent.includes("Quetta, Pakistan") && $("#queueList").textContent.includes("Birds chirping"));
ok("queue item has video player", !!$$("#queueList .queue-item video").length);
ok("queue shows creator + duration + reports", $("#queueList").textContent.includes("Duration") && $("#queueList").textContent.includes("@review.bilal"));

console.log("Reject flow with reason");
items[0].querySelector(".rej-reason").value = "Spam or misleading";
items[0].querySelector('[data-dec="rejected"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(350);
ok("rejected item leaves the queue", $$("#queueList .queue-item").length === 1);

console.log("Approve flow");
$$("#queueList .queue-item")[0].querySelector('[data-dec="approved"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(350);
ok("approved item leaves the queue", $$("#queueList .queue-item").length === 0);
ok("queue empty message explains direct publish", $("#queueList").textContent.includes("go live immediately"));
$$('.tab[data-tab="log"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("decisions appear in the log", $("#logList").textContent.includes("approved") && $("#logList").textContent.includes("rejected"));

console.log("Reports tab");
$$('.tab[data-tab="reports"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("open reports listed (video + sound)", $$("#reportList .row-item").length === 2 && $("#reportList").textContent.includes("Spam or misleading") && $("#reportList").textContent.includes("Contains music"));
ok("sound report carries a Remove sound button, video report does not", !!$$("#reportList .row-item")[1].querySelector("[data-remove-sound]") && !$$("#reportList .row-item")[0].querySelector("[data-remove-sound]"));
$$("#reportList .row-item")[1].querySelector("[data-remove-sound]").dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(400);
ok("removing the reported sound leaves only the video report", $$("#reportList .row-item").length === 1 && $("#reportList").textContent.includes("Spam or misleading"));
$$('#reportList [data-act="reviewed"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("reviewed report leaves the list", $("#reportList").textContent.includes("No open reports"));

console.log("Sounds tab");
$$('.tab[data-tab="sounds"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("sounds library lists the 2 remaining originals (the reported one was removed)", $$("#soundList .row-item").length === 2 && !$("#soundList").textContent.includes("Original sound — @review.ahmed") && $("#soundList").textContent.includes("Original sound — @review.bilal"));
ok("sound rows show the Original source label, creator and live status", $("#soundList").textContent.includes("Original") && $("#soundList").textContent.includes("@review.bilal") && $("#soundList").textContent.includes("live"));
ok("sound preview audio is streaming-only (controlsList nodownload)", !!$("#soundList audio") && $("#soundList audio").getAttribute("controlsList") === "nodownload");
ok("no download affordance for sounds in the panel", !$("#soundList [download]") && !$("#soundList").textContent.includes("Download"));
ok("add-sound form present with the 4 tabs only (no original option)", !!$("#soundTitle") && !!$("#soundCategory") && !!$("#soundFile") && !!$("#addSoundBtn") && $$("#soundCategory option").map((o) => o.value).join(",") === "sound-effects,naat,taqreer,islamic");
ok("sounds filter offers Original", $$("#soundFilter option").map((o) => o.value).includes("original"));
$("#soundFilter").value = "original";
$("#soundFilter").dispatchEvent(new window.Event("change", { bubbles: true }));
await sleep(300);
ok("Original filter shows the 2 remaining originals", $$("#soundList .row-item").length === 2);
$("#soundFilter").value = "naat";
$("#soundFilter").dispatchEvent(new window.Event("change", { bubbles: true }));
await sleep(300);
ok("empty category shows the honest empty state", $$("#soundList .row-item").length === 0 && $("#soundList").textContent.includes("Abhi koi sound nahi hai"));
$("#soundFilter").value = "all";
$("#soundFilter").dispatchEvent(new window.Event("change", { bubbles: true }));
await sleep(300);
ok("All filter restores the 2 remaining originals", $$("#soundList .row-item").length === 2);

console.log("Removed sound row is kept (audit trail)");
const keptSound = JSON.parse(window.localStorage.getItem("tokisla_demo_v5")).sounds.find((s) => s.id === seedAhmedOrig.id);
ok("removed sound row is kept with status removed", !!keptSound && keptSound.status === "removed");

console.log("Categories + users tabs");
$$('.tab[data-tab="categories"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("20 categories listed", $$("#catList .row-item").length === 20);
$$('.tab[data-tab="users"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("users listed incl. admin", $$("#userList .row-item").length >= 5);

console.log("Stories tab");
$$('.tab[data-tab="stories"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(400);
ok("stories tab lists the submitted story", $$("#storyList .queue-item").length === 1 && $("#storyList").textContent.includes("Story review item"));
ok("story preview shows the photo", !!$("#storyList .queue-item img"));
$$("#storyList .queue-item [data-sdec=\"approved\"]")[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(400);
ok("approved story leaves the story queue", $$("#storyList .queue-item").length === 0 && $("#storyList").textContent.includes("No stories"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
