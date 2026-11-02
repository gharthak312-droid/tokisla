// Tokisla admin smoke test (jsdom): demo admin login -> queue -> approve flow.
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
run("store.js");
// The built-in sample queue items were removed at the owner's request,
// so this test submits two real items through the store API instead.
const seedStore = window.TokislaStore.createStore(window.localStorage, null);
const seederA = await seedStore.signUp("ahmed@demo.pk", "demo123", "review.ahmed");
await seedStore.submitVideo(seederA.id, { duration_seconds: 12, caption: "Review item one #dua", category_ids: [4], visibility: "public", storage_path: "assets/user/user-1.mp4" });
const seederB = await seedStore.signUp("bilal@demo.pk", "demo123", "review.bilal");
await seedStore.submitVideo(seederB.id, { duration_seconds: 9, caption: "Review item two #reminder", category_ids: [2], visibility: "public", storage_path: "blob:demo" });
await seedStore.submitStory(seederA.id, { media_type: "image", storage_path: "data:image/png;base64,iVBORw==", caption: "Story review item" });
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

console.log("Dashboard + queue");
ok("stat cards render", $$("#statCards .stat").length === 5);
const items = $$("#queueList .queue-item");
ok("queue shows the 2 submitted items", items.length === 2);
ok("queue item has video player", !!items[0].querySelector("video"));
ok("queue shows creator + duration + reports", items[0].textContent.includes("Duration") && $("#queueList").textContent.includes("@review.ahmed"));

console.log("Approve flow");
items[0].querySelector('[data-dec="approved"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(350);
ok("approved item leaves the queue", $$("#queueList .queue-item").length === 1);
$$('.tab[data-tab="log"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
ok("decision appears in the log", $("#logList").textContent.includes("approved"));

console.log("Reject flow with reason");
$$('.tab[data-tab="queue"]')[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(300);
const item2 = $$("#queueList .queue-item")[0];
item2.querySelector(".rej-reason").value = "Contains music";
item2.querySelector('[data-dec="rejected"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(350);
ok("rejected item leaves the queue", $$("#queueList .queue-item").length === 0);
ok("queue empty message shows", $("#queueList").textContent.includes("queue is empty"));

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
