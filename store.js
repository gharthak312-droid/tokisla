/* Tokisla data layer — dual mode, exactly like the owner's other projects.
 *
 * DEMO MODE (config keys empty): everything runs on localStorage with seeded
 * sample data so every flow can be tested end-to-end. Clearly badged in the UI.
 *
 * LIVE MODE: talks to Supabase (schema in supabase/migrations). The app only
 * ever uses the anon key + RLS; uploads go through the create-upload Edge
 * Function for a signed URL (never a service-role key in the client).
 *
 * This file is DOM-free so it can be unit-tested in Node (tests/store.test.mjs).
 */
(function (global) {
  "use strict";

  const CFG = (global.TOKISLA_CONFIG || {
    SUPABASE_URL: "", SUPABASE_ANON_KEY: "",
    MAX_VIDEO_SECONDS: 20, MAX_VIDEO_MB: 15, APP_NAME: "Tokisla",
  });
  const DEMO = !CFG.SUPABASE_URL;

  const CATEGORIES = [
    "Islamic Knowledge", "Quran and Recitation", "Hadith and Sunnah",
    "Duas and Daily Reminders", "Islamic History and Seerah", "Islamic Motivation",
    "Halal Funny Videos", "Clean Comedy", "Educational Videos",
    "Science and General Knowledge", "Life Lessons and Sabaq", "Motivational Stories",
    "Personal Development", "Good Manners and Character", "Family and Society",
    "Positive Entertainment", "Language Learning", "Technology and Digital Skills",
    "Halal Business and Entrepreneurship", "Health and Positive Lifestyle",
  ].map((name, i) => ({ id: i + 1, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), sort_order: i + 1, is_active: true }));

  const uid = () => "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = () => new Date().toISOString();

  /* ------------------------------------------------------------ DEMO store */
  const LS_KEY = "tokisla_demo_v5";

  function demoSeed() {
    const creators = [
      { id: "u-demo-1", username: "quran.moments", display_name: "Quran Moments", bio: "Daily recitation & reflection.", avatar_url: "", role: "user", is_suspended: false, verified: true },
      { id: "u-demo-2", username: "seerah.stories", display_name: "Seerah Stories", bio: "Stories from the life of the Prophet ﷺ.", avatar_url: "", role: "user", is_suspended: false, verified: false },
      { id: "u-demo-3", username: "halal.laughs", display_name: "Halal Laughs", bio: "Clean comedy only.", avatar_url: "", role: "user", is_suspended: false, verified: false },
      { id: "u-demo-4", username: "learn.daily", display_name: "Learn Daily", bio: "One useful thing every day.", avatar_url: "", role: "user", is_suspended: false, verified: false },
      { id: "u-owner", username: "chairman.wadood", display_name: "Chairman Wadood", bio: "Founder, Tokisla.", avatar_url: "", role: "user", is_suspended: false, verified: true },
    ];
    // No built-in sample videos: the owner removed the ones added during
    // the build (2026-10-28), so a fresh demo starts with only his own
    // uploads below. The four sample creator profiles stay as empty
    // accounts (no videos) so social features can still be tried.
    const vids = [];
    const seedLikes = [];
    // The owner's own uploaded videos (added 2026-10-28 at his request).
    vids.push(
      { id: "v-user-1", creator_id: "u-owner", caption: "Assalam-o-Alaikum - Chairman Wadood on Tokisla #welcome",
        storage_provider: "demo", storage_path: "assets/user/user-1.mp4", thumbnail_path: "assets/user/user-1.jpg",
        duration_seconds: 16, size_bytes: 594198, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-2", creator_id: "u-owner", caption: "Walk with confidence #style",
        storage_provider: "demo", storage_path: "assets/user/user-2.mp4", thumbnail_path: "assets/user/user-2.jpg",
        duration_seconds: 20, size_bytes: 1130937, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16],
        poll: { question: "Confidence pehle, ya style?", options: ["Confidence", "Style"] } },
      { id: "v-user-3", creator_id: "u-owner", caption: "Claim #1 - top rank moment #gaming",
        storage_provider: "demo", storage_path: "assets/user/user-3.mp4", thumbnail_path: "assets/user/user-3.jpg",
        duration_seconds: 10, size_bytes: 1485892, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-4", creator_id: "u-owner", caption: "Before marriage - a sweet couple moment #family",
        storage_provider: "demo", storage_path: "assets/user/user-4.mp4", thumbnail_path: "assets/user/user-4.jpg",
        duration_seconds: 17, size_bytes: 984391, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [15] },
      { id: "v-user-5", creator_id: "u-owner", caption: "Alag hi level ki mummy - clean comedy #funny",
        storage_provider: "demo", storage_path: "assets/user/user-5.mp4", thumbnail_path: "assets/user/user-5.jpg",
        duration_seconds: 15, size_bytes: 545714, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [8] },
      { id: "v-user-6", creator_id: "u-owner", caption: "Urdu poetry - wafadari ki baat #poetry",
        storage_provider: "demo", storage_path: "assets/user/user-6.mp4", thumbnail_path: "assets/user/user-6.jpg",
        duration_seconds: 13, size_bytes: 518071, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [11] },
      { id: "v-user-7", creator_id: "u-owner", caption: "Hamesha khush rehna chahte ho - a gentle reminder #motivation",
        storage_provider: "demo", storage_path: "assets/user/user-7.mp4", thumbnail_path: "assets/user/user-7.jpg",
        duration_seconds: 10, size_bytes: 288499, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [12] },
      { id: "v-user-8", creator_id: "u-owner", caption: "Smile more, worry less #positive",
        storage_provider: "demo", storage_path: "assets/user/user-8.mp4", thumbnail_path: "assets/user/user-8.jpg",
        duration_seconds: 18, size_bytes: 2154398, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [20] },
      { id: "v-user-9", creator_id: "u-owner", caption: "Evening vibes - Quetta walk #style",
        storage_provider: "demo", storage_path: "assets/user/user-9.mp4", thumbnail_path: "assets/user/user-9.jpg",
        duration_seconds: 17, size_bytes: 1611962, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-10", creator_id: "u-owner", caption: "Chota Don - Urdu poetry lines #poetry",
        storage_provider: "demo", storage_path: "assets/user/user-10.mp4", thumbnail_path: "assets/user/user-10.jpg",
        duration_seconds: 12, size_bytes: 361094, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [11] }
    );
    return {
      profiles: creators, videos: vids, categories: CATEGORIES,
      follows: [], likes: seedLikes, saves: [], blocks: [], comments: [],
      reports: [], notifications: [], reviews: [],
      users: [], // demo auth accounts {id, email, password, profile_id}
      prefs: {}, session: null, watchHistory: [], accountEvents: [], verifyRequests: [], messages: [],
      commentLikes: [], pollVotes: [],
      stories: [{ id: "s-user-1", user_id: "u-owner", media_type: "image", storage_path: "assets/user/user-3.jpg",
        caption: "Quetta ki shaam", duration_seconds: null, moderation_status: "approved", created_at: now() }],
      storyViews: [],
    };
  }

  function loadDemo(storage) {
    try {
      const raw = storage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted -> reseed */ }
    const s = demoSeed();
    saveDemo(storage, s);
    return s;
  }
  function saveDemo(storage, s) {
    try { storage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* quota */ }
  }

  function makeDemoStore(storage) {
    let S = loadDemo(storage);
    S.watchHistory = S.watchHistory || []; S.accountEvents = S.accountEvents || []; S.verifyRequests = S.verifyRequests || []; S.messages = S.messages || [];
    S.commentLikes = S.commentLikes || []; S.pollVotes = S.pollVotes || []; S.stories = S.stories || []; S.storyViews = S.storyViews || [];
    const save = () => saveDemo(storage, S);
    const profileOf = (id) => S.profiles.find((p) => p.id === id) || null;
    const pubVideo = (v) => {
      const p = profileOf(v.creator_id);
      return { ...v, username: p ? p.username : "unknown", display_name: p ? p.display_name : "", avatar_url: p ? p.avatar_url : "", verified: !!(p && p.verified) };
    };
    const pollStateOf = (video, me) => {
      const votes = S.pollVotes.filter((x) => x.video_id === video.id);
      const counts = [0, 0];
      votes.forEach((x) => { counts[x.choice] = (counts[x.choice] || 0) + 1; });
      const mine = me ? votes.find((x) => x.user_id === me) : null;
      return { counts, total: votes.length, my: mine ? mine.choice : null };
    };
    const enrich = (v, me) => {
      const out = pubVideo(v);
      if (v.duet_of) {
        const src = S.videos.find((x) => x.id === v.duet_of);
        if (src) { const sp = profileOf(src.creator_id); out.duet_source = { id: src.id, storage_path: src.storage_path, thumbnail_path: src.thumbnail_path, creator_id: src.creator_id, username: sp ? sp.username : "unknown", display_name: sp ? sp.display_name : "" }; }
      }
      if (v.reply_comment_id) {
        const c = S.comments.find((x) => x.id === v.reply_comment_id);
        if (c) { const cp = profileOf(c.user_id); out.reply_comment = { id: c.id, body: c.body, username: cp ? cp.username : "unknown", video_id: c.video_id }; }
      }
      if (v.poll) out.poll_state = pollStateOf(v, me);
      return out;
    };
    const notifyMentions = (me, text, videoId, extraExclude) => {
      const names = [...new Set((String(text || "").match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
      for (const name of names) {
        const target = S.profiles.find((pr) => pr.username === name);
        if (!target || target.id === me || (extraExclude || []).includes(target.id)) continue;
        const mp = allowOf(target.id).allow_mention;
        if (mp === "nobody") continue;
        if (mp === "followers" && !followsCreator(me, target.id)) continue;
        S.notifications.push({ id: uid(), user_id: target.id, type: "mention", actor_id: me, video_id: videoId, is_read: false, created_at: now() });
      }
    };
    const blockedIds = (me) => new Set(S.blocks.filter((b) => b.blocker_id === me).map((b) => b.blocked_id));
    const approvedVisible = (me) => {
      const blocked = blockedIds(me);
      return S.videos.filter((v) => v.moderation_status === "approved" && !blocked.has(v.creator_id)
        && (v.visibility === "public" || v.creator_id === me
          || (v.visibility === "followers" && S.follows.some((f) => f.follower_id === me && f.following_id === v.creator_id))))
        .filter((v) => { const p = profileOf(v.creator_id); return p && !p.is_suspended; })
        .filter((v) => { if (v.creator_id === me) return true; const p = profileOf(v.creator_id);
          if (p && p.private_account) return S.follows.some((f) => f.follower_id === me && f.following_id === v.creator_id);
          return true; });
    };
    const allowOf = (userId) => Object.assign(
      { allow_comment: "everyone", allow_mention: "everyone", allow_like: "everyone", allow_download: "everyone", view_follow_list: "everyone" },
      (S.prefs[userId] || {}));
    const followsCreator = (me, creator) => S.follows.some((f) => f.follower_id === me && f.following_id === creator);

    return {
      mode: "demo",
      async signUp(email, password, username) {
        email = String(email || "").trim().toLowerCase();
        username = String(username || "").trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new Error("Username: 3-24 chars, letters, numbers, dot or underscore.");
        if (S.profiles.some((p) => p.username === username)) throw new Error("That username is taken.");
        if (S.users.some((u) => u.email === email)) throw new Error("An account with this email already exists.");
        if (String(password).length < 6) throw new Error("Password must be at least 6 characters.");
        const prof = { id: uid(), username, display_name: username, bio: "", avatar_url: "", role: "user", is_suspended: false, verified: false, private_account: false, created_at: new Date().toISOString() };
        S.profiles.push(prof);
        S.users.push({ id: prof.id, email, password: String(password), profile_id: prof.id });
        const chair = S.profiles.find((x) => x.username === "chairman.wadood");
        if (chair) S.messages.push({ id: uid(), sender_id: chair.id, recipient_id: prof.id, body: "Assalamu alaikum! Welcome to Tokisla. Post short, positive videos - every video is checked by our team before it goes live.", is_read: false, created_at: now() });
        S.session = prof.id; save();
        return prof;
      },
      async logIn(email, password) {
        const u = S.users.find((x) => x.email === String(email).trim().toLowerCase());
        if (!u || u.password !== String(password)) throw new Error("Email or password is incorrect.");
        const prof = profileOf(u.profile_id);
        if (prof && prof.is_suspended) throw new Error("This account is suspended.");
        S.session = u.profile_id; save();
        return prof;
      },
      async logOut() { S.session = null; save(); },
      async currentUser() { return S.session ? profileOf(S.session) : null; },
      async usernameAvailable(username) {
        username = String(username || "").trim().toLowerCase();
        return /^[a-z0-9_.]{3,24}$/.test(username) && !S.profiles.some((p) => p.username === username);
      },
      async updateProfile(me, patch) {
        const p = profileOf(me); if (!p) throw new Error("Not signed in.");
        if (patch.username !== undefined) {
          const u = String(patch.username).trim().toLowerCase();
          if (!/^[a-z0-9_.]{3,24}$/.test(u)) throw new Error("Username: 3-24 chars, letters, numbers, dot or underscore.");
          if (u !== p.username && S.profiles.some((x) => x.username === u)) throw new Error("That username is taken.");
          p.username = u;
        }
        if (patch.display_name !== undefined) p.display_name = String(patch.display_name).slice(0, 60);
        if (patch.bio !== undefined) p.bio = String(patch.bio).slice(0, 160);
        if (patch.website !== undefined) p.website = String(patch.website).trim().slice(0, 200);
        if (patch.avatar_url !== undefined) p.avatar_url = patch.avatar_url;
        save(); return p;
      },
      async setPreferences(me, categoryIds) { S.prefs[me] = { category_ids: categoryIds }; save(); },
      async getPreferences(me) { return S.prefs[me] || { category_ids: [] }; },

      async feed(me, kind) {
        let list = approvedVisible(me);
        if (kind === "following") {
          const fol = new Set(S.follows.filter((f) => f.follower_id === me).map((f) => f.following_id));
          list = list.filter((v) => fol.has(v.creator_id));
        } else {
          const pref = new Set((S.prefs[me] || {}).category_ids || []);
          list = list.slice().sort((a, b) => {
            const sa = (a.category_ids.some((c) => pref.has(c)) ? 2 : 0) + a.like_count / 100;
            const sb = (b.category_ids.some((c) => pref.has(c)) ? 2 : 0) + b.like_count / 100;
            return sb - sa || (a.created_at < b.created_at ? 1 : -1);
          });
        }
        return list.map((v) => enrich(v, me));
      },
      async myVideos(me) { return S.videos.filter((v) => v.creator_id === me).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(pubVideo); },
      async profileVideos(userId, me) {
        return approvedVisible(me).filter((v) => v.creator_id === userId).map(pubVideo);
      },
      async getProfile(userId) { return profileOf(userId); },
      async socialCounts(userId) {
        return {
          followers: S.follows.filter((f) => f.following_id === userId).length,
          following: S.follows.filter((f) => f.follower_id === userId).length,
          videos: S.videos.filter((v) => v.creator_id === userId && v.moderation_status === "approved").length,
        };
      },
      async isFollowing(me, userId) { return S.follows.some((f) => f.follower_id === me && f.following_id === userId); },
      async profileStats(userId, me) {
        return { followers: S.follows.filter((f) => f.following_id === userId).length,
          following: S.follows.filter((f) => f.follower_id === userId).length,
          videos: S.videos.filter((v) => v.creator_id === userId && v.moderation_status === "approved").length,
          is_following: me ? S.follows.some((f) => f.follower_id === me && f.following_id === userId) : false };
      },
      async toggleFollow(me, userId) {
        if (me === userId) throw new Error("You cannot follow yourself.");
        const i = S.follows.findIndex((f) => f.follower_id === me && f.following_id === userId);
        if (i >= 0) { S.follows.splice(i, 1); save(); return false; }
        S.follows.push({ follower_id: me, following_id: userId, created_at: now() });
        S.notifications.push({ id: uid(), user_id: userId, type: "follow", actor_id: me, video_id: null, is_read: false, created_at: now() });
        save(); return true;
      },
      async likedIds(me) { return new Set(S.likes.filter((l) => l.user_id === me).map((l) => l.video_id)); },
      async toggleLike(me, videoId) {
        const v = S.videos.find((x) => x.id === videoId); if (!v) throw new Error("Video not found.");
        const i = S.likes.findIndex((l) => l.user_id === me && l.video_id === videoId);
        if (i >= 0) { S.likes.splice(i, 1); v.like_count = Math.max(0, v.like_count - 1); save(); return false; }
        if (v.creator_id !== me) {
          const lp = allowOf(v.creator_id).allow_like;
          if (lp === "nobody") throw new Error("Likes are turned off for this video.");
          if (lp === "followers" && !followsCreator(me, v.creator_id)) throw new Error("Only followers can like this video.");
        }
        S.likes.push({ user_id: me, video_id: videoId, created_at: now() }); v.like_count += 1;
        if (v.creator_id !== me) S.notifications.push({ id: uid(), user_id: v.creator_id, type: "like", actor_id: me, video_id: videoId, is_read: false, created_at: now() });
        save(); return true;
      },
      async savedIds(me) { return new Set(S.saves.filter((s) => s.user_id === me).map((s) => s.video_id)); },
      async toggleSave(me, videoId) {
        const i = S.saves.findIndex((s) => s.user_id === me && s.video_id === videoId);
        if (i >= 0) { S.saves.splice(i, 1); save(); return false; }
        S.saves.push({ user_id: me, video_id: videoId, created_at: now() }); save(); return true;
      },
      async savedVideos(me) {
        const ids = new Set(S.saves.filter((s) => s.user_id === me).map((s) => s.video_id));
        return S.videos.filter((v) => ids.has(v.id) && v.moderation_status === "approved").map(pubVideo);
      },
      async likedVideos(me) {
        const ids = new Set(S.likes.filter((l) => l.user_id === me).map((l) => l.video_id));
        return S.videos.filter((v) => ids.has(v.id) && v.moderation_status === "approved").map(pubVideo);
      },
      async myPrivateVideos(me) {
        return S.videos.filter((v) => v.creator_id === me && v.visibility === "private")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(pubVideo);
      },
      async recordView(videoId, me) {
        const v = S.videos.find((x) => x.id === videoId);
        if (v) { v.view_count = (v.view_count || 0) + 1; }
        if (me) {
          S.watchHistory = S.watchHistory.filter((h) => !(h.user_id === me && h.video_id === videoId));
          S.watchHistory.unshift({ user_id: me, video_id: videoId, watched_at: now() });
          S.watchHistory = S.watchHistory.slice(0, 100);
        }
        save();
      },
      async myWatchHistory(me) {
        return S.watchHistory.filter((h) => h.user_id === me)
          .map((h) => { const v = S.videos.find((x) => x.id === h.video_id); return v ? { ...pubVideo(v), watched_at: h.watched_at } : null; })
          .filter(Boolean);
      },
      async myComments(me) {
        return S.comments.filter((c) => c.user_id === me)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((c) => { const v = S.videos.find((x) => x.id === c.video_id); const cr = v ? profileOf(v.creator_id) : null;
            return { ...c, video_caption: v ? v.caption : "", video_thumbnail: v ? v.thumbnail_path : "", video_creator: cr ? cr.username : "" }; });
      },
      async logEvent(me, type, detail) {
        S.accountEvents.unshift({ user_id: me, type, detail: detail || "", at: now() });
        S.accountEvents = S.accountEvents.slice(0, 100); save();
      },
      async myEvents(me) { return S.accountEvents.filter((e) => e.user_id === me); },
      async creatorStats(me) {
        const vids = S.videos.filter((v) => v.creator_id === me && v.moderation_status === "approved")
          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).map(pubVideo);
        return { videos: vids, videoCount: vids.length,
          totalViews: vids.reduce((a, v) => a + (v.view_count || 0), 0),
          totalLikes: vids.reduce((a, v) => a + (v.like_count || 0), 0),
          totalComments: vids.reduce((a, v) => a + (v.comment_count || 0), 0),
          followers: S.follows.filter((f) => f.following_id === me).length };
      },
      async trending() {
        return S.videos.filter((v) => v.moderation_status === "approved" && v.visibility === "public")
          .filter((v) => { const pr = profileOf(v.creator_id); return pr && !pr.is_suspended && !pr.private_account; })
          .sort((a, b) => (b.like_count || 0) - (a.like_count || 0)).slice(0, 5).map(pubVideo);
      },
      async accountDetails(me) {
        const pr = profileOf(me); if (!pr) return null;
        const u = S.users.find((x) => x.profile_id === me);
        return { ...pr, email: u ? u.email : "" };
      },
      async setPrivateAccount(me, on) { const pr = profileOf(me); if (pr) { pr.private_account = !!on; save(); } return pr; },
      async applyForVerification(me, info) {
        const pr = profileOf(me); if (!pr) throw new Error("Not signed in.");
        if (pr.verified) throw new Error("You already have a blue tick.");
        if (S.verifyRequests.some((r) => r.user_id === me && r.status === "pending")) throw new Error("Your application is already under review.");
        const tid = String((info && info.tid) || "").trim();
        if (tid.length < 6) throw new Error("Enter the payment Transaction ID (TID).");
        const req = { id: uid(), user_id: me, full_name: String(info.full_name || "").slice(0, 80), category: info.category || "Creator", note: String(info.note || "").slice(0, 300), method: info.method || "JazzCash", tid, status: "pending", created_at: now() };
        S.verifyRequests.push(req); save(); return req;
      },
      async myVerification(me) {
        const list = S.verifyRequests.filter((r) => r.user_id === me).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return list[0] || null;
      },
      async adminVerifyRequests() {
        return S.verifyRequests.filter((r) => r.status === "pending")
          .map((r) => { const pr = profileOf(r.user_id); return { ...r, username: pr ? pr.username : "?", display_name: pr ? pr.display_name : "" }; });
      },
      async adminDecideVerification(adminId, reqId, decision) {
        const r = S.verifyRequests.find((x) => x.id === reqId); if (!r) throw new Error("Request not found.");
        r.status = decision === "approved" ? "approved" : "rejected"; r.decided_at = now(); r.decided_by = adminId;
        if (r.status === "approved") { const pr = profileOf(r.user_id); if (pr) pr.verified = true; }
        S.notifications.push({ id: uid(), user_id: r.user_id, type: "system", actor_id: null, video_id: null, is_read: false, created_at: now() });
        save(); return r;
      },
      async conversations(me) {
        const byOther = new Map();
        S.messages.filter((m) => m.sender_id === me || m.recipient_id === me)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
          .forEach((m) => {
            const other = m.sender_id === me ? m.recipient_id : m.sender_id;
            const cur = byOther.get(other) || { user: profileOf(other), last: m, unread: 0 };
            cur.last = m;
            if (m.recipient_id === me && !m.is_read) cur.unread += 1;
            byOther.set(other, cur);
          });
        return [...byOther.values()].filter((c) => c.user)
          .sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1));
      },
      async thread(me, otherId) {
        return S.messages.filter((m) => (m.sender_id === me && m.recipient_id === otherId) || (m.sender_id === otherId && m.recipient_id === me))
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      },
      async sendMessage(me, otherId, body) {
        body = String(body || "").trim();
        if (!body) throw new Error("Write a message first.");
        if (body.length > 1000) throw new Error("Message is too long.");
        if (S.blocks.some((b) => (b.blocker_id === me && b.blocked_id === otherId) || (b.blocker_id === otherId && b.blocked_id === me)))
          throw new Error("You cannot message this person.");
        const msg = { id: uid(), sender_id: me, recipient_id: otherId, body, is_read: false, created_at: now() };
        S.messages.push(msg); save(); return msg;
      },
      async markThreadRead(me, otherId) {
        let changed = false;
        S.messages.forEach((m) => { if (m.recipient_id === me && m.sender_id === otherId && !m.is_read) { m.is_read = true; changed = true; } });
        if (changed) save();
      },
      async unreadMessages(me) { return S.messages.filter((m) => m.recipient_id === me && !m.is_read).length; },
      async getAllowPrefs(userId) { return allowOf(userId); },
      async setAllowPref(me, key, value) { S.prefs[me] = { ...(S.prefs[me] || {}), [key]: value }; save(); return allowOf(me); },
      async followList(userId, kind) {
        const rows = kind === "followers" ? S.follows.filter((f) => f.following_id === userId) : S.follows.filter((f) => f.follower_id === userId);
        return rows.map((f) => profileOf(kind === "followers" ? f.follower_id : f.following_id)).filter(Boolean)
          .map((pr) => ({ id: pr.id, username: pr.username, display_name: pr.display_name, avatar_url: pr.avatar_url, verified: !!pr.verified }));
      },
      async totalLikesReceived(userId) {
        return S.videos.filter((v) => v.creator_id === userId).reduce((a, v) => a + (v.like_count || 0), 0);
      },
      async people(me) {
        return S.profiles.filter((p) => !p.is_suspended && p.role !== "admin" && p.id !== me).slice(0, 12);
      },
      async shareVideo(me, videoId, toUserId) {
        S.notifications.push({ id: uid(), user_id: toUserId, type: "share", actor_id: me, video_id: videoId, is_read: false, created_at: now() });
        save(); return true;
      },
      async comments(videoId, me) {
        return S.comments.filter((c) => c.video_id === videoId && c.moderation_status === "visible")
          .sort((a, b) => ((b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)) || (a.created_at < b.created_at ? -1 : 1))
          .map((c) => {
            const p = profileOf(c.user_id);
            const likes = S.commentLikes.filter((l) => l.comment_id === c.id);
            const reply = S.videos.filter((x) => x.reply_comment_id === c.id && x.moderation_status === "approved")
              .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
            return { ...c, username: p ? p.username : "unknown", avatar_url: p ? p.avatar_url : "",
              like_count: likes.length, liked_by_me: !!(me && likes.some((l) => l.user_id === me)),
              reply_video_id: reply ? reply.id : null };
          });
      },
      async toggleCommentLike(me, commentId) {
        const i = S.commentLikes.findIndex((l) => l.comment_id === commentId && l.user_id === me);
        if (i >= 0) S.commentLikes.splice(i, 1); else S.commentLikes.push({ comment_id: commentId, user_id: me, created_at: now() });
        save();
        return { liked: i < 0, count: S.commentLikes.filter((l) => l.comment_id === commentId).length };
      },
      async pinComment(me, commentId) {
        const c = S.comments.find((x) => x.id === commentId); if (!c) throw new Error("Comment not found.");
        const v = S.videos.find((x) => x.id === c.video_id);
        if (!v || v.creator_id !== me) throw new Error("Only the video creator can pin a comment.");
        const target = !c.is_pinned;
        S.comments.forEach((x) => { if (x.video_id === c.video_id) x.is_pinned = false; });
        c.is_pinned = target; save();
        return target;
      },
      async votePoll(me, videoId, choice) {
        const v = S.videos.find((x) => x.id === videoId);
        if (!v || !v.poll) throw new Error("This video has no poll.");
        choice = choice === 1 ? 1 : 0;
        const ex = S.pollVotes.find((x) => x.video_id === videoId && x.user_id === me);
        if (ex) ex.choice = choice; else S.pollVotes.push({ video_id: videoId, user_id: me, choice, created_at: now() });
        save();
        return pollStateOf(v, me);
      },
      async addComment(me, videoId, body) {
        body = String(body || "").trim(); if (!body) throw new Error("Write a comment first.");
        const v = S.videos.find((x) => x.id === videoId); if (!v) throw new Error("Video not found.");
        if (v.creator_id !== me) {
          const ap = allowOf(v.creator_id).allow_comment;
          if (ap === "nobody") throw new Error("Comments are turned off for this video.");
          if (ap === "followers" && !followsCreator(me, v.creator_id)) throw new Error("Only followers can comment on this video.");
        }
        const c = { id: uid(), video_id: videoId, user_id: me, body: body.slice(0, 500), moderation_status: "visible", created_at: now() };
        S.comments.push(c); v.comment_count += 1;
        if (v.creator_id !== me) S.notifications.push({ id: uid(), user_id: v.creator_id, type: "comment", actor_id: me, video_id: videoId, is_read: false, created_at: now() });
        // @mentions (respects each person's mention setting)
        const names = [...new Set((body.match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
        for (const name of names) {
          const target = S.profiles.find((pr) => pr.username === name);
          if (!target || target.id === me || target.id === v.creator_id) continue;
          const mp = allowOf(target.id).allow_mention;
          if (mp === "nobody") continue;
          if (mp === "followers" && !followsCreator(me, target.id)) continue;
          S.notifications.push({ id: uid(), user_id: target.id, type: "mention", actor_id: me, video_id: videoId, is_read: false, created_at: now() });
        }
        save(); return c;
      },
      async deleteComment(me, commentId) {
        const i = S.comments.findIndex((c) => c.id === commentId);
        if (i < 0) throw new Error("Comment not found.");
        const c = S.comments[i];
        const meProf = profileOf(me);
        if (c.user_id !== me && !(meProf && (meProf.role === "admin" || meProf.role === "moderator"))) throw new Error("You can only delete your own comments.");
        const v = S.videos.find((x) => x.id === c.video_id);
        if (v) v.comment_count = Math.max(0, v.comment_count - 1);
        S.comments.splice(i, 1); save();
      },
      async submitVideo(me, meta) {
        // meta validated by caller (duration/size) AND re-checked here.
        if (!(meta.duration_seconds > 0) || meta.duration_seconds > CFG.MAX_VIDEO_SECONDS + 0.5)
          throw new Error("Videos must be " + CFG.MAX_VIDEO_SECONDS + " seconds or shorter.");
        const FILTERS = ["normal", "warm", "cool", "mono", "vivid"];
        let poll = null;
        if (meta.poll && String(meta.poll.question || "").trim()) {
          const o = Array.isArray(meta.poll.options) ? meta.poll.options : [];
          if (String(o[0] || "").trim() && String(o[1] || "").trim())
            poll = { question: String(meta.poll.question).slice(0, 80), options: [String(o[0]).slice(0, 30), String(o[1]).slice(0, 30)] };
        }
        let replyVideoId = null;
        if (meta.reply_comment_id) {
          const rc = S.comments.find((c) => c.id === meta.reply_comment_id);
          if (rc) replyVideoId = rc.video_id;
        }
        const isDraft = meta.is_draft === true;
        const v = {
          id: uid(), creator_id: me, caption: String(meta.caption || "").slice(0, 300),
          storage_provider: "demo", storage_path: meta.storage_path || "",
          thumbnail_path: meta.thumbnail_path || "", duration_seconds: meta.duration_seconds,
          size_bytes: meta.size_bytes || null, visibility: meta.visibility || "public",
          moderation_status: isDraft ? "draft" : "pending", rejection_reason: null,
          published_at: null, created_at: now(), like_count: 0, comment_count: 0,
          category_ids: meta.category_ids || [],
          filter: FILTERS.includes(meta.filter) ? meta.filter : "normal",
          poll, duet_of: meta.duet_of || null,
          reply_comment_id: meta.reply_comment_id || null, reply_video_id: replyVideoId,
        };
        S.videos.push(v);
        if (!isDraft) notifyMentions(me, v.caption, v.id, [v.creator_id]);
        save(); return v;
      },
      async myDrafts(me) {
        return S.videos.filter((v) => v.creator_id === me && v.moderation_status === "draft")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(pubVideo);
      },
      async publishDraft(me, videoId) {
        const v = S.videos.find((x) => x.id === videoId);
        if (!v || v.creator_id !== me || v.moderation_status !== "draft") throw new Error("Draft not found.");
        v.moderation_status = "pending";
        notifyMentions(me, v.caption, v.id, [v.creator_id]);
        save(); return v;
      },
      async deleteDraft(me, videoId) {
        const i = S.videos.findIndex((x) => x.id === videoId && x.creator_id === me && x.moderation_status === "draft");
        if (i < 0) throw new Error("Draft not found.");
        S.videos.splice(i, 1); save();
      },
      async hashtagVideos(me, tag) {
        tag = String(tag || "").replace(/^#/, "").toLowerCase(); if (!tag) return [];
        return approvedVisible(me).filter((v) => (String(v.caption || "").match(/#([^\s#]+)/g) || [])
          .some((t) => t.slice(1).toLowerCase() === tag)).map((v) => enrich(v, me));
      },
      async trendingHashtags(me) {
        const counts = {};
        approvedVisible(me).forEach((v) => {
          (String(v.caption || "").match(/#([^\s#]+)/g) || []).forEach((t) => {
            const k = t.slice(1).toLowerCase(); counts[k] = (counts[k] || 0) + 1;
          });
        });
        return Object.entries(counts).map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count).slice(0, 12);
      },
      async profileByUsername(username) {
        const p = S.profiles.find((x) => x.username === String(username || "").toLowerCase() && !x.is_suspended);
        return p || null;
      },
      /* --- stories (24h, moderated before they show) --- */
      async submitStory(me, meta) {
        const st = {
          id: uid(), user_id: me, media_type: meta.media_type === "video" ? "video" : "image",
          storage_path: meta.storage_path || "", caption: String(meta.caption || "").slice(0, 200),
          duration_seconds: meta.duration_seconds || null,
          moderation_status: "pending", created_at: now(),
        };
        S.stories.push(st); save(); return st;
      },
      async storiesFeed(me) {
        const cutoff = Date.now() - 24 * 3600 * 1000;
        const blocked = blockedIds(me);
        const byUser = new Map();
        S.stories.filter((x) => x.moderation_status === "approved" && new Date(x.created_at).getTime() > cutoff)
          .filter((x) => !blocked.has(x.user_id))
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
          .forEach((x) => {
            const p = profileOf(x.user_id); if (!p || p.is_suspended) return;
            if (!byUser.has(x.user_id)) byUser.set(x.user_id, { user: p, stories: [], has_unseen: false });
            const g = byUser.get(x.user_id);
            g.stories.push(x);
            if (!S.storyViews.some((sv) => sv.story_id === x.id && sv.user_id === me)) g.has_unseen = true;
          });
        return [...byUser.values()].sort((a, b) => (b.has_unseen ? 1 : 0) - (a.has_unseen ? 1 : 0));
      },
      async myStories(me) {
        return S.stories.filter((x) => x.user_id === me)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      },
      async markStorySeen(me, storyId) {
        if (!S.storyViews.some((sv) => sv.story_id === storyId && sv.user_id === me))
          S.storyViews.push({ story_id: storyId, user_id: me, viewed_at: now() });
        save();
      },
      async adminStoryQueue() {
        return S.stories.filter((x) => x.moderation_status === "pending")
          .map((x) => { const p = profileOf(x.user_id); return { ...x, username: p ? p.username : "unknown", avatar_url: p ? p.avatar_url : "" }; });
      },
      async adminDecideStory(adminId, storyId, decision) {
        const st = S.stories.find((x) => x.id === storyId); if (!st) throw new Error("Story not found.");
        st.moderation_status = decision === "approved" ? "approved" : "rejected";
        S.notifications.push({ id: uid(), user_id: st.user_id, type: "system", actor_id: null, video_id: null, is_read: false, created_at: now() });
        save(); return st;
      },
      async report(me, targetType, targetId, reason) {
        S.reports.push({ id: uid(), reporter_id: me, target_type: targetType, target_id: targetId, reason: String(reason).slice(0, 500), status: "open", created_at: now() });
        save();
      },
      async toggleBlock(me, userId) {
        const i = S.blocks.findIndex((b) => b.blocker_id === me && b.blocked_id === userId);
        if (i >= 0) { S.blocks.splice(i, 1); save(); return false; }
        S.blocks.push({ blocker_id: me, blocked_id: userId, created_at: now() });
        // blocking also unfollows both ways
        S.follows = S.follows.filter((f) => !(f.follower_id === me && f.following_id === userId) && !(f.follower_id === userId && f.following_id === me));
        save(); return true;
      },
      async blockedList(me) { return S.blocks.filter((b) => b.blocker_id === me).map((b) => { const pr = profileOf(b.blocked_id); return pr ? { ...pr, blocked_at: b.created_at || null } : null; }).filter(Boolean); },
      async notifications(me) {
        return S.notifications.filter((n) => n.user_id === me).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((n) => { const p = n.actor_id ? profileOf(n.actor_id) : null; return { ...n, actor_name: p ? p.username : "Tokisla", actor_avatar: p ? p.avatar_url : "" }; });
      },
      async markNotificationsRead(me) { S.notifications.forEach((n) => { if (n.user_id === me) n.is_read = true; }); save(); },
      async search(me, q) {
        q = String(q || "").trim().toLowerCase(); if (!q) return { users: [], videos: [] };
        const users = S.profiles.filter((p) => !p.is_suspended && (p.username.includes(q) || (p.display_name || "").toLowerCase().includes(q)));
        const videos = approvedVisible(me).filter((v) => v.caption.toLowerCase().includes(q)).map(pubVideo);
        return { users, videos };
      },
      /* --- admin (used by admin.html on the same origin in demo) --- */
      async adminQueue() {
        return S.videos.filter((v) => v.moderation_status === "pending" || v.moderation_status === "needs_review")
          .map((v) => ({ ...pubVideo(v), reports: S.reports.filter((r) => r.target_type === "video" && r.target_id === v.id && r.status === "open").length }));
      },
      async adminDecide(adminId, videoId, decision, reason) {
        const v = S.videos.find((x) => x.id === videoId); if (!v) throw new Error("Video not found.");
        v.moderation_status = decision;
        v.rejection_reason = decision === "rejected" ? (reason || "") : null;
        if (decision === "approved") v.published_at = now();
        S.reviews.push({ id: uid(), video_id: videoId, reviewer_id: adminId, decision, reason: reason || "", created_at: now() });
        S.notifications.push({ id: uid(), user_id: v.creator_id, type: "moderation", actor_id: null, video_id: videoId, is_read: false, created_at: now() });
        save(); return v;
      },
      async adminReports() { return S.reports.filter((r) => r.status === "open"); },
      async adminSetReportStatus(id, status) { const r = S.reports.find((x) => x.id === id); if (r) { r.status = status; save(); } },
      async adminStats() {
        return {
          users: S.profiles.length,
          approved: S.videos.filter((v) => v.moderation_status === "approved").length,
          pending: S.videos.filter((v) => v.moderation_status === "pending" || v.moderation_status === "needs_review").length,
          rejected: S.videos.filter((v) => v.moderation_status === "rejected").length,
          openReports: S.reports.filter((r) => r.status === "open").length,
        };
      },
      async deleteAccount(me) {
        S.profiles = S.profiles.filter((p) => p.id !== me);
        S.users = S.users.filter((u) => u.profile_id !== me);
        S.videos = S.videos.filter((v) => v.creator_id !== me);
        if (S.session === me) S.session = null;
        save();
      },
      /* --- extra admin helpers (admin.html) --- */
      async ensureDemoAdmin() {
        if (!S.users.some((u) => u.email === "admin@tokisla.app")) {
          const prof = { id: "u-admin", username: "tokisla_admin", display_name: "Tokisla Admin", bio: "", avatar_url: "", role: "admin", is_suspended: false, verified: true };
          S.profiles.push(prof);
          S.users.push({ id: prof.id, email: "admin@tokisla.app", password: "admin123", profile_id: prof.id });
          save();
        }
        return { email: "admin@tokisla.app", password: "admin123" };
      },
      async adminUsers() { return S.profiles.slice(); },
      async adminSetSuspended(userId, suspended) {
        const p = profileOf(userId); if (p) { p.is_suspended = !!suspended; save(); }
      },
      async adminReviews() {
        return S.reviews.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((r) => { const rp = r.reviewer_id ? profileOf(r.reviewer_id) : null; return { ...r, reviewer_name: rp ? rp.username : "admin" }; });
      },
      async adminCategories() { return S.categories.slice().sort((a, b) => a.sort_order - b.sort_order); },
      async adminAddCategory(name) {
        const next = Math.max(0, ...S.categories.map((c) => c.id)) + 1;
        const c = { id: next, name: String(name).slice(0, 60), slug: String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), sort_order: next, is_active: true };
        S.categories.push(c); save(); return c;
      },
      async adminToggleCategory(id) {
        const c = S.categories.find((x) => x.id === id); if (c) { c.is_active = !c.is_active; save(); return c.is_active; }
      },
    };
  }

  /* ------------------------------------------------------------ LIVE store */
  function makeLiveStore(sb) {
    // Implemented against supabase/migrations (views + RLS). First live run
    // happens on the owner's second account (SETUP_GUIDE checklist).
    const pub = (v) => v;
    const enrichLive = async (rows, me) => {
      const list = (rows || []).map(pub);
      try {
        const duetIds = [...new Set(list.filter((v) => v.duet_of).map((v) => v.duet_of))];
        if (duetIds.length) {
          const { data: srcs } = await sb.from("public_videos").select("*").in("id", duetIds);
          const byId = Object.fromEntries((srcs || []).map((x) => [x.id, x]));
          list.forEach((v) => { const s2 = v.duet_of && byId[v.duet_of]; if (s2) v.duet_source = { id: s2.id, storage_path: s2.storage_path, thumbnail_path: s2.thumbnail_path, creator_id: s2.creator_id, username: s2.username, display_name: s2.display_name }; });
        }
        const rcIds = [...new Set(list.filter((v) => v.reply_comment_id).map((v) => v.reply_comment_id))];
        if (rcIds.length) {
          const { data: cs } = await sb.from("comments").select("id, body, video_id").in("id", rcIds);
          const byId = Object.fromEntries((cs || []).map((x) => [x.id, x]));
          list.forEach((v) => { const c = v.reply_comment_id && byId[v.reply_comment_id]; if (c) v.reply_comment = { id: c.id, body: c.body, username: "", video_id: c.video_id }; });
        }
        const pollIds = list.filter((v) => v.poll).map((v) => v.id);
        if (pollIds.length) {
          const { data: votes } = await sb.from("poll_votes").select("video_id, user_id, choice").in("video_id", pollIds);
          list.forEach((v) => {
            if (!v.poll) return;
            const vs = (votes || []).filter((x) => x.video_id === v.id);
            const counts = [0, 0]; vs.forEach((x) => { counts[x.choice] = (counts[x.choice] || 0) + 1; });
            const mine = me ? vs.find((x) => x.user_id === me) : null;
            v.poll_state = { counts, total: vs.length, my: mine ? mine.choice : null };
          });
        }
      } catch (e) { /* enrichment is best-effort */ }
      return list;
    };
    return {
      mode: "live",
      async signUp(email, password, username) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error("Check your email to verify your account, then log in.");
        const { error: e2 } = await sb.from("profiles").insert({ id: data.user.id, username: String(username).toLowerCase(), display_name: username });
        if (e2) throw e2;
        return data.user;
      },
      async logIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return this.currentUser();
      },
      async logOut() { await sb.auth.signOut(); },
      async currentUser() {
        const { data } = await sb.auth.getUser();
        if (!data.user) return null;
        const { data: p } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
        return p;
      },
      async usernameAvailable(username) {
        const { data } = await sb.from("public_profiles").select("id").eq("username", String(username).toLowerCase()).maybeSingle();
        return !data;
      },
      async updateProfile(me, patch) {
        const clean = {};
        if (patch.username !== undefined) {
          const u = String(patch.username).trim().toLowerCase();
          if (!/^[a-z0-9_.]{3,24}$/.test(u)) throw new Error("Username: 3-24 chars, letters, numbers, dot or underscore.");
          clean.username = u;
        }
        if (patch.display_name !== undefined) clean.display_name = String(patch.display_name).slice(0, 60);
        if (patch.bio !== undefined) clean.bio = String(patch.bio).slice(0, 160);
        if (patch.website !== undefined) clean.website = String(patch.website).trim().slice(0, 200);
        if (patch.avatar_url !== undefined) clean.avatar_url = patch.avatar_url;
        const { data, error } = await sb.from("profiles").update(clean).eq("id", me).select().single();
        if (error) throw new Error(/unique|duplicate/i.test(error.message) ? "That username is taken." : error.message);
        return data;
      },
      async setPreferences(me, categoryIds) {
        const { error } = await sb.from("user_preferences").upsert({ user_id: me, category_ids: categoryIds });
        if (error) throw error;
      },
      async getPreferences(me) {
        const { data } = await sb.from("user_preferences").select("category_ids").eq("user_id", me).maybeSingle();
        return { category_ids: (data && data.category_ids) || [] };
      },
      async feed(me, kind) {
        let q = sb.from("public_videos").select("*").order("published_at", { ascending: false }).limit(30);
        if (kind === "following" && me) {
          const { data: fol } = await sb.from("follows").select("following_id").eq("follower_id", me);
          const ids = (fol || []).map((f) => f.following_id);
          if (!ids.length) return [];
          q = q.in("creator_id", ids);
        }
        const { data, error } = await q; if (error) throw error;
        return enrichLive(data || [], me);
      },
      async myVideos(me) {
        const { data, error } = await sb.from("videos").select("*").eq("creator_id", me).order("created_at", { ascending: false });
        if (error) throw error; return data;
      },
      async profileVideos(userId) {
        const { data, error } = await sb.from("public_videos").select("*").eq("creator_id", userId).order("published_at", { ascending: false });
        if (error) throw error; return data;
      },
      async getProfile(userId) {
        const { data } = await sb.from("public_profiles").select("*").eq("id", userId).maybeSingle();
        return data;
      },
      async socialCounts(userId) {
        const [f1, f2, v] = await Promise.all([
          sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId),
          sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
          sb.from("public_videos").select("*", { count: "exact", head: true }).eq("creator_id", userId),
        ]);
        return { followers: f1.count || 0, following: f2.count || 0, videos: v.count || 0 };
      },
      async isFollowing(me, userId) {
        const { data } = await sb.from("follows").select("follower_id").eq("follower_id", me).eq("following_id", userId).maybeSingle();
        return !!data;
      },
      async profileStats(userId, me) {
        const [fr, fg, fl] = await Promise.all([
          sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId),
          sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
          me ? sb.from("follows").select("follower_id").eq("follower_id", me).eq("following_id", userId).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        return { followers: fr.count || 0, following: fg.count || 0, is_following: !!(fl && fl.data) };
      },
      async toggleFollow(me, userId) {
        if (await this.isFollowing(me, userId)) { await sb.from("follows").delete().eq("follower_id", me).eq("following_id", userId); return false; }
        const { error } = await sb.from("follows").insert({ follower_id: me, following_id: userId });
        if (error) throw error; return true;
      },
      async likedIds(me) {
        const { data } = await sb.from("video_likes").select("video_id").eq("user_id", me);
        return new Set((data || []).map((x) => x.video_id));
      },
      async toggleLike(me, videoId) {
        const { data } = await sb.from("video_likes").select("video_id").eq("user_id", me).eq("video_id", videoId).maybeSingle();
        if (data) { await sb.from("video_likes").delete().eq("user_id", me).eq("video_id", videoId); return false; }
        const { data: v } = await sb.from("videos").select("creator_id").eq("id", videoId).single();
        if (v && v.creator_id !== me) {
          const lp = await this.getAllowPrefs(v.creator_id);
          if (lp.allow_like === "nobody") throw new Error("Likes are turned off for this video.");
          if (lp.allow_like === "followers") {
            const { data: f } = await sb.from("follows").select("follower_id").eq("follower_id", me).eq("following_id", v.creator_id).maybeSingle();
            if (!f) throw new Error("Only followers can like this video.");
          }
        }
        const { error } = await sb.from("video_likes").insert({ user_id: me, video_id: videoId });
        if (error) throw error; return true;
      },
      async savedIds(me) {
        const { data } = await sb.from("saved_videos").select("video_id").eq("user_id", me);
        return new Set((data || []).map((x) => x.video_id));
      },
      async toggleSave(me, videoId) {
        const { data } = await sb.from("saved_videos").select("video_id").eq("user_id", me).eq("video_id", videoId).maybeSingle();
        if (data) { await sb.from("saved_videos").delete().eq("user_id", me).eq("video_id", videoId); return false; }
        const { error } = await sb.from("saved_videos").insert({ user_id: me, video_id: videoId });
        if (error) throw error; return true;
      },
      async savedVideos(me) {
        const { data } = await sb.from("saved_videos").select("video_id").eq("user_id", me);
        const ids = (data || []).map((x) => x.video_id);
        if (!ids.length) return [];
        const { data: vids } = await sb.from("public_videos").select("*").in("id", ids);
        return vids || [];
      },
      async myPrivateVideos(me) {
        const { data } = await sb.from("videos").select("*").eq("creator_id", me).eq("visibility", "private").order("created_at", { ascending: false });
        return data || [];
      },
      async likedVideos(me) {
        const { data } = await sb.from("video_likes").select("video_id").eq("user_id", me);
        const ids = (data || []).map((x) => x.video_id);
        if (!ids.length) return [];
        const { data: vids } = await sb.from("public_videos").select("*").in("id", ids);
        return vids || [];
      },
      async recordView(videoId, me) {
        try { await sb.rpc("increment_video_view", { p_video_id: videoId }); } catch (e) {}
        if (me) { try { await sb.from("watch_history").upsert({ user_id: me, video_id: videoId, watched_at: new Date().toISOString() }, { onConflict: "user_id,video_id" }); } catch (e) {} }
      },
      async myWatchHistory(me) {
        const { data } = await sb.from("watch_history").select("*").eq("user_id", me).order("watched_at", { ascending: false }).limit(100);
        if (!data || !data.length) return [];
        const { data: vids } = await sb.from("public_videos").select("*").in("id", data.map((h) => h.video_id));
        const byId = Object.fromEntries((vids || []).map((v) => [v.id, v]));
        return data.map((h) => byId[h.video_id] ? { ...byId[h.video_id], watched_at: h.watched_at } : null).filter(Boolean);
      },
      async myComments(me) {
        const { data } = await sb.from("comments").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(100);
        if (!data || !data.length) return [];
        const { data: vids } = await sb.from("public_videos").select("id,caption,thumbnail_path,username").in("id", data.map((c) => c.video_id));
        const byId = Object.fromEntries((vids || []).map((v) => [v.id, v]));
        return data.map((c) => ({ ...c, video_caption: byId[c.video_id] ? byId[c.video_id].caption : "", video_thumbnail: byId[c.video_id] ? byId[c.video_id].thumbnail_path : "", video_creator: byId[c.video_id] ? byId[c.video_id].username : "" }));
      },
      async logEvent(me, type, detail) { try { await sb.from("account_events").insert({ user_id: me, type, detail: detail || "" }); } catch (e) {} },
      async myEvents(me) {
        const { data } = await sb.from("account_events").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(50);
        return (data || []).map((e) => ({ ...e, at: e.created_at }));
      },
      async creatorStats(me) {
        const { data } = await sb.from("videos").select("*").eq("creator_id", me).eq("moderation_status", "approved").order("view_count", { ascending: false });
        const { count } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", me);
        const vids = data || [];
        return { videos: vids, videoCount: vids.length,
          totalViews: vids.reduce((a, v) => a + (v.view_count || 0), 0),
          totalLikes: vids.reduce((a, v) => a + (v.like_count || 0), 0),
          totalComments: vids.reduce((a, v) => a + (v.comment_count || 0), 0),
          followers: count || 0 };
      },
      async trending() {
        const { data } = await sb.from("public_videos").select("*").order("like_count", { ascending: false }).limit(5);
        return data || [];
      },
      async accountDetails(me) {
        const { data } = await sb.from("profiles").select("*").eq("id", me).single();
        let email = "";
        try { const u = await sb.auth.getUser(); email = (u && u.data && u.data.user && u.data.user.email) || ""; } catch (e) {}
        return data ? { ...data, email } : null;
      },
      async setPrivateAccount(me, on) { await sb.from("profiles").update({ private_account: !!on }).eq("id", me); },
      async getAllowPrefs(userId) {
        const d = { allow_comment: "everyone", allow_mention: "everyone", allow_like: "everyone", allow_download: "everyone", view_follow_list: "everyone" };
        const { data } = await sb.from("user_preferences").select("allow_comment,allow_mention,allow_like,allow_download,view_follow_list").eq("user_id", userId).maybeSingle();
        return data ? { ...d, ...data } : d;
      },
      async setAllowPref(me, key, value) {
        await sb.from("user_preferences").upsert({ user_id: me, [key]: value }, { onConflict: "user_id" });
        return this.getAllowPrefs(me);
      },
      async followList(userId, kind) {
        const col = kind === "followers" ? "following_id" : "follower_id";
        const other = kind === "followers" ? "follower_id" : "following_id";
        const { data } = await sb.from("follows").select(other).eq(col, userId);
        const ids = (data || []).map((r) => r[other]);
        if (!ids.length) return [];
        const { data: ps } = await sb.from("public_profiles").select("*").in("id", ids);
        return ps || [];
      },
      async applyForVerification(me, info) {
        const tid = String((info && info.tid) || "").trim();
        if (tid.length < 6) throw new Error("Enter the payment Transaction ID (TID).");
        const { data: pending } = await sb.from("verification_requests").select("id").eq("user_id", me).eq("status", "pending").maybeSingle();
        if (pending) throw new Error("Your application is already under review.");
        const { data, error } = await sb.from("verification_requests").insert({ user_id: me, full_name: String(info.full_name || "").slice(0, 80), category: info.category || "Creator", note: String(info.note || "").slice(0, 300), payment_method: info.method || "JazzCash", payment_tid: tid }).select().single();
        if (error) throw error; return data;
      },
      async myVerification(me) {
        const { data } = await sb.from("verification_requests").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(1);
        return (data && data[0]) || null;
      },
      async adminVerifyRequests() {
        const { data } = await sb.from("verification_requests").select("*").eq("status", "pending").order("created_at", { ascending: true });
        if (!data || !data.length) return [];
        const { data: ps } = await sb.from("public_profiles").select("id,username,display_name").in("id", data.map((r) => r.user_id));
        const byId = Object.fromEntries((ps || []).map((x) => [x.id, x]));
        return data.map((r) => ({ ...r, username: byId[r.user_id] ? byId[r.user_id].username : "?", display_name: byId[r.user_id] ? byId[r.user_id].display_name : "", method: r.payment_method, tid: r.payment_tid }));
      },
      async adminDecideVerification(adminId, reqId, decision) {
        const status = decision === "approved" ? "approved" : "rejected";
        const { data, error } = await sb.from("verification_requests").update({ status, decided_at: new Date().toISOString(), decided_by: adminId }).eq("id", reqId).select().single();
        if (error) throw error;
        if (status === "approved") await sb.from("profiles").update({ verified: true }).eq("id", data.user_id);
        try { await sb.from("notifications").insert({ user_id: data.user_id, type: "system", actor_id: null, video_id: null }); } catch (e) {}
        return data;
      },
      async conversations(me) {
        const { data } = await sb.from("messages").select("*")
          .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
          .order("created_at", { ascending: true }).limit(300);
        const rows = data || [];
        const ids = [...new Set(rows.map((m) => (m.sender_id === me ? m.recipient_id : m.sender_id)))];
        if (!ids.length) return [];
        const { data: ps } = await sb.from("public_profiles").select("*").in("id", ids);
        const byId = Object.fromEntries((ps || []).map((x) => [x.id, x]));
        const byOther = new Map();
        rows.forEach((m) => {
          const other = m.sender_id === me ? m.recipient_id : m.sender_id;
          const cur = byOther.get(other) || { user: byId[other], last: m, unread: 0 };
          cur.last = m;
          if (m.recipient_id === me && !m.is_read) cur.unread += 1;
          byOther.set(other, cur);
        });
        return [...byOther.values()].filter((c) => c.user)
          .sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1));
      },
      async thread(me, otherId) {
        const { data } = await sb.from("messages").select("*")
          .or(`and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`)
          .order("created_at", { ascending: true }).limit(300);
        return data || [];
      },
      async sendMessage(me, otherId, body) {
        body = String(body || "").trim();
        if (!body) throw new Error("Write a message first.");
        if (body.length > 1000) throw new Error("Message is too long.");
        const { data, error } = await sb.from("messages").insert({ sender_id: me, recipient_id: otherId, body }).select().single();
        if (error) throw error; return data;
      },
      async markThreadRead(me, otherId) {
        await sb.from("messages").update({ is_read: true })
          .eq("recipient_id", me).eq("sender_id", otherId).eq("is_read", false);
      },
      async unreadMessages(me) {
        const { count } = await sb.from("messages").select("id", { count: "exact", head: true })
          .eq("recipient_id", me).eq("is_read", false);
        return count || 0;
      },
      async totalLikesReceived(userId) {
        const { data } = await sb.from("videos").select("like_count").eq("creator_id", userId);
        return (data || []).reduce((a, v) => a + (v.like_count || 0), 0);
      },
      async people(me) {
        let q = sb.from("public_profiles").select("*").limit(12);
        if (me) q = q.neq("id", me);
        const { data } = await q;
        return data || [];
      },
      async shareVideo(me, videoId, toUserId) {
        const { error } = await sb.from("notifications").insert({ user_id: toUserId, type: "share", actor_id: me, video_id: videoId });
        if (error) throw error;
        return true;
      },
      async comments(videoId, me) {
        let rows;
        const { data, error } = await sb.from("comments").select("*, profiles:profiles!comments_user_id_fkey(username, avatar_url)").eq("video_id", videoId).eq("moderation_status", "visible").order("is_pinned", { ascending: false }).order("created_at");
        if (error) { // fall back without the join if the FK name differs
          const { data: plain } = await sb.from("comments").select("*").eq("video_id", videoId).eq("moderation_status", "visible").order("created_at");
          rows = plain || [];
        } else {
          rows = (data || []).map((c) => ({ ...c, username: c.profiles ? c.profiles.username : "user", avatar_url: c.profiles ? c.profiles.avatar_url : "" }));
        }
        try {
          if (rows.length) {
            const ids = rows.map((c) => c.id);
            const [lk, rp] = await Promise.all([
              sb.from("comment_likes").select("comment_id, user_id").in("comment_id", ids),
              sb.from("videos").select("id, reply_comment_id").in("reply_comment_id", ids).eq("moderation_status", "approved"),
            ]);
            rows.forEach((c) => {
              const ls = (lk.data || []).filter((l) => l.comment_id === c.id);
              c.like_count = ls.length;
              c.liked_by_me = !!(me && ls.some((l) => l.user_id === me));
              const r = (rp.data || []).find((x) => x.reply_comment_id === c.id);
              c.reply_video_id = r ? r.id : null;
            });
          }
        } catch (e) { /* likes/replies are best-effort */ }
        return rows;
      },
      async toggleCommentLike(me, commentId) {
        const { data } = await sb.from("comment_likes").select("comment_id").eq("comment_id", commentId).eq("user_id", me).maybeSingle();
        if (data) await sb.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", me);
        else await sb.from("comment_likes").insert({ comment_id: commentId, user_id: me });
        const { count } = await sb.from("comment_likes").select("comment_id", { count: "exact", head: true }).eq("comment_id", commentId);
        return { liked: !data, count: count || 0 };
      },
      async pinComment(me, commentId) {
        const { data: c } = await sb.from("comments").select("is_pinned").eq("id", commentId).maybeSingle();
        const target = !(c && c.is_pinned);
        const { error } = await sb.rpc("set_comment_pin", { p_comment_id: commentId, p_pinned: target });
        if (error) throw new Error(error.message);
        return target;
      },
      async votePoll(me, videoId, choice) {
        choice = choice === 1 ? 1 : 0;
        const { error } = await sb.from("poll_votes").upsert({ video_id: videoId, user_id: me, choice }, { onConflict: "video_id,user_id" });
        if (error) throw error;
        const { data: votes } = await sb.from("poll_votes").select("user_id, choice").eq("video_id", videoId);
        const counts = [0, 0]; (votes || []).forEach((x) => { counts[x.choice] = (counts[x.choice] || 0) + 1; });
        const mine = (votes || []).find((x) => x.user_id === me);
        return { counts, total: (votes || []).length, my: mine ? mine.choice : null };
      },
      async addComment(me, videoId, body) {
        body = String(body || "").trim(); if (!body) throw new Error("Write a comment first.");
        const { data: v } = await sb.from("videos").select("creator_id").eq("id", videoId).single();
        if (v && v.creator_id !== me) {
          const pr = await this.getAllowPrefs(v.creator_id);
          if (pr.allow_comment === "nobody") throw new Error("Comments are turned off for this video.");
          if (pr.allow_comment === "followers") {
            const { data: f } = await sb.from("follows").select("follower_id").eq("follower_id", me).eq("following_id", v.creator_id).maybeSingle();
            if (!f) throw new Error("Only followers can comment on this video.");
          }
        }
        const { data, error } = await sb.from("comments").insert({ video_id: videoId, user_id: me, body: body.slice(0, 500) }).select().single();
        if (error) throw error;
        // @mentions (respecting mention settings; best-effort)
        try {
          const names = [...new Set((body.match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
          for (const name of names) {
            const { data: target } = await sb.from("public_profiles").select("id").eq("username", name).maybeSingle();
            if (!target || target.id === me || (v && target.id === v.creator_id)) continue;
            const mp = await this.getAllowPrefs(target.id);
            if (mp.allow_mention === "nobody") continue;
            if (mp.allow_mention === "followers") {
              const { data: f } = await sb.from("follows").select("follower_id").eq("follower_id", me).eq("following_id", target.id).maybeSingle();
              if (!f) continue;
            }
            await sb.from("notifications").insert({ user_id: target.id, type: "mention", actor_id: me, video_id: videoId });
          }
        } catch (e) {}
        return data;
      },
      async deleteComment(me, commentId) {
        const { error } = await sb.from("comments").delete().eq("id", commentId);
        if (error) throw error;
      },
      async submitVideo(me, meta) {
        // Live uploads must come through the create-upload Edge Function,
        // which verifies metadata server-side and returns the storage path.
        const { data, error } = await sb.functions.invoke("create-upload", { body: meta });
        if (error) throw new Error("Upload service not configured yet (create-upload function).");
        return data;
      },
      async report(me, targetType, targetId, reason) {
        const { error } = await sb.from("reports").insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason: String(reason).slice(0, 500) });
        if (error) throw error;
      },
      async toggleBlock(me, userId) {
        const { data } = await sb.from("blocked_users").select("blocked_id").eq("blocker_id", me).eq("blocked_id", userId).maybeSingle();
        if (data) { await sb.from("blocked_users").delete().eq("blocker_id", me).eq("blocked_id", userId); return false; }
        const { error } = await sb.from("blocked_users").insert({ blocker_id: me, blocked_id: userId });
        if (error) throw error; return true;
      },
      async blockedList(me) {
        const { data } = await sb.from("blocked_users").select("blocked_id,created_at").eq("blocker_id", me);
        const rows = data || [];
        if (!rows.length) return [];
        const { data: ps } = await sb.from("public_profiles").select("*").in("id", rows.map((x) => x.blocked_id));
        const at = Object.fromEntries(rows.map((x) => [x.blocked_id, x.created_at]));
        return (ps || []).map((pr) => ({ ...pr, blocked_at: at[pr.id] || null }));
      },
      async notifications(me) {
        const { data } = await sb.from("notifications").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(50);
        return data || [];
      },
      async markNotificationsRead(me) { await sb.from("notifications").update({ is_read: true }).eq("user_id", me); },
      async search(me, q) {
        q = String(q || "").trim(); if (!q) return { users: [], videos: [] };
        const [u, v] = await Promise.all([
          sb.from("public_profiles").select("*").ilike("username", "%" + q + "%").limit(20),
          sb.from("public_videos").select("*").ilike("caption", "%" + q + "%").limit(20),
        ]);
        return { users: u.data || [], videos: v.data || [] };
      },
      async myDrafts(me) {
        const { data } = await sb.from("videos").select("*").eq("creator_id", me).eq("moderation_status", "draft").order("created_at", { ascending: false });
        return data || [];
      },
      async publishDraft(me, videoId) {
        const { error } = await sb.rpc("publish_draft", { p_video_id: videoId });
        if (error) throw new Error(error.message);
        // Caption @mentions fire on publish (best-effort, same as addComment).
        try {
          const { data: v } = await sb.from("videos").select("caption").eq("id", videoId).single();
          const names = [...new Set((String((v && v.caption) || "").match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
          for (const name of names) {
            const { data: target } = await sb.from("public_profiles").select("id").eq("username", name).maybeSingle();
            if (!target || target.id === me) continue;
            await sb.from("notifications").insert({ user_id: target.id, type: "mention", actor_id: me, video_id: videoId });
          }
        } catch (e) {}
      },
      async deleteDraft(me, videoId) {
        const { error } = await sb.from("videos").delete().eq("id", videoId).eq("creator_id", me).eq("moderation_status", "draft");
        if (error) throw error;
      },
      async hashtagVideos(me, tag) {
        tag = String(tag || "").replace(/^#/, "").toLowerCase(); if (!tag) return [];
        const { data } = await sb.from("public_videos").select("*").ilike("caption", "%#" + tag + "%").limit(40);
        const rows = (data || []).filter((v) => (String(v.caption || "").match(/#([^\s#]+)/g) || [])
          .some((t) => t.slice(1).toLowerCase() === tag));
        return enrichLive(rows, me);
      },
      async trendingHashtags(me) {
        const { data } = await sb.from("public_videos").select("caption").limit(100);
        const counts = {};
        (data || []).forEach((v) => {
          (String(v.caption || "").match(/#([^\s#]+)/g) || []).forEach((t) => {
            const k = t.slice(1).toLowerCase(); counts[k] = (counts[k] || 0) + 1;
          });
        });
        return Object.entries(counts).map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count).slice(0, 12);
      },
      async profileByUsername(username) {
        const { data } = await sb.from("public_profiles").select("*").eq("username", String(username || "").toLowerCase()).maybeSingle();
        return data || null;
      },
      /* --- stories (24h, moderated before they show) --- */
      async submitStory(me, meta) {
        let path = meta.storage_path || "";
        if (meta.file) {
          const name = String(meta.file.name || "story");
          const ext = (name.split(".").pop() || (meta.media_type === "video" ? "mp4" : "jpg")).toLowerCase();
          path = me + "/" + uid() + "." + ext;
          const { error: upErr } = await sb.storage.from("stories").upload(path, meta.file, { contentType: meta.file.type || undefined });
          if (upErr) throw new Error(upErr.message);
        }
        const { data, error } = await sb.from("stories").insert({
          user_id: me, media_type: meta.media_type === "video" ? "video" : "image",
          storage_path: path, caption: String(meta.caption || "").slice(0, 200),
          duration_seconds: meta.duration_seconds || null,
        }).select().single();
        if (error) throw error;
        return data;
      },
      async storiesFeed(me) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data } = await sb.from("stories").select("*").eq("moderation_status", "approved").gt("created_at", since).order("created_at");
        const rows = data || [];
        const ids = [...new Set(rows.map((r) => r.user_id))];
        const { data: ps } = ids.length ? await sb.from("public_profiles").select("*").in("id", ids) : { data: [] };
        const profById = Object.fromEntries((ps || []).map((x) => [x.id, x]));
        let seen = [];
        if (me && rows.length) {
          const { data: vs } = await sb.from("story_views").select("story_id").eq("user_id", me).in("story_id", rows.map((r) => r.id));
          seen = (vs || []).map((x) => x.story_id);
        }
        const byUser = new Map();
        for (const r of rows) {
          let url = r.storage_path;
          try { const { data: su } = await sb.storage.from("stories").createSignedUrl(r.storage_path, 3600); if (su && su.signedUrl) url = su.signedUrl; } catch (e) {}
          if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user: profById[r.user_id] || { id: r.user_id, username: "unknown" }, stories: [], has_unseen: false });
          const g = byUser.get(r.user_id);
          g.stories.push({ ...r, storage_path: url });
          if (!seen.includes(r.id)) g.has_unseen = true;
        }
        return [...byUser.values()].sort((a, b) => (b.has_unseen ? 1 : 0) - (a.has_unseen ? 1 : 0));
      },
      async myStories(me) {
        const { data } = await sb.from("stories").select("*").eq("user_id", me).order("created_at", { ascending: false });
        return data || [];
      },
      async markStorySeen(me, storyId) {
        try { await sb.from("story_views").upsert({ story_id: storyId, user_id: me }); } catch (e) {}
      },
      async adminStoryQueue() {
        const { data } = await sb.from("stories").select("*").eq("moderation_status", "pending").order("created_at");
        const rows = data || [];
        const ids = [...new Set(rows.map((r) => r.user_id))];
        const { data: ps } = ids.length ? await sb.from("public_profiles").select("*").in("id", ids) : { data: [] };
        const profById = Object.fromEntries((ps || []).map((x) => [x.id, x]));
        return rows.map((r) => ({ ...r, username: profById[r.user_id] ? profById[r.user_id].username : "unknown", avatar_url: profById[r.user_id] ? profById[r.user_id].avatar_url : "" }));
      },
      async adminDecideStory(adminId, storyId, decision) {
        const { error } = await sb.from("stories").update({ moderation_status: decision === "approved" ? "approved" : "rejected" }).eq("id", storyId);
        if (error) throw error;
      },
      async adminQueue() {
        const { data } = await sb.from("videos").select("*").in("moderation_status", ["pending", "needs_review"]).order("created_at");
        return data || [];
      },
      async adminDecide(adminId, videoId, decision, reason) {
        const { error } = await sb.from("videos").update({ moderation_status: decision, rejection_reason: decision === "rejected" ? reason : null }).eq("id", videoId);
        if (error) throw error;
        await sb.from("moderation_reviews").insert({ video_id: videoId, reviewer_id: adminId, decision, reason: reason || null });
      },
      async adminReports() {
        const { data } = await sb.from("reports").select("*").eq("status", "open").order("created_at");
        return data || [];
      },
      async adminSetReportStatus(id, status) { await sb.from("reports").update({ status }).eq("id", id); },
      async adminStats() {
        const [u, a, p, r, rep] = await Promise.all([
          sb.from("profiles").select("*", { count: "exact", head: true }),
          sb.from("videos").select("*", { count: "exact", head: true }).eq("moderation_status", "approved"),
          sb.from("videos").select("*", { count: "exact", head: true }).in("moderation_status", ["pending", "needs_review"]),
          sb.from("videos").select("*", { count: "exact", head: true }).eq("moderation_status", "rejected"),
          sb.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
        ]);
        return { users: u.count || 0, approved: a.count || 0, pending: p.count || 0, rejected: r.count || 0, openReports: rep.count || 0 };
      },
      async deleteAccount(me) {
        const { error } = await sb.functions.invoke("delete-account", { body: {} });
        if (error) throw new Error("Account deletion runs through the delete-account function at connection time.");
      },
      async ensureDemoAdmin() { return null; }, // live mode: no demo admin exists
      async adminUsers() {
        const { data } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
        return data || [];
      },
      async adminSetSuspended(userId, suspended) {
        const { error } = await sb.from("profiles").update({ is_suspended: !!suspended }).eq("id", userId);
        if (error) throw error;
      },
      async adminReviews() {
        const { data } = await sb.from("moderation_reviews").select("*").order("created_at", { ascending: false }).limit(100);
        return data || [];
      },
      async adminCategories() {
        const { data } = await sb.from("categories").select("*").order("sort_order");
        return data || [];
      },
      async adminAddCategory(name) {
        const { data, error } = await sb.from("categories").insert({ name: String(name).slice(0, 60), slug: String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), sort_order: 999 }).select().single();
        if (error) throw error; return data;
      },
      async adminToggleCategory(id) {
        const { data } = await sb.from("categories").select("is_active").eq("id", id).single();
        const nextVal = !(data && data.is_active);
        const { error } = await sb.from("categories").update({ is_active: nextVal }).eq("id", id);
        if (error) throw error; return nextVal;
      },
    };
  }

  function createStore(storage, supabaseClient) {
    if (DEMO) return makeDemoStore(storage);
    return makeLiveStore(supabaseClient);
  }

  const api = { createStore, CATEGORIES, DEMO, CFG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.TokislaStore = api;
})(typeof window !== "undefined" ? window : globalThis);
