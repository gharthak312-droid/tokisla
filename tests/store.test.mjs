// Tokisla demo-store functional tests (Node). Run: node tests/store.test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
global.window = undefined;
globalThis.TOKISLA_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", MAX_VIDEO_SECONDS: 20, MAX_VIDEO_MB: 15, APP_NAME: "Tokisla" };
const { createStore, CATEGORIES } = require("../store.js");

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

console.log("Upload + moderation gate");
await throws("25s video rejected by store", () => S.submitVideo(me.id, { duration_seconds: 25, caption: "too long" }));
const up = await S.submitVideo(me.id, { duration_seconds: 15, caption: "My first Tokisla video #dua", category_ids: [4], visibility: "public", storage_path: "blob:demo" });
ok("upload lands as pending", up.moderation_status === "pending");
ok("pending video NOT in public feed", !(await S.feed(me.id, "foryou")).some((v) => v.id === up.id));
ok("pending video visible in My Videos", (await S.myVideos(me.id)).some((v) => v.id === up.id && v.moderation_status === "pending"));
ok("admin queue contains it", (await S.adminQueue()).some((v) => v.id === up.id));
await S.adminDecide("admin", up.id, "approved");
ok("after approve it IS in the feed", (await S.feed(me.id, "foryou")).some((v) => v.id === up.id));
const up2 = await S.submitVideo(me.id, { duration_seconds: 10, caption: "will be rejected", category_ids: [1] });
await S.adminDecide("admin", up2.id, "rejected", "Contains music");
ok("rejected video stays out of feed", !(await S.feed(me.id, "foryou")).some((v) => v.id === up2.id));
ok("rejection reason kept", (await S.myVideos(me.id)).find((v) => v.id === up2.id).rejection_reason === "Contains music");

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
ok("admin stats sane", stats.users >= 6 && stats.approved >= 10 && stats.openReports === 1);
const upPriv = await S.submitVideo(me.id, { duration_seconds: 9, caption: "my private note", category_ids: [1], visibility: "private", storage_path: "blob:demo" });
ok("private video listed in my Locked videos", (await S.myPrivateVideos(me.id)).some((v) => v.id === upPriv.id));
ok("private video not in the public profile grid", !(await S.profileVideos(me.id, me.id)).some((v) => v.id === upPriv.id));
const queueNow = await S.adminQueue();
ok("queue holds only the test's own submission (no built-in samples)", queueNow.length === 1 && queueNow[0].id === upPriv.id);


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
const draft = await S.submitVideo(me.id, { caption: "Draft @second_user note", duration_seconds: 4, storage_path: "demo-upload", category_ids: [1], is_draft: true });
ok("draft stays out of the moderation queue", !(await S.adminQueue()).some((v) => v.id === draft.id));
ok("draft is listed under my drafts", (await S.myDrafts(me.id)).some((v) => v.id === draft.id));
ok("draft does not notify mentions yet", (await S.notifications(other.id)).filter((n) => n.type === "mention").length === mentionBase + 1);
await S.publishDraft(me.id, draft.id);
ok("published draft enters the moderation queue", (await S.adminQueue()).some((v) => v.id === draft.id));
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

const reply = await S.submitVideo(other.id, { caption: "Video reply!", duration_seconds: 6, storage_path: "demo-upload", category_ids: [1], reply_comment_id: c1.id });
ok("video reply knows its parent video", reply.reply_video_id === seedVid.id);
await S.adminDecide(adm.id, reply.id, "approved");
cs = await S.comments(seedVid.id, me.id);
ok("approved reply is linked on its comment", cs.find((c) => c.id === c1.id).reply_video_id === reply.id);
const duet = await S.submitVideo(other.id, { caption: "Duet time", duration_seconds: 7, storage_path: "demo-upload", category_ids: [1], duet_of: "v-user-1", filter: "warm" });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
