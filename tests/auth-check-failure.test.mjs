// Tokisla auth check-failure UI test (jsdom): when the username
// availability check FAILS (e.g. the live database/table does not exist
// yet), the hint must say the check failed — neutrally, never
// "Available" — and no green tick may appear. Run:
// node tests/auth-check-failure.test.mjs
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const html = fs.readFileSync(root + "/index.html", "utf8")
  .replace(/<script src="https:[^"]+"><\/script>/, "") // skip remote SDK CDN (unused in demo)
  .replace(/<script src="config.js"><\/script>/, "")
  .replace(/<script src="store.js"><\/script>/, "")
  .replace(/<script src="app.js"><\/script>/, "");

const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// Stubs for browser APIs jsdom lacks (same set as app.smoke.mjs)
window.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
window.Element.prototype.scrollIntoView = function () {};
window.URL.createObjectURL = () => "blob:fake";
window.URL.revokeObjectURL = () => {};
if (!window.navigator.serviceWorker) Object.defineProperty(window.navigator, "serviceWorker", { value: undefined });

const run = (file) => window.eval(fs.readFileSync(root + "/" + file, "utf8"));
run("config.js");
// Force DEMO mode in memory only — config.js itself is untouched.
window.TOKISLA_CONFIG.APPWRITE_PROJECT_ID = "";
run("store.js");
// Wrap createStore so the availability check rejects for one name,
// exactly like a missing live database/table would. Everything else
// delegates to the real demo store untouched.
const realCreate = window.TokislaStore.createStore;
window.TokislaStore.createStore = (storage, backend) => {
  const s = realCreate(storage, backend);
  const orig = s.usernameAvailable.bind(s);
  s.usernameAvailable = async (u) => {
    if (String(u) === "fail_name") throw new Error("Table public_profiles not found.");
    return orig(u);
  };
  return s;
};
run("app.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };
const $ = (s) => window.document.querySelector(s);

await sleep(300);
console.log("Check failure UI");
window.document.querySelector('#feed .slide [data-act="like"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(200);
ok("auth screen opens", !$("#authScreen").classList.contains("hidden"));
$("#tabSignup").dispatchEvent(new window.Event("click", { bubbles: true }));
const type = async (sel, val) => { $(sel).value = val; $(sel).dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(600); };
await type("#authUsername", "fail_name");
ok("failed check shows the neutral message, not Available", $("#usernameHint").textContent === "Couldn't check username right now");
ok("failed check shows no green tick", $("#usernameTick").classList.contains("hidden"));
ok("failed check hint is muted, not green/red", $("#usernameHint").style.color === "var(--muted)");
await type("#authUsername", "ok_name");
ok("a later good check recovers to Available + tick", $("#usernameHint").textContent === "Available" && !$("#usernameTick").classList.contains("hidden"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
