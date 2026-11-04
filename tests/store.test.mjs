// Tokisla demo-store functional tests (Node). Run: node tests/store.test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
global.window = undefined;
globalThis.TOKISLA_CONFIG = { APPWRITE_ENDPOINT: "", APPWRITE_PROJECT_ID: "", MAX_VIDEO_SECONDS: 20, MAX_VIDEO_MB: 15, APP_NAME: "Tokisla" };
const { createStore, CATEGORIES, SOUNDS_CATALOG_PATH, loadSoundsCatalog } = require("../store.js");

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };
const throws = async (name, fn) => { try { await fn(); ok(name, false); } catch (e) { ok(name + " (" + e.message.slice(0, 40) + ")", true); } };

const S = createStore(storage, null);

console.log("Categories");
ok("20 categories seeded", CATEGORIES.length === 20);

console.log("Feed (seed)");
const feedAnon = await S.feed(null, "foryou");
ok("feed returns the owner's 10 approved videos (built-in samples removed)", feedAnon.length === 10);
ok("every feed video is approved+public", feedAnon.every((v) => v.moderation_status === "approved" && v.visibility === "public"));

console.log("Auth");
await throws("short username rejected", () => S.signUp("a@b.co", "secret1", "ab"));
await throws("bad username chars rejected", () => S.signUp("a@b.co", "secret1", "bad name!"));
const me = await S.signUp("test@example.com", "secret1", "test_user");
ok("signup creates profile + session", !!me && me.username === "test_user");
await throws("duplicate username rejected", () => S.signUp("x@y.co", "secret1", "test_user"));
await throws("duplicate email rejected", () => S.signUp("test@example.com", "secret1", "other_name"));
ok("usernameAvailable false for taken", (await S.usernameAvailable("test_user")) === false);
ok("usernameAvailable true for free", (await S.usernameAvailable("free_name")) === true);
await S.logOut();
ok("logout clears session", (await S.currentUser()) === null);
await throws("wrong password rejected", () => S.logIn("test@example.com", "wrong-pass"));
const me2 = await S.logIn("test@example.com", "secret1");
ok("login works", me2 && me2.id === me.id);

console.log("Preferences");
await S.setPreferences(me.id, [2, 4]);
ok("preferences round-trip", JSON.stringify((await S.getPreferences(me.id)).category_ids) === "[2,4]");

console.log("Social");
const creator = (await S.feed(me.id, "foryou"))[0].creator_id;
ok("follow works", (await S.toggleFollow(me.id, creator)) === true);
ok("isFollowing true", await S.isFollowing(me.id, creator));
ok("following feed contains creator videos", (await S.feed(me.id, "following")).length > 0);
await throws("cannot follow self", () => S.toggleFollow(me.id, me.id));
ok("unfollow works", (await S.toggleFollow(me.id, creator)) === false);

console.log("Likes / saves");
const vid = (await S.feed(me.id, "foryou"))[0];
const before = vid.like_count;
ok("like on", (await S.toggleLike(me.id, vid.id)) === true);
ok("like count +1", (await S.feed(me.id, "foryou")).find((v) => v.id === vid.id).like_count === before + 1);
ok("likedIds has it", (await S.likedIds(me.id)).has(vid.id));
ok("likedVideos lists my liked video", (await S.likedVideos(me.id)).some((x) => x.id === vid.id));
ok("like off (no duplicate)", (await S.toggleLike(me.id, vid.id)) === false);
ok("like count back", (await S.feed(me.id, "foryou")).find((v) => v.id === vid.id).like_count === before);
ok("no built-in sample likes remain — counts start at zero", (await S.feed(null, "foryou")).every((x) => x.like_count === 0));
const vwBefore = (await S.feed(null, "foryou")).find((x) => x.id === vid.id).view_count || 0;
await S.recordView(vid.id);
ok("recordView increments the view count", ((await S.feed(null, "foryou")).find((x) => x.id === vid.id).view_count || 0) === vwBefore + 1);
await S.toggleLike(me.id, vid.id);
ok("totalLikesReceived is positive after a real like", (await S.totalLikesReceived(vid.creator_id)) > 0);
await S.toggleLike(me.id, vid.id);
ok("people lists shareable friends", (await S.people(me.id)).length >= 3);
await S.shareVideo(me.id, vid.id, creator);
ok("share sends a notification to the friend", (await S.notifications(creator)).some((n) => n.type === "share"));
ok("save on", (await S.toggleSave(me.id, vid.id)) === true);
ok("savedVideos lists it", (await S.savedVideos(me.id)).some((v) => v.id === vid.id));

console.log("Comments");
const c = await S.addComment(me.id, vid.id, "Beautiful reminder, jazakAllah.");
ok("comment added", !!c.id);
ok("comment count +1", (await S.feed(me.id, "foryou")).find((v) => v.id === vid.id).comment_count === vid.comment_count + 1);
ok("comment listed with username", (await S.comments(vid.id)).some((x) => x.id === c.id && x.username === "test_user"));
const other = await S.signUp("two@example.com", "secret1", "second_user");
await throws("cannot delete another's comment", () => S.deleteComment(other.id, c.id));
await S.deleteComment(me.id, c.id);
ok("own comment deleted", !(await S.comments(vid.id)).some((x) => x.id === c.id));

console.log("Upload + direct publish (no review gate)");
await throws("25s video rejected by store", () => S.submitVideo(me.id, { duration_seconds: 25, caption: "too long" }));
await throws("21s video rejected by store", () => S.submitVideo(me.id, { duration_seconds: 21, caption: "too long" }));
const boundary = await S.submitVideo(me.id, { duration_seconds: 20.5, caption: "boundary length", visibility: "public", storage_path: "blob:demo" });
ok("20.5s video accepted (the function/store cap)", boundary.duration_seconds === 20.5 && boundary.moderation_status === "approved");
const up = await S.submitVideo(me.id, { duration_seconds: 15, caption: "My first Tokisla video #dua", visibility: "public", storage_path: "blob:demo", location: "Quetta, Pakistan" });
ok("upload lands LIVE as approved", up.moderation_status === "approved");
ok("live upload has published_at set", !!up.published_at);
ok("new post IS in the public feed immediately", (await S.feed(me.id, "foryou")).some((v) => v.id === up.id));
ok("live video visible in My Videos as approved", (await S.myVideos(me.id)).some((v) => v.id === up.id && v.moderation_status === "approved"));
ok("no admin queue for a new post (post-moderation only)", !(await S.adminQueue()).some((v) => v.id === up.id));
ok("location round-trips on the video", up.location === "Quetta, Pakistan" && (await S.feed(me.id, "foryou")).find((v) => v.id === up.id).location === "Quetta, Pakistan");
const noLoc = await S.submitVideo(me.id, { duration_seconds: 8, caption: "no place named", visibility: "public", storage_path: "blob:demo" });
ok("missing location stays null and renders", noLoc.location === null || noLoc.location === undefined);
const longLoc = await S.submitVideo(me.id, { duration_seconds: 8, caption: "long place name", visibility: "public", storage_path: "blob:demo", location: "x".repeat(300) });
ok("over-long location is capped at exactly 256 (client and backend agree)", typeof longLoc.location === "string" && longLoc.location.length === 256);
const snd = await S.submitVideo(me.id, { duration_seconds: 9, caption: "with a library sound", visibility: "public", storage_path: "blob:demo", sound_id: "snd-1", sound_title: "Birds chirping", sound_category: "sound-effects" });
ok("chosen sound round-trips on the video", snd.sound_id === "snd-1" && snd.sound_title === "Birds chirping" && snd.sound_category === "sound-effects");
const orig = await S.submitVideo(me.id, { duration_seconds: 9, caption: "original audio", visibility: "public", storage_path: "blob:demo" });
ok("no sound chosen means original audio (null sound fields)", (orig.sound_id === null || orig.sound_id === undefined) && (orig.sound_title === null || orig.sound_title === undefined));
const extras = await S.submitVideo(me.id, { duration_seconds: 12, caption: "trim + disclosure + link", visibility: "public", storage_path: "blob:demo", trim_start_seconds: 2.5, trim_end_seconds: 8, content_disclosure: true, link_url: "https://example.invalid/page" });
ok("post-screen extras round-trip on the video", extras.trim_start_seconds === 2.5 && extras.trim_end_seconds === 8 && extras.content_disclosure === true && extras.link_url === "https://example.invalid/page");
const extrasFeed = (await S.feed(me.id, "foryou")).find((v) => v.id === extras.id);
ok("post-screen extras survive in the feed row", !!extrasFeed && extrasFeed.trim_start_seconds === 2.5 && extrasFeed.trim_end_seconds === 8 && extrasFeed.content_disclosure === true && extrasFeed.link_url === "https://example.invalid/page");
const plain = await S.submitVideo(me.id, { duration_seconds: 10, caption: "no extras", visibility: "public", storage_path: "blob:demo" });
ok("extras default to full range / false / null when untouched", plain.trim_start_seconds === 0 && plain.trim_end_seconds === 10 && plain.content_disclosure === false && plain.link_url === null);
const longLink = await S.submitVideo(me.id, { duration_seconds: 8, caption: "long link", visibility: "public", storage_path: "blob:demo", link_url: "https://example.invalid/" + "x".repeat(400) });
ok("over-long link_url is sliced to 300 in the demo store", typeof longLink.link_url === "string" && longLink.link_url.length === 300);
// Post-moderation: a live video can be removed and restored by an admin decision.
await S.adminDecide("admin", up.id, "rejected", "Not allowed on Tokisla");
ok("rejected (removed) video leaves the feed", !(await S.feed(me.id, "foryou")).some((v) => v.id === up.id));
ok("rejection reason kept", (await S.myVideos(me.id)).find((v) => v.id === up.id).rejection_reason === "Not allowed on Tokisla");
await S.adminDecide("admin", up.id, "approved");
ok("re-approved video returns to the feed", (await S.feed(me.id, "foryou")).some((v) => v.id === up.id));
const up2 = await S.submitVideo(me.id, { duration_seconds: 10, caption: "will be rejected" });
await S.adminDecide("admin", up2.id, "rejected", "Not allowed on Tokisla");
ok("rejected video stays out of feed", !(await S.feed(me.id, "foryou")).some((v) => v.id === up2.id));
ok("rejection reason kept", (await S.myVideos(me.id)).find((v) => v.id === up2.id).rejection_reason === "Not allowed on Tokisla");

console.log("Reports / blocks / search / notifications");
await S.report(other.id, "video", vid.id, "spam");
ok("report filed to admin queue", (await S.adminReports()).length === 1);
const sr = await S.search(me.id, "quran");
ok("search finds creator", sr.users.some((u) => u.username === "quran.moments"));
ok("block hides creator videos", (await S.toggleBlock(me.id, creator)) === true && !(await S.feed(me.id, "foryou")).some((v) => v.creator_id === creator));
await S.toggleBlock(me.id, creator);
const notifs = await S.notifications(vid.creator_id);
ok("creator received like/comment notifications", notifs.length >= 1);
// ---------- histories, studio, allow-prefs, private accounts ----------
const anyVid = (await S.feed(me.id, "foryou"))[0];
await S.recordView(anyVid.id, me.id);
ok("watch history records what I watched", (await S.myWatchHistory(me.id)).some((v) => v.id === anyVid.id));
await S.addComment(me.id, vid.id, "history check comment");
ok("comment history lists my comments", (await S.myComments(me.id)).some((c) => (c.body || "").includes("history check")));
await S.logEvent(me.id, "Logged in", "test session");
ok("account history lists my events", (await S.myEvents(me.id))[0].type === "Logged in");
const cstats = await S.creatorStats(me.id);
ok("studio analytics totals for my videos", cstats.videoCount >= 1 && typeof cstats.totalViews === "number" && Array.isArray(cstats.videos));
const trend = await S.trending();
ok("trending sorted by likes", trend.length >= 2 && trend[0].like_count >= trend[1].like_count);
const acct = await S.accountDetails(me.id);
ok("account details show my email", !!acct && acct.email.includes("@"));
// private account: pick a creator I do not follow who has public videos
const ppl = await S.people(me.id);
let privCreator = null;
for (const u of ppl) { const st = await S.profileStats(u.id, me.id); if (!st.is_following && (await S.profileVideos(u.id, me.id)).length) { privCreator = u.id; break; } }
ok("found a non-followed creator for the private test", !!privCreator);
await S.setPrivateAccount(privCreator, true);
ok("private creator hidden from my feed", !(await S.feed(me.id, "foryou")).some((v) => v.creator_id === privCreator));
ok("private creator grid hidden from me", (await S.profileVideos(privCreator, me.id)).length === 0);
ok("owner still sees own videos when private", (await S.profileVideos(privCreator, privCreator)).length >= 1);
await S.setPrivateAccount(privCreator, false);
await S.toggleFollow(me.id, privCreator);
ok("follow list returns people I follow", (await S.followList(me.id, "following")).some((u) => u.id === privCreator));
// allow-prefs enforcement (comments + likes + mentions)
const host = privCreator;
const hostVid = (await S.profileVideos(host, me.id)).find((v) => v.id !== vid.id) || (await S.profileVideos(host, me.id))[0];
await S.setAllowPref(host, "allow_comment", "nobody");
await throws("comment blocked when creator turned comments off", () => S.addComment(me.id, hostVid.id, "hello"));
await S.setAllowPref(host, "allow_comment", "everyone");
await S.setAllowPref(host, "allow_like", "nobody");
await throws("like blocked when creator turned likes off", () => S.toggleLike(me.id, hostVid.id));
await S.setAllowPref(host, "allow_like", "everyone");
ok("allow prefs read back", (await S.getAllowPrefs(host)).allow_comment === "everyone");
const hostName = (await S.getProfile(host)).username;
await S.setAllowPref(host, "allow_mention", "nobody");
const mentionVid = (await S.feed(me.id, "foryou")).find((v) => v.creator_id !== host) || vid;
await S.addComment(me.id, mentionVid.id, "salam @" + hostName);
ok("mention suppressed when mentions off", !(await S.notifications(host)).some((n) => n.type === "mention"));
await S.setAllowPref(host, "allow_mention", "everyone");
await S.addComment(me.id, mentionVid.id, "salam @" + hostName + " again");
ok("mention sent when mentions on", (await S.notifications(host)).some((n) => n.type === "mention"));
// ---------- profile editing: handle, bio, link ----------
const upd = await S.updateProfile(me.id, { username: "renamed_handle", website: "youtube.com/@renamed", bio: "Assalamu alaikum, I post reminders." });
ok("profile update changes handle, bio and link", upd.username === "renamed_handle" && upd.website.includes("youtube") && upd.bio.includes("Assalamu"));
await throws("taking another user's handle is rejected", () => S.updateProfile(me.id, { username: hostName }));
await throws("bad handle format is rejected", () => S.updateProfile(me.id, { username: "ab" }));
await S.updateProfile(me.id, { username: acct.username });
ok("handle restored after edit tests", (await S.getProfile(me.id)).username === acct.username);
// ---------- blue tick applications ----------
const vreq = await S.applyForVerification(me.id, { full_name: "Test User", category: "Creator", note: "", method: "JazzCash", tid: "TID123456" });
ok("blue tick application submitted as pending", vreq.status === "pending");
await throws("second application blocked while pending", () => S.applyForVerification(me.id, { full_name: "Test User", category: "Creator", method: "JazzCash", tid: "TID999999" }));
ok("admin sees the verification request", (await S.adminVerifyRequests()).some((r) => r.id === vreq.id));
await S.adminDecideVerification("admin", vreq.id, "approved");
ok("approval turns the blue tick on", (await S.getProfile(me.id)).verified === true);
ok("my application shows approved", (await S.myVerification(me.id)).status === "approved");
// ---------- direct messages ----------
const convs0 = await S.conversations(me.id);
ok("new user has the welcome conversation", convs0.some((c) => c.user.username === "chairman.wadood" && c.unread >= 1));
const pal = await S.signUp("friend@demo.pk", "demo123", "friend_user");
await S.sendMessage(me.id, pal.id, "Salam, this is a test message");
ok("recipient sees the conversation with 1 unread", (await S.conversations(pal.id)).some((c) => c.user.id === me.id && c.unread === 1));
ok("unread counter works", (await S.unreadMessages(pal.id)) >= 1);
const th = await S.thread(pal.id, me.id);
ok("thread returns the message", th.length === 1 && th[0].body.includes("test message"));
await S.markThreadRead(pal.id, me.id);
ok("marking read clears the unread count", (await S.conversations(pal.id)).find((c) => c.user.id === me.id).unread === 0);
await S.sendMessage(pal.id, me.id, "Wa alaikum assalam!");
ok("reply shows as the last message in my list", (await S.conversations(me.id)).find((c) => c.user.id === pal.id).last.body.includes("Wa alaikum"));



const stats = await S.adminStats();
ok("admin stats sane", stats.users >= 6 && stats.approved >= 10 && stats.openReports === 1 && stats.pending === 0);
const upPriv = await S.submitVideo(me.id, { duration_seconds: 9, caption: "my private note", visibility: "private", storage_path: "blob:demo" });
ok("private video listed in my Locked videos", (await S.myPrivateVideos(me.id)).some((v) => v.id === upPriv.id));
ok("private video not in another user's profile grid", !(await S.profileVideos(me.id, other.id)).some((v) => v.id === upPriv.id));
ok("owner still sees own private video in own grid", (await S.profileVideos(me.id, me.id)).some((v) => v.id === upPriv.id));
const queueNow = await S.adminQueue();
ok("admin queue empty: no new post waits for review (post-moderation only)", queueNow.length === 0);


console.log("Admin panel helpers");
const creds = await S.ensureDemoAdmin();
ok("demo admin seeded", creds.email === "admin@tokisla.app");
const adm = await S.logIn(creds.email, creds.password);
ok("demo admin login + role", adm && adm.role === "admin");
ok("adminUsers lists profiles", (await S.adminUsers()).length >= 7);
const victim = (await S.adminUsers()).find((p) => p.username === "second_user");
await S.adminSetSuspended(victim.id, true);
ok("suspended user cannot log in path flagged", (await S.adminUsers()).find((p) => p.id === victim.id).is_suspended === true);
await S.adminSetSuspended(victim.id, false);
ok("adminReviews lists decisions", (await S.adminReviews()).length >= 2);
const cats = await S.adminCategories();
ok("adminCategories returns 20", cats.length === 20);
const nc = await S.adminAddCategory("Test Category");
ok("category added", nc.id === 21 && (await S.adminCategories()).length === 21);
ok("category toggled off", (await S.adminToggleCategory(21)) === false);
ok("sounds library holds one original per live no-sound video posted above (seed videos create none)", (await S.listSounds()).length >= 1 && (await S.listSounds()).every((s) => s.source_type === "original" && s.category === "original"));
const userAdded = await S.addSound(me.id, { title: "Birds", category: "sound-effects", src: "https://example.invalid/x.mp3" });
ok("any signed-in user can add a sound direct-to-library (no admin gate)", userAdded.source_type === "user" && userAdded.status === "live" && userAdded.creator_id === me.id && userAdded.creator_username === me.username && userAdded.report_count === 0 && userAdded.video_id === null && userAdded.source === "Added by @" + me.username && (await S.listSounds()).some((s) => s.id === userAdded.id));
await throws("unsigned caller cannot add a sound", () => S.addSound(null, { title: "Birds", category: "sound-effects", src: "https://example.invalid/x.mp3" }));
await throws("empty title rejected", () => S.addSound(me.id, { title: "   ", category: "sound-effects", src: "https://example.invalid/x.mp3" }));
await throws('"original" category rejected from addSound (auto-only)', () => S.addSound(me.id, { title: "Mine", category: "original", src: "https://example.invalid/x.mp3" }));
await throws("missing audio file rejected", () => S.addSound(me.id, { title: "No file", category: "sound-effects" }));
const sndAdded = await S.addSound(adm.id, { title: "Birds chirping", category: "sound-effects", src: "https://example.invalid/birds.mp3", source: "CC0 — public domain" });
ok("admin-added sound listed with its license note + admin source_type", sndAdded.title === "Birds chirping" && sndAdded.source === "CC0 — public domain" && sndAdded.source_type === "admin" && sndAdded.status === "live" && (await S.listSounds()).some((s) => s.id === sndAdded.id));
await throws("non-admin cannot remove a sound", () => S.deleteSound(me.id, sndAdded.id));
await S.deleteSound(adm.id, sndAdded.id);
ok("removed sound is filtered from listSounds", !(await S.listSounds()).some((s) => s.id === sndAdded.id));
let secondDeleteOk = false;
try { await S.deleteSound(adm.id, sndAdded.id); secondDeleteOk = true; } catch (e) { secondDeleteOk = false; }
ok("deleteSound is idempotent (second removal does not throw)", secondDeleteOk);

console.log("Feature batch 0003: hashtags, mentions, comment likes/pin, polls, drafts, replies, duets, stories");
const owner = await S.profileByUsername("chairman.wadood");
ok("profileByUsername finds the owner", !!owner && owner.username === "chairman.wadood");
ok("profileByUsername misses strangers", (await S.profileByUsername("no_such_user")) === null);
const tagVids = await S.hashtagVideos(null, "style");
ok("hashtag page lists videos carrying that tag", tagVids.length >= 2 && tagVids.every((v) => /#style/i.test(v.caption)));
const trendTags = await S.trendingHashtags(null);
ok("trending hashtags are counted", trendTags.length >= 3 && trendTags[0].count >= 1);

const seedVid = (await S.feed(null, "foryou")).find((v) => v.id === "v-user-1");
const c1 = await S.addComment(me.id, seedVid.id, "First comment here");
const c2 = await S.addComment(other.id, seedVid.id, "Second comment here");
let cs = await S.comments(seedVid.id, me.id);
ok("comments start with zero likes", cs.every((c) => c.like_count === 0));
const lk = await S.toggleCommentLike(me.id, c2.id);
ok("comment like toggles on with a count", lk.liked === true && lk.count === 1);
cs = await S.comments(seedVid.id, other.id);
ok("comment like shows to others, not as theirs", cs.find((c) => c.id === c2.id).like_count === 1 && cs.find((c) => c.id === c2.id).liked_by_me === false);
await throws("only the video creator can pin a comment", () => S.pinComment(me.id, c1.id));
const pinned = await S.pinComment(owner.id, c2.id);
cs = await S.comments(seedVid.id, me.id);
ok("creator pin floats the comment to the top", pinned === true && cs[0].id === c2.id && cs[0].is_pinned === true);
ok("pin toggles back off", (await S.pinComment(owner.id, c2.id)) === false);

const mentionBase = (await S.notifications(other.id)).filter((n) => n.type === "mention").length;
const mv = await S.submitVideo(me.id, { caption: "Salam @second_user dekho", duration_seconds: 5, storage_path: "demo-upload", category_ids: [1] });
ok("caption mention notifies on publish", (await S.notifications(other.id)).filter((n) => n.type === "mention").length === mentionBase + 1);
const draft = await S.submitVideo(me.id, { caption: "Draft @second_user note", duration_seconds: 4, storage_path: "demo-upload", is_draft: true });
ok("draft stays out of the moderation queue", !(await S.adminQueue()).some((v) => v.id === draft.id));
ok("draft is listed under my drafts", (await S.myDrafts(me.id)).some((v) => v.id === draft.id));
ok("draft does not notify mentions yet", (await S.notifications(other.id)).filter((n) => n.type === "mention").length === mentionBase + 1);
const pubDraft = await S.publishDraft(me.id, draft.id);
ok("publish draft goes LIVE directly (approved)", pubDraft.moderation_status === "approved" && !!pubDraft.published_at);
ok("published draft IS in the public feed immediately", (await S.feed(me.id, "foryou")).some((v) => v.id === draft.id));
ok("published draft never waits in the admin queue", !(await S.adminQueue()).some((v) => v.id === draft.id));
ok("publishing the draft fires its mentions", (await S.notifications(other.id)).filter((n) => n.type === "mention").length === mentionBase + 2);
const draft2 = await S.submitVideo(me.id, { caption: "throwaway", duration_seconds: 3, storage_path: "demo-upload", is_draft: true });
await S.deleteDraft(me.id, draft2.id);
ok("draft can be deleted", (await S.myDrafts(me.id)).length === 0);

const pollVid = (await S.feed(other.id, "foryou")).find((v) => v.id === "v-user-2");
ok("seeded poll rides the feed with empty state", !!pollVid.poll && !!pollVid.poll_state && pollVid.poll_state.total === 0);
const ps1 = await S.votePoll(other.id, "v-user-2", 0);
ok("poll vote counts", ps1.total === 1 && ps1.counts[0] === 1 && ps1.my === 0);
const ps2 = await S.votePoll(other.id, "v-user-2", 1);
ok("poll vote can be changed", ps2.total === 1 && ps2.counts[1] === 1 && ps2.my === 1);
await throws("voting without a poll fails", () => S.votePoll(other.id, "v-user-1", 0));

const reply = await S.submitVideo(other.id, { caption: "Video reply!", duration_seconds: 6, storage_path: "demo-upload", reply_comment_id: c1.id });
ok("video reply knows its parent video", reply.reply_video_id === seedVid.id);
ok("video reply is live in the feed immediately", (await S.feed(me.id, "foryou")).some((v) => v.id === reply.id));
await S.adminDecide(adm.id, reply.id, "approved");
cs = await S.comments(seedVid.id, me.id);
ok("approved reply is linked on its comment", cs.find((c) => c.id === c1.id).reply_video_id === reply.id);
const duet = await S.submitVideo(other.id, { caption: "Duet time", duration_seconds: 7, storage_path: "demo-upload", duet_of: "v-user-1", filter: "warm" });
await S.adminDecide(adm.id, duet.id, "approved");
const duetInFeed = (await S.feed(other.id, "foryou")).find((v) => v.id === duet.id);
ok("duet carries its source into the feed", !!duetInFeed.duet_source && duetInFeed.duet_source.id === "v-user-1");
ok("chosen filter is stored on the video", duetInFeed.filter === "warm");

const st = await S.submitStory(other.id, { media_type: "image", storage_path: "data:image/png;base64,x", caption: "meri story" });
ok("new story waits in the admin story queue", (await S.adminStoryQueue()).some((x) => x.id === st.id));
ok("pending story stays out of the stories feed", !(await S.storiesFeed(me.id)).some((g) => g.stories.some((x) => x.id === st.id)));
await S.adminDecideStory(adm.id, st.id, "approved");
const sfeed = await S.storiesFeed(me.id);
const grp = sfeed.find((g) => g.user.id === other.id);
ok("approved story shows, ring unseen", !!grp && grp.has_unseen === true);
await S.markStorySeen(me.id, st.id);
ok("watching the story clears the unseen ring", (await S.storiesFeed(me.id)).find((g) => g.user.id === other.id).has_unseen === false);
ok("seeded owner story is live in the rail", (await S.storiesFeed(me.id)).some((g) => g.user.username === "chairman.wadood"));

console.log("Sounds catalog file loader (sounds-catalog.json)");
ok("catalog path is the fixed root path", SOUNDS_CATALOG_PATH === "sounds-catalog.json" && typeof loadSoundsCatalog === "function");
const catalogRaw = require("fs").readFileSync(new URL("../sounds-catalog.json", import.meta.url), "utf8");
ok("shipped catalog file is an empty array (no audio seeded)", JSON.parse(catalogRaw).length === 0);
const mem2 = new Map();
const storage2 = {
  getItem: (k) => (mem2.has(k) ? mem2.get(k) : null),
  setItem: (k, v) => mem2.set(k, String(v)),
  removeItem: (k) => mem2.delete(k),
};
const S2 = createStore(storage2, null);
const okFetch = (entries) => async () => ({ ok: true, json: async () => entries });
const catEntries = [
  { id: "cat-1", title: "Rain sounds", category: "sound-effects", duration_seconds: 30, src: "https://example.invalid/rain.mp3", source: "CC0" },
  { id: "cat-2", title: "Nasheed vocal", category: "islamic", duration_seconds: 45, src: "https://example.invalid/nasheed.mp3", source: "Recorded by owner" },
  { id: "bad-1", title: "", category: "sound-effects", src: "https://example.invalid/bad.mp3" },
  { id: "bad-2", title: "Wrong tab", category: "music", duration_seconds: 10, src: "https://example.invalid/bad2.mp3" },
  { id: "bad-3", title: "Fake original", category: "original", duration_seconds: 10, src: "https://example.invalid/bad3.mp3" },
  { id: "cat-1", title: "Duplicate", category: "sound-effects", src: "https://example.invalid/dup.mp3" },
];
const loaded = await S2.loadSoundsCatalog(okFetch(catEntries));
ok("catalog loader keeps valid entries, drops malformed/wrong-category/\"original\"-category, dedupes by id", loaded.length === 2 && loaded[0].id === "cat-1" && loaded[0].title === "Rain sounds" && loaded[1].id === "cat-2");
ok("catalog entries merge into listSounds", (await S2.listSounds()).length === 2);
const creds2 = await S2.ensureDemoAdmin();
const adm2 = await S2.logIn(creds2.email, creds2.password);
const added2 = await S2.addSound(adm2.id, { title: "Birds", category: "sound-effects", src: "https://example.invalid/birds.mp3", source: "CC0" });
const merged = await S2.listSounds();
ok("admin-added sounds merge with catalog-file entries", merged.length === 3 && merged.some((s) => s.id === "cat-1") && merged.some((s) => s.id === added2.id));
await S2.deleteSound(adm2.id, added2.id);
const malformed = await S2.loadSoundsCatalog(okFetch({ not: "an array" }));
ok("malformed catalog content falls back to empty, silently", Array.isArray(malformed) && malformed.length === 0);
const failing = await S2.loadSoundsCatalog(async () => { throw new Error("network down"); });
ok("failed catalog fetch falls back to empty, silently", Array.isArray(failing) && failing.length === 0);
const notOk = await S2.loadSoundsCatalog(async () => ({ ok: false, json: async () => [] }));
ok("absent catalog file (non-OK) falls back to empty", Array.isArray(notOk) && notOk.length === 0);
ok("empty states still render after fallback (listSounds empty)", (await S2.listSounds()).length === 0);

console.log("User-added sounds + original sounds (fresh stores; seed/load create no originals)");
const mem3 = new Map();
const storage3 = {
  getItem: (k) => (mem3.has(k) ? mem3.get(k) : null),
  setItem: (k, v) => mem3.set(k, String(v)),
  removeItem: (k) => mem3.delete(k),
};
const S3 = createStore(storage3, null);
// Force an empty catalog cache so counts below are rows only, not
// whatever the S2 loader tests left cached in this process.
await S3.loadSoundsCatalog(async () => ({ ok: true, json: async () => [] }));
ok("fresh store starts with an empty sounds library (seed videos create no originals)", (await S3.listSounds()).length === 0);
const S3reload = createStore(storage3, null);
ok("reloading the same store creates no originals for seed videos either", (await S3reload.listSounds()).length === 0);
const u3 = await S3.signUp("sounds3@example.com", "secret1", "sound_user");
const creds3 = await S3.ensureDemoAdmin();
const adm3 = await S3.logIn(creds3.email, creds3.password);
// addSound validation + stored fields (user + admin defaults).
await throws("addSound rejects an unknown caller id", () => S3.addSound("no-such-profile", { title: "X", category: "naat", src: "https://example.invalid/x.mp3" }));
await throws("addSound rejects a blank title", () => S3.addSound(u3.id, { title: " ", category: "naat", src: "https://example.invalid/x.mp3" }));
const longTitle = await S3.addSound(u3.id, { title: "T".repeat(120), category: "taqreer", src: "https://example.invalid/long.mp3" });
ok("title longer than 80 chars is sliced to exactly 80", longTitle.title.length === 80);
await S3.deleteSound(adm3.id, longTitle.id);
await throws("addSound rejects category music", () => S3.addSound(u3.id, { title: "Song", category: "music", src: "https://example.invalid/x.mp3" }));
await throws("addSound rejects a missing category", () => S3.addSound(u3.id, { title: "No cat", src: "https://example.invalid/x.mp3" }));
await throws("addSound rejects an oversized demo audio file (8 MB cap)", () => S3.addSound(u3.id, { title: "Huge", category: "naat", file: { size: 8 * 1024 * 1024 + 1, type: "audio/mpeg", arrayBuffer: async () => new ArrayBuffer(0) } }));
const fileSound = await S3.addSound(u3.id, { title: "Rain on roof", category: "sound-effects", file: new Blob(["fake-audio"], { type: "audio/mpeg" }) });
ok("audio file is stored as a data URL with the user defaults", fileSound.src.startsWith("data:audio/mpeg;base64,") && fileSound.source_type === "user" && fileSound.source === "Added by @sound_user" && fileSound.creator_username === "sound_user" && fileSound.status === "live" && fileSound.report_count === 0 && !!fileSound.created_at);
const adminSound = await S3.addSound(adm3.id, { title: "Owner note", category: "islamic", src: "https://example.invalid/owner.mp3" });
ok("admin default source is 'Added by the owner'", adminSound.source === "Added by the owner" && adminSound.source_type === "admin");
ok("explicit source note is kept verbatim", (await S3.addSound(u3.id, { title: "Kept note", category: "naat", src: "https://example.invalid/k.mp3", source: "Recorded by me" })).source === "Recorded by me");
// deleteSound: row kept, status removed, filtered, idempotent.
await S3.deleteSound(adm3.id, fileSound.id);
const persisted3 = JSON.parse(storage3.getItem("tokisla_demo_v5"));
const keptRow = persisted3.sounds.find((s) => s.id === fileSound.id);
ok("deleteSound keeps the row with status removed (audit trail)", !!keptRow && keptRow.status === "removed");
ok("removed row is filtered from listSounds", !(await S3.listSounds()).some((s) => s.id === fileSound.id));
// reportSound: validation, 500-char slice, stays visible, no count bump.
await throws("reportSound rejects an unsigned reporter", () => S3.reportSound(null, adminSound.id, "Contains music"));
await throws("reportSound rejects an empty reason", () => S3.reportSound(u3.id, adminSound.id, "   "));
const beforeReports = (await S3.adminReports()).length;
await S3.reportSound(u3.id, adminSound.id, "x".repeat(600));
const soundReports = (await S3.adminReports()).filter((r) => r.target_type === "sound");
ok("reportSound files an open sound report with the reason sliced to 500", soundReports.length === 1 && soundReports[0].target_id === adminSound.id && soundReports[0].reason.length === 500 && soundReports[0].status === "open" && (await S3.adminReports()).length === beforeReports + 1);
const reportedRow = (await S3.listSounds()).find((s) => s.id === adminSound.id);
ok("reported sound stays visible with report_count untouched in demo", !!reportedRow && reportedRow.report_count === 0 && reportedRow.status === "live");
// Original auto-register: live publish, draft publish, re-approve dedupe,
// skipped when a library sound is chosen, fallback title, no use count.
const liveVid = await S3.submitVideo(u3.id, { duration_seconds: 9, caption: "my own audio", visibility: "public", storage_path: "blob:demo-orig" });
const orig1 = (await S3.listSounds()).find((s) => s.id === "original-" + liveVid.id);
ok("live publish auto-registers a stable original entry with all fields", !!orig1 && orig1.title === "Original sound — @sound_user" && orig1.category === "original" && orig1.source_type === "original" && orig1.creator_id === u3.id && orig1.creator_username === "sound_user" && orig1.video_id === liveVid.id && orig1.src === "blob:demo-orig" && orig1.status === "live" && orig1.report_count === 0 && orig1.duration_seconds === 9);
ok("original entries carry no use count field", !("use_count" in orig1) && !("uses" in orig1));
await S3.adminDecide("admin", liveVid.id, "rejected", "Not allowed on Tokisla");
await S3.adminDecide("admin", liveVid.id, "approved");
ok("re-approving the same video does not register a second original (dedupe)", (await S3.listSounds()).filter((s) => s.video_id === liveVid.id).length === 1);
const withSound = await S3.submitVideo(u3.id, { duration_seconds: 9, caption: "library sound", visibility: "public", storage_path: "blob:demo", sound_id: adminSound.id, sound_title: adminSound.title, sound_category: "islamic" });
ok("video with a library sound registers no original", !(await S3.listSounds()).some((s) => s.video_id === withSound.id));
const origVid = await S3.submitVideo(u3.id, { duration_seconds: 8, caption: "picking an original", visibility: "public", storage_path: "blob:demo", sound_id: orig1.id, sound_title: orig1.title });
ok("choosing an original sound attaches sound_id/sound_title but no sound_category", origVid.sound_id === orig1.id && origVid.sound_title === orig1.title && (origVid.sound_category === null || origVid.sound_category === undefined));
const draftOrig = await S3.submitVideo(u3.id, { caption: "draft original", duration_seconds: 6, storage_path: "blob:draft", is_draft: true });
ok("draft creates no original while it waits", !(await S3.listSounds()).some((s) => s.video_id === draftOrig.id));
await S3.publishDraft(u3.id, draftOrig.id);
const origDraft = (await S3.listSounds()).find((s) => s.id === "original-" + draftOrig.id);
ok("publishing a draft auto-registers its original", !!origDraft && origDraft.title === "Original sound — @sound_user");
const draftWithSound = await S3.submitVideo(u3.id, { caption: "draft with sound", duration_seconds: 6, storage_path: "blob:draft2", is_draft: true, sound_id: adminSound.id, sound_title: adminSound.title });
await S3.publishDraft(u3.id, draftWithSound.id);
ok("publishing a draft that chose a library sound registers no original", !(await S3.listSounds()).some((s) => s.video_id === draftWithSound.id));
const ghostVid = await S3.submitVideo("ghost-creator", { duration_seconds: 7, caption: "no profile", visibility: "public", storage_path: "blob:ghost" });
const ghostOrig = (await S3.listSounds()).find((s) => s.id === "original-" + ghostVid.id);
ok("original title falls back to plain 'Original sound' without a creator profile", !!ghostOrig && ghostOrig.title === "Original sound" && ghostOrig.creator_username === null);

console.log("Legacy sound rows + catalog/row merge dedupe");
const mem4 = new Map();
const storage4 = {
  getItem: (k) => (mem4.has(k) ? mem4.get(k) : null),
  setItem: (k, v) => mem4.set(k, String(v)),
  removeItem: (k) => mem4.delete(k),
};
const S4 = createStore(storage4, null);
await S4.loadSoundsCatalog(async () => ({ ok: true, json: async () => [] }));
const raw4 = JSON.parse(storage4.getItem("tokisla_demo_v5"));
raw4.sounds.push({ id: "legacy-1", title: "Legacy row", category: "naat", src: "https://example.invalid/legacy.mp3", source: "old note" });
storage4.setItem("tokisla_demo_v5", JSON.stringify(raw4));
const S4b = createStore(storage4, null);
const legacy = (await S4b.listSounds()).find((s) => s.id === "legacy-1");
ok("legacy rows default to source_type admin / status live / report_count 0", !!legacy && legacy.source_type === "admin" && legacy.status === "live" && legacy.report_count === 0 && legacy.creator_id === null && legacy.creator_username === null && legacy.video_id === null);
const mem5 = new Map();
const storage5 = {
  getItem: (k) => (mem5.has(k) ? mem5.get(k) : null),
  setItem: (k, v) => mem5.set(k, String(v)),
  removeItem: (k) => mem5.delete(k),
};
const S5 = createStore(storage5, null);
await S5.loadSoundsCatalog(async () => ({ ok: true, json: async () => [{ id: "dup-1", title: "Catalog version", category: "sound-effects", src: "https://example.invalid/cat.mp3", source: "CC0" }] }));
const raw5 = JSON.parse(storage5.getItem("tokisla_demo_v5"));
raw5.sounds.push({ id: "dup-1", title: "Row version", category: "sound-effects", src: "https://example.invalid/row.mp3", source: "row", source_type: "user", status: "live", report_count: 0 });
storage5.setItem("tokisla_demo_v5", JSON.stringify(raw5));
const S5b = createStore(storage5, null);
const mergedDup = (await S5b.listSounds()).filter((s) => s.id === "dup-1");
ok("catalog + row merge dedupes by id (catalog entry wins, single row)", mergedDup.length === 1 && mergedDup[0].title === "Catalog version" && mergedDup[0].source_type === "catalog");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
