/* Tokisla data layer — dual mode, exactly like the owner's other projects.
 *
 * DEMO MODE (config keys empty): everything runs on localStorage with seeded
 * sample data so every flow can be tested end-to-end. Clearly badged in the UI.
 *
 * LIVE MODE: talks to Appwrite Cloud (schema in APPWRITE_SETUP.md /
 * schema.json). The app only ever uses the public endpoint + project ID
 * from config.js; privileged work runs inside Appwrite Functions holding
 * the API key server-side (never a secret key in the client).
 *
 * This file is DOM-free so it can be unit-tested in Node (tests/store.test.mjs).
 */
(function (global) {
  "use strict";

  const CFG = (global.TOKISLA_CONFIG || {
    APPWRITE_ENDPOINT: "", APPWRITE_PROJECT_ID: "",
    MAX_VIDEO_SECONDS: 20, MAX_VIDEO_MB: 15, APP_NAME: "Tokisla",
  });
  const DEMO = !CFG.APPWRITE_PROJECT_ID;

  /* Sounds library catalog (client-read; see store.listSounds / addSound).
   * Shape per entry: { id, title, category, duration_seconds, src, source }
   * where category is one of SOUND_CATEGORIES, src is a playable URL or a
   * media-bucket file id (live mode resolves it), and source is the
   * licence / rights note shown next to the sound.
   * The built-in catalog is DELIBERATELY EMPTY: no naat / taqreer audio
   * exists in the workspace and no copyrighted audio may be bundled or
   * invented. The library is populated by the owner AND by signed-in
   * users (direct-to-library, no approval — see addSound), plus
   * original sounds auto-registered when a video goes live with its
   * own sound (see registerOriginalSound in the demo store and the
   * create-upload function in live mode). Those entries persist in
   * demo mode (localStorage) and live in the media bucket in live mode. */
  const SOUNDS_CATALOG = [];
  /* Sounds catalog file loader (2026-11-03 fix-up pass).
   * Catalog file path (the ONE fixed path): "sounds-catalog.json",
   * at the app root next to index.html / store.js. The file holds a
   * JSON array of catalog entries shaped { id, title, category,
   * duration_seconds, src, source }; it ships EMPTY ([]) — no audio
   * is bundled or seeded from it, and nothing is ever downloaded,
   * copied, or seeded from any staging/research material. listSounds()
   * loads it lazily on first library open (the sounds sheet calls
   * listSounds), merges its entries with the empty inline catalog
   * above and with admin-added sounds, and dedupes by id. Any
   * failure — fetch unavailable, file absent (non-OK), or malformed
   * content — falls back SILENTLY to the empty inline catalog, so
   * demo mode and the honest empty states keep working exactly as
   * before. The loader never enforces the 20-second video limit: a
   * catalog entry's duration_seconds is display metadata only. An
   * explicit fetcher argument forces a reload (used by tests);
   * without one, the result is cached for the page lifetime. */
  const SOUNDS_CATALOG_PATH = "sounds-catalog.json";
  let soundsCatalogCache = null;
  function normalizeCatalogEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = String(entry.id || "").trim();
    const title = String(entry.title || "").trim().slice(0, 80);
    const category = String(entry.category || "").trim();
    const src = String(entry.src || "").trim();
    if (!id || !title || !src) return null;
    if (!SOUND_CATEGORIES.some(([slug]) => slug === category)) return null;
    const dur = Number(entry.duration_seconds);
    return { id, title, category,
      duration_seconds: Number.isFinite(dur) && dur >= 0 ? dur : null,
      src, source: typeof entry.source === "string" ? entry.source.trim().slice(0, 120) : "" };
  }
  function dedupeSounds(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((s) => {
      if (s && s.id && !seen.has(String(s.id))) { seen.add(String(s.id)); out.push({ ...s }); }
    });
    return out;
  }
  async function loadSoundsCatalogFrom(fetchFn) {
    try {
      if (typeof fetchFn !== "function") return [];
      const res = await fetchFn(SOUNDS_CATALOG_PATH);
      if (res && res.ok === false) return [];
      const data = Array.isArray(res) ? res : (res && typeof res.json === "function" ? await res.json() : null);
      if (!Array.isArray(data)) return [];
      return dedupeSounds(data.map(normalizeCatalogEntry).filter(Boolean));
    } catch (e) { return []; }
  }
  async function loadSoundsCatalog(fetcher) {
    if (fetcher) {
      soundsCatalogCache = await loadSoundsCatalogFrom(fetcher);
      return soundsCatalogCache.slice();
    }
    if (soundsCatalogCache !== null) return soundsCatalogCache.slice();
    const fetchFn = (typeof global.fetch === "function") ? global.fetch.bind(global) : null;
    soundsCatalogCache = await loadSoundsCatalogFrom(fetchFn);
    return soundsCatalogCache.slice();
  }
  const SOUND_CATEGORIES = [
    ["sound-effects", "Sound Effects"],
    ["naat", "Naat"],
    ["taqreer", "Taqreer"],
    ["islamic", "Islamic"],
  ];
  /* Original sounds are auto-only: category "original" is never a
   * user-pickable tab in addSound and never a catalog-file category
   * (normalizeCatalogEntry still rejects it). Original entries carry
   * source_type "original", a stable id "original-<videoId>", and
   * video_id, so catalog + rows + originals merge deduped by id. */
  const SOUND_ORIGINAL_CATEGORY = "original";

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
  const LS_KEY = "tokisla_demo_v6";

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
        duration_seconds: 12, size_bytes: 251045, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-2", creator_id: "u-owner", caption: "Walk with confidence #style",
        storage_provider: "demo", storage_path: "assets/user/user-2.mp4", thumbnail_path: "assets/user/user-2.jpg",
        duration_seconds: 16, size_bytes: 3553125, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16],
        poll: { question: "Confidence pehle, ya style?", options: ["Confidence", "Style"] } },
      { id: "v-user-3", creator_id: "u-owner", caption: "Claim #1 - top rank moment #gaming",
        storage_provider: "demo", storage_path: "assets/user/user-3.mp4", thumbnail_path: "assets/user/user-3.jpg",
        duration_seconds: 10, size_bytes: 2137709, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-4", creator_id: "u-owner", caption: "Before marriage - a sweet couple moment #family",
        storage_provider: "demo", storage_path: "assets/user/user-4.mp4", thumbnail_path: "assets/user/user-4.jpg",
        duration_seconds: 17, size_bytes: 1709499, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [15] },
      { id: "v-user-5", creator_id: "u-owner", caption: "Alag hi level ki mummy - clean comedy #funny",
        storage_provider: "demo", storage_path: "assets/user/user-5.mp4", thumbnail_path: "assets/user/user-5.jpg",
        duration_seconds: 15, size_bytes: 2324934, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [8] },
      { id: "v-user-6", creator_id: "u-owner", caption: "Urdu poetry - wafadari ki baat #poetry",
        storage_provider: "demo", storage_path: "assets/user/user-6.mp4", thumbnail_path: "assets/user/user-6.jpg",
        duration_seconds: 13, size_bytes: 422076, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [11] },
      { id: "v-user-7", creator_id: "u-owner", caption: "Hamesha khush rehna chahte ho - a gentle reminder #motivation",
        storage_provider: "demo", storage_path: "assets/user/user-7.mp4", thumbnail_path: "assets/user/user-7.jpg",
        duration_seconds: 20, size_bytes: 3874068, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [12] },
      { id: "v-user-8", creator_id: "u-owner", caption: "Smile more, worry less #positive",
        storage_provider: "demo", storage_path: "assets/user/user-8.mp4", thumbnail_path: "assets/user/user-8.jpg",
        duration_seconds: 10, size_bytes: 362319, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [20] },
      { id: "v-user-9", creator_id: "u-owner", caption: "Evening vibes - Quetta walk #style",
        storage_provider: "demo", storage_path: "assets/user/user-9.mp4", thumbnail_path: "assets/user/user-9.jpg",
        duration_seconds: 18, size_bytes: 3153041, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [16] },
      { id: "v-user-10", creator_id: "u-owner", caption: "Chota Don - Urdu poetry lines #poetry",
        storage_provider: "demo", storage_path: "assets/user/user-10.mp4", thumbnail_path: "assets/user/user-10.jpg",
        duration_seconds: 12, size_bytes: 361094, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [11] },
      // Check videos added 2026-11-05 at the owner's request ("ye sab videos
      // dalo"). Slots 11-25. Captions intentionally empty (never invented),
      // counts 0, no categories assigned. Slots 11, 12, 14, 15, 16, 17, 25
      // trimmed to 20s per his standing trim order; all other files copied
      // byte-identical; landscape/square natives kept as-is (landscape rule).
      { id: "v-user-11", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-11.mp4", thumbnail_path: "assets/user/user-11.jpg",
        duration_seconds: 20, size_bytes: 2464904, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-12", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-12.mp4", thumbnail_path: "assets/user/user-12.jpg",
        duration_seconds: 20, size_bytes: 1916568, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-13", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-13.mp4", thumbnail_path: "assets/user/user-13.jpg",
        duration_seconds: 18, size_bytes: 2778777, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-14", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-14.mp4", thumbnail_path: "assets/user/user-14.jpg",
        duration_seconds: 20, size_bytes: 1418622, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-15", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-15.mp4", thumbnail_path: "assets/user/user-15.jpg",
        duration_seconds: 20, size_bytes: 2167213, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-16", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-16.mp4", thumbnail_path: "assets/user/user-16.jpg",
        duration_seconds: 20, size_bytes: 4632752, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-17", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-17.mp4", thumbnail_path: "assets/user/user-17.jpg",
        duration_seconds: 20, size_bytes: 2741817, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-18", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-18.mp4", thumbnail_path: "assets/user/user-18.jpg",
        duration_seconds: 16, size_bytes: 3489033, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-19", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-19.mp4", thumbnail_path: "assets/user/user-19.jpg",
        duration_seconds: 9, size_bytes: 1975608, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-20", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-20.mp4", thumbnail_path: "assets/user/user-20.jpg",
        duration_seconds: 8, size_bytes: 1864889, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-21", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-21.mp4", thumbnail_path: "assets/user/user-21.jpg",
        duration_seconds: 17, size_bytes: 3847582, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-22", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-22.mp4", thumbnail_path: "assets/user/user-22.jpg",
        duration_seconds: 15, size_bytes: 3358628, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-23", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-23.mp4", thumbnail_path: "assets/user/user-23.jpg",
        duration_seconds: 14, size_bytes: 1001897, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-24", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-24.mp4", thumbnail_path: "assets/user/user-24.jpg",
        duration_seconds: 20, size_bytes: 4037183, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] },
      { id: "v-user-25", creator_id: "u-owner", caption: "",
        storage_provider: "demo", storage_path: "assets/user/user-25.mp4", thumbnail_path: "assets/user/user-25.jpg",
        duration_seconds: 20, size_bytes: 165077, visibility: "public", moderation_status: "approved",
        rejection_reason: null, published_at: now(), created_at: now(), like_count: 0, comment_count: 0, category_ids: [] }
    );
    return {
      profiles: creators, videos: vids, categories: CATEGORIES,
      follows: [], likes: seedLikes, saves: [], blocks: [], comments: [],
      reports: [], notifications: [], reviews: [],
      users: [], // demo auth accounts {id, email, password, profile_id}
      prefs: {}, session: null, watchHistory: [], accountEvents: [], verifyRequests: [], messages: [],
      commentLikes: [], pollVotes: [],
      sounds: [], // owner/admin-added sounds (see SOUNDS_CATALOG); built-in catalog is empty
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
    S.sounds = S.sounds || [];
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
    /* Original-sound auto-register (user decision 2026-11-03): when a
     * video goes live with NO library sound chosen, its own audio
     * becomes a library entry at once. Stable id "original-<videoId>",
     * deduped by video_id (never a second entry for the same video).
     * Videos already live before this change get nothing: this helper
     * only runs on the publish events below, never on load/seed. */
    const registerOriginalSound = (video) => {
      if (!video || video.sound_id) return null;
      if ((S.sounds || []).some((s) => s.video_id === video.id || s.id === "original-" + video.id)) return null;
      const creator = profileOf(video.creator_id);
      const username = creator && creator.username ? creator.username : "";
      const entry = { id: "original-" + video.id,
        title: username ? "Original sound — @" + username : "Original sound",
        category: SOUND_ORIGINAL_CATEGORY,
        duration_seconds: video.duration_seconds || null,
        src: video.storage_path || "", source: "Original audio",
        creator_id: video.creator_id || null, creator_username: username || null,
        source_type: "original", video_id: video.id, status: "live", report_count: 0,
        created_at: now() };
      S.sounds.push(entry);
      return entry;
    };

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
        if (chair) S.messages.push({ id: uid(), sender_id: chair.id, recipient_id: prof.id, body: "Assalamu alaikum! Welcome to Tokisla. Posts go live immediately. Videos that break the rules (music, women, haram content) are removed when reported, and strikes apply.", is_read: false, created_at: now() });
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
      async changePassword(newPassword, oldPassword) {
        /* Demo accounts are local records with stored passwords, so the
         * change is a genuine local update — same reality level as demo
         * logIn/updateProfile. The 8+ rule matches the auth-screen tick
         * and the live Appwrite requirement. */
        const u = S.users.find((x) => x.profile_id === S.session);
        if (!u) throw new Error("Not signed in.");
        if (u.password !== String(oldPassword)) throw new Error("Current password is incorrect.");
        if (String(newPassword).length < 8) throw new Error("New password must be at least 8 characters.");
        u.password = String(newPassword); save();
      },
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
            const sa = (((a.category_ids || []).some((c) => pref.has(c))) ? 2 : 0) + a.like_count / 100;
            const sb = (((b.category_ids || []).some((c) => pref.has(c))) ? 2 : 0) + b.like_count / 100;
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
        // NO pre-publication review: a posted video goes live at once with
        // the exact status the feed query uses ("approved"). category_ids
        // is deliberately NOT stored: the upload/post path carries no
        // categories (Discover keeps working off older rows, tolerating
        // videos that carry none). `location` is the optional free-text
        // place name, stored under exactly that field name.
        const location = String(meta.location || "").trim().slice(0, 256);
        const v = {
          id: uid(), creator_id: me, caption: String(meta.caption || "").slice(0, 300),
          storage_provider: "demo", storage_path: meta.storage_path || "",
          thumbnail_path: meta.thumbnail_path || "", duration_seconds: meta.duration_seconds,
          size_bytes: meta.size_bytes || null, visibility: meta.visibility || "public",
          moderation_status: isDraft ? "draft" : "approved", rejection_reason: null,
          published_at: isDraft ? null : now(), created_at: now(), like_count: 0, comment_count: 0,
          location: location || null,
          sound_id: meta.sound_id || null,
          sound_title: meta.sound_title ? String(meta.sound_title).slice(0, 80) : null,
          sound_category: meta.sound_category || null,
          trim_start_seconds: Number(meta.trim_start_seconds) || 0,
          trim_end_seconds: Number(meta.trim_end_seconds) || meta.duration_seconds,
          content_disclosure: meta.content_disclosure === true,
          link_url: meta.link_url ? String(meta.link_url).slice(0, 300) : null,
          filter: FILTERS.includes(meta.filter) ? meta.filter : "normal",
          poll, duet_of: meta.duet_of || null,
          reply_comment_id: meta.reply_comment_id || null, reply_video_id: replyVideoId,
        };
        S.videos.push(v);
        if (!isDraft) { notifyMentions(me, v.caption, v.id, [v.creator_id]); registerOriginalSound(v); }
        save(); return v;
      },
      /* --- sounds library (catalog + user-added + original sounds) ---
       * Direct-to-library (user decision 2026-11-03): ANY signed-in
       * user can add a sound; it goes live at once with status "live"
       * and no admin approval. Violations are removed via report +
       * strike. deleteSound marks a row status "removed" (row kept);
       * listSounds filters removed rows out. */
      async loadSoundsCatalog(fetcher) { return loadSoundsCatalog(fetcher); },
      async listSounds() {
        const catalog = await loadSoundsCatalog();
        const catalogSounds = SOUNDS_CATALOG.concat(catalog).map((s) => Object.assign(
          { creator_id: null, creator_username: null, video_id: null, report_count: 0, status: "live", source_type: "catalog" }, s,
          { source_type: s.source_type || "catalog", status: s.status || "live", report_count: Number(s.report_count) || 0 }));
        const rows = (S.sounds || [])
          .filter((s) => (s.status || "live") !== "removed")
          .map((s) => Object.assign(
            { creator_id: null, creator_username: null, video_id: null, report_count: 0, status: "live", source_type: "admin", created_at: null }, s,
            { source_type: s.source_type || "admin", status: s.status || "live", report_count: Number(s.report_count) || 0 }));
        return dedupeSounds(catalogSounds.concat(rows));
      },
      async addSound(me, input) {
        const prof = profileOf(me);
        if (!prof) throw new Error("Sign in to add a sound.");
        const title = String((input && input.title) || "").trim().slice(0, 80);
        const category = String((input && input.category) || "");
        if (!title) throw new Error("Give the sound a title.");
        if (!SOUND_CATEGORIES.some(([slug]) => slug === category)) throw new Error("Pick a sound category.");
        let src = String((input && input.src) || "").trim();
        if (input && input.file) {
          const blob = input.file;
          if (blob.size > 8 * 1024 * 1024) throw new Error("Audio file is too large for demo storage (max 8 MB).");
          src = await blobToDataUrl(blob);
        }
        if (!src) throw new Error("Choose an audio file for the sound.");
        const isStaff = prof.role === "admin" || prof.role === "moderator";
        const sound = { id: uid(), title, category,
          duration_seconds: Number((input && input.duration_seconds) || 0) || null,
          src, source: String((input && input.source) || "").trim().slice(0, 120) || (isStaff ? "Added by the owner" : "Added by @" + prof.username),
          creator_id: me, creator_username: prof.username,
          source_type: isStaff ? "admin" : "user", status: "live", report_count: 0,
          video_id: (input && input.video_id) || null, created_at: now() };
        S.sounds.push(sound); save(); return { ...sound };
      },
      async deleteSound(me, soundId) {
        const prof = profileOf(me);
        if (!prof || !(prof.role === "admin" || prof.role === "moderator")) throw new Error("Only the owner/admin can remove sounds.");
        const row = (S.sounds || []).find((s) => s.id === soundId);
        if (!row) throw new Error("Sound not found.");
        row.status = "removed"; save();
      },
      async reportSound(me, soundId, reason) {
        if (!me) throw new Error("Sign in to report a sound.");
        const clean = String(reason || "").trim().slice(0, 500);
        if (!clean) throw new Error("Give a reason for the report.");
        S.reports.push({ id: uid(), reporter_id: me, target_type: "sound", target_id: soundId, reason: clean, status: "open", created_at: now() });
        save();
      },
      async myDrafts(me) {
        return S.videos.filter((v) => v.creator_id === me && v.moderation_status === "draft")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(pubVideo);
      },
      async publishDraft(me, videoId) {
        const v = S.videos.find((x) => x.id === videoId);
        if (!v || v.creator_id !== me || v.moderation_status !== "draft") throw new Error("Draft not found.");
        // Drafts go live at once, same as a fresh post: "approved".
        v.moderation_status = "approved";
        v.published_at = now();
        notifyMentions(me, v.caption, v.id, [v.creator_id]);
        registerOriginalSound(v);
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
        if (decision === "approved") { v.published_at = now(); registerOriginalSound(v); }
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
  /* Live mode talks to Appwrite Cloud (see APPWRITE_SETUP.md + schema.json
   * for the collection/bucket/function layout). The client holds NO secret:
   * only the public endpoint + project ID from config.js. All privileged
   * work (moderation, profile creation, counters, cascades) runs inside
   * Appwrite Functions holding the API key server-side; the client only
   * ever calls them through Functions.createExecution. Document and file
   * permissions from the spec are attached on every create below.
   * Counters (like_count / comment_count / view_count) are NEVER written
   * by this file. This file stays DOM-free so it can be loaded in Node. */

  const APPWRITE_DB = "tokisla";
  /* Category slugs in the Appwrite seed (APPWRITE_SETUP.md §9 / schema.json)
   * differ from the regex slugs derived from names in the shared CATEGORIES
   * constant (e.g. seed "halal-funny" vs UI "halal-funny-videos", seed
   * "quran-recitation" vs UI "quran-and-recitation"). The database join
   * key is the SEED slug (spec J4); the UI keeps numeric ids. Translate
   * through this table (index = CATEGORIES order, sort_order 1-20). */
  const SPEC_CATEGORY_SLUGS = [
    "islamic-knowledge", "quran-recitation", "hadith-sunnah", "duas-reminders",
    "islamic-history-seerah", "islamic-motivation", "halal-funny", "clean-comedy",
    "educational", "science-gk", "life-lessons", "motivational-stories",
    "personal-development", "manners-character", "family-society",
    "positive-entertainment", "language-learning", "technology-skills",
    "halal-business", "health-lifestyle",
  ];
  const MEDIA_BUCKET = "media";
  const API_FUNCTION = "api";

  /* Minimal fallbacks matching the verified Appwrite Web SDK 29.2.0 string
   * shapes, used only when the caller did not supply the SDK namespace
   * (e.g. a Node test harness with a mocked TablesDB). In the browser the
   * real SDK namespace from the vendored script is always used instead. */
  const fallbackQuery = {
    equal: (attribute, values) => JSON.stringify({ method: "equal", attribute, values: Array.isArray(values) ? values : [values] }),
    notEqual: (attribute, values) => JSON.stringify({ method: "notEqual", attribute, values: Array.isArray(values) ? values : [values] }),
    greaterThan: (attribute, values) => JSON.stringify({ method: "greaterThan", attribute, values: Array.isArray(values) ? values : [values] }),
    lessThan: (attribute, values) => JSON.stringify({ method: "lessThan", attribute, values: Array.isArray(values) ? values : [values] }),
    search: (attribute, values) => JSON.stringify({ method: "search", attribute, values: Array.isArray(values) ? values : [values] }),
    orderAsc: (attribute) => JSON.stringify({ method: "orderAsc", attribute }),
    orderDesc: (attribute) => JSON.stringify({ method: "orderDesc", attribute }),
    limit: (value) => JSON.stringify({ method: "limit", values: [value] }),
    offset: (value) => JSON.stringify({ method: "offset", values: [value] }),
    or: (queries) => JSON.stringify({ method: "or", values: queries.map((q) => (typeof q === "string" ? JSON.parse(q) : q)) }),
    and: (queries) => JSON.stringify({ method: "and", values: queries.map((q) => (typeof q === "string" ? JSON.parse(q) : q)) }),
  };
  const fallbackPermission = {
    read: (role) => "read(\"" + role + "\")",
    update: (role) => "update(\"" + role + "\")",
    delete: (role) => "delete(\"" + role + "\")",
  };
  const fallbackRole = {
    any: () => "any",
    users: () => "users",
    user: (id) => "user:" + id,
    team: (id) => "team:" + id,
  };
  const fallbackId = {
    unique: () => uid(),
    custom: (id) => id,
  };

  function throwingService(name, methods) {
    const svc = {};
    methods.forEach((m) => {
      svc[m] = () => { throw new Error("Appwrite client was not provided to the live store (" + name + "." + m + ")."); };
    });
    return svc;
  }

  function resolveServices(input) {
    const sdk = (typeof global !== "undefined" && global.Appwrite) ? global.Appwrite : null;
    const Query = (input && input.Query) || (sdk && sdk.Query) || fallbackQuery;
    const Permission = (input && input.Permission) || (sdk && sdk.Permission) || fallbackPermission;
    const Role = (input && input.Role) || (sdk && sdk.Role) || fallbackRole;
    const ID = (input && input.ID) || (sdk && sdk.ID) || fallbackId;
    const bundle = input || {};
    /* A services bundle (built by app.js / admin.html from the SDK, or a
     * test mock) wins over constructing services from a raw Client. */
    const hasBundle = bundle.tables || bundle.tablesDB || bundle.account || bundle.storage || bundle.functions;
    if (hasBundle) {
      return {
        Query, Permission, Role, ID,
        account: bundle.account || throwingService("Account", ["create", "createEmailPasswordSession", "deleteSession", "get", "createRecovery", "updatePassword"]),
        tables: bundle.tables || bundle.tablesDB || throwingService("TablesDB", ["listRows", "createRow", "updateRow", "deleteRow", "getRow", "upsertRow"]),
        storage: bundle.storage || throwingService("Storage", ["createFile", "getFileView", "getFileDownload", "deleteFile"]),
        functions: bundle.functions || throwingService("Functions", ["createExecution"]),
      };
    }
    const client = bundle.client || (typeof bundle.call === "function" ? bundle : null) || null;
    const ns = bundle.sdk || sdk;
    if (client && ns) {
      return {
        Query, Permission, Role, ID,
        account: new ns.Account(client),
        tables: new ns.TablesDB(client),
        storage: new ns.Storage(client),
        functions: new ns.Functions(client),
      };
    }
    /* No usable client: every backend call throws a clear error instead of
     * crashing at construction time (demo mode never reaches here). */
    return {
      Query, Permission, Role, ID,
      account: throwingService("Account", ["create", "createEmailPasswordSession", "deleteSession", "get", "createRecovery", "updatePassword"]),
      tables: throwingService("TablesDB", ["listRows", "createRow", "updateRow", "deleteRow", "getRow", "upsertRow"]),
      storage: throwingService("Storage", ["createFile", "getFileView", "getFileDownload", "deleteFile"]),
      functions: throwingService("Functions", ["createExecution"]),
    };
  }

  function isNotFound(err) {
    if (!err) return false;
    return err.code === 404 || err.type === "document_not_found" || /not found|document.*not.*exist|row.*not.*exist/i.test(String(err.message || ""));
  }
  function isPermissionError(err) {
    if (!err) return false;
    const code = Number(err.code || err.status || err.statusCode);
    if (code === 401 || code === 403) return true;
    return /permission|forbidden|unauthori[sz]ed|not allowed|\b401\b|\b403\b/i.test(String(err.message || err.type || ""));
  }
  function isUnknownAttributeError(err) {
    if (!err) return false;
    return /unknown attribute|attribute.*does not exist|invalid attribute|no such attribute|attribute.*not found/i.test(errMessage(err));
  }
  function asError(err) {
    if (err instanceof Error) return err;
    return new Error((err && err.message) || "Request failed.");
  }
  function errMessage(err) {
    return (err && err.message) || "Request failed.";
  }
  /* Account already exists (409 / user_already_exists): the caller may
   * proceed as the existing account instead of surfacing a dead end. */
  function isAlreadyExistsError(err) {
    if (!err) return false;
    if (err.code === 409) return true;
    if (/already_exists/i.test(String(err.type || ""))) return true;
    return /already exists|duplicate|unique/i.test(errMessage(err));
  }
  /* A session is already active: Appwrite refuses to create another one
   * ("Creation of a session is prohibited when a session is active.").
   * Detected by message/type only — a bare 401 can also mean bad
   * credentials, which must NOT be treated as session-active. */
  function isSessionActiveError(err) {
    if (!err) return false;
    if (/session_already_exists|session.*active/i.test(String(err.type || ""))) return true;
    return /session is active|session already exists|prohibited when a session is active/i.test(errMessage(err));
  }

  function makeLiveStore(servicesOrClient) {
    const svc = resolveServices(servicesOrClient);
    const account = svc.account;
    const tables = svc.tables;
    const storage = svc.storage;
    const functionsSvc = svc.functions;
    const Q = svc.Query;
    const Perm = svc.Permission;
    const Role = svc.Role;
    const ID = svc.ID;

    const readAny = () => Perm.read(Role.any());
    const readUser = (id) => Perm.read(Role.user(id));
    const readTeam = () => Perm.read(Role.team("admins"));
    const updateUser = (id) => Perm.update(Role.user(id));
    const updateTeam = () => Perm.update(Role.team("admins"));
    const deleteUser = (id) => Perm.delete(Role.user(id));
    const deleteTeam = () => Perm.delete(Role.team("admins"));

    /* Row normalisation: $id -> id, $createdAt -> created_at,
     * $updatedAt -> updated_at; system fields are dropped. */
    const norm = (doc) => {
      if (!doc || typeof doc !== "object") return doc;
      const out = {};
      Object.keys(doc).forEach((k) => {
        if (k === "$permissions" || k === "$databaseId" || k === "$tableId" || k === "$sequence") return;
        if (k === "$id") out.id = doc[k];
        else if (k === "$createdAt") out.created_at = doc[k];
        else if (k === "$updatedAt") out.updated_at = doc[k];
        else out[k] = doc[k];
      });
      return out;
    };

    /* A stored file ID (flat, no slash, no scheme) becomes a plain
     * file-view URL the frozen renderers can use verbatim as <video>/<img>
     * src. Data URLs, http(s) URLs, relative asset paths and the demo
     * placeholders pass through untouched. */
    const looksLikeFileId = (v) => typeof v === "string" && v.length > 0 && v.length <= 36 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
    const fileViewUrl = (fileId) => {
      try {
        if (storage && typeof storage.getFileView === "function") {
          return storage.getFileView({ bucketId: MEDIA_BUCKET, fileId });
        }
      } catch (e) { /* fall through: keep the raw id */ }
      return fileId;
    };
    const playable = (value) => (looksLikeFileId(value) ? fileViewUrl(value) : value);
    const mapMediaFields = (row) => {
      if (row.storage_path !== undefined && looksLikeFileId(row.storage_path)) {
        row.storage_file_id = row.storage_path;
        row.storage_path = fileViewUrl(row.storage_path);
      }
      if (row.thumbnail_path !== undefined && looksLikeFileId(row.thumbnail_path)) {
        row.thumbnail_file_id = row.thumbnail_path;
        row.thumbnail_path = fileViewUrl(row.thumbnail_path);
      }
      return row;
    };
    /* Decomposed poll attributes -> the { question, options } shape the
     * frozen UI reads (v.poll.question / v.poll.options). */
    const mapVideo = (doc) => {
      const row = mapMediaFields(norm(doc));
      if (row.poll_question) {
        row.poll = { question: row.poll_question, options: [row.poll_option_a || "", row.poll_option_b || ""] };
      } else {
        row.poll = null;
      }
      return row;
    };
    const mapStory = (doc) => mapMediaFields(norm(doc));
    const mapRow = (doc) => norm(doc);

    async function listRows(table, queries, wantTotal) {
      const res = await tables.listRows({ databaseId: APPWRITE_DB, tableId: table, queries: queries || [], total: !!wantTotal });
      const rows = (res && res.rows) || (res && res.documents) || [];
      return { rows, total: res ? res.total : undefined };
    }
    async function listMapped(table, queries, mapper) {
      const { rows } = await listRows(table, queries || []);
      return rows.map(mapper || mapRow);
    }
    /* maybeSingle equivalent: first row or null, never throws on empty. */
    async function one(table, queries, mapper) {
      const { rows } = await listRows(table, (queries || []).concat([Q.limit(1)]));
      if (!rows.length) return null;
      return (mapper || mapRow)(rows[0]);
    }
    async function getOrNull(table, rowId, mapper) {
      try {
        const doc = await tables.getRow({ databaseId: APPWRITE_DB, tableId: table, rowId });
        return (mapper || mapRow)(doc);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    }
    async function getQuiet(table, rowId, mapper) {
      try { return await getOrNull(table, rowId, mapper); } catch (e) { return null; }
    }
    async function countRows(table, queries) {
      const { rows, total } = await listRows(table, (queries || []).concat([Q.limit(1)]), true);
      if (typeof total === "number") return total;
      return rows.length;
    }
    async function deleteRowLenient(table, rowId) {
      try { await tables.deleteRow({ databaseId: APPWRITE_DB, tableId: table, rowId }); } catch (e) { if (!isNotFound(e)) throw e; }
    }
    /* IN-style list: Query.equal(attribute, values) first; if the server
     * rejects the array form, fall back to the base query + JS filtering. */
    async function listIn(table, attribute, values, extraQueries, mapper) {
      const vals = values || [];
      if (!vals.length) return [];
      try {
        return await listMapped(table, (extraQueries || []).concat([Q.equal(attribute, vals), Q.limit(100)]), mapper);
      } catch (e) {
        const all = await listMapped(table, (extraQueries || []).concat([Q.limit(100)]), mapper);
        const keyOf = (r) => (attribute === "$id" ? r.id : r[attribute]);
        return all.filter((r) => vals.indexOf(keyOf(r)) !== -1);
      }
    }

    async function getPublicProfiles(ids) {
      const list = (ids || []).filter(Boolean);
      if (!list.length) return {};
      try {
        const rows = await listIn("public_profiles", "$id", list, [], mapRow);
        const byId = {};
        rows.forEach((r) => { byId[r.id] = r; });
        const missing = list.filter((id) => !byId[id]);
        for (const id of missing) {
          const oneRow = await getQuiet("public_profiles", id, mapRow);
          if (oneRow) byId[id] = oneRow;
        }
        return byId;
      } catch (e) {
        const byId = {};
        for (const id of list) {
          const oneRow = await getQuiet("public_profiles", id, mapRow);
          if (oneRow) byId[id] = oneRow;
        }
        return byId;
      }
    }
    const slugToCategoryId = (slug) => {
      const specIdx = SPEC_CATEGORY_SLUGS.indexOf(slug);
      if (specIdx !== -1) return specIdx + 1;
      const found = CATEGORIES.find((c) => c.slug === slug);
      return found ? found.id : null;
    };
    const categoryIdToSlug = (id) => {
      const n = Number(id);
      if (n >= 1 && n <= SPEC_CATEGORY_SLUGS.length) return SPEC_CATEGORY_SLUGS[n - 1];
      const found = CATEGORIES.find((c) => c.id === n);
      return found ? found.slug : null;
    };
    async function attachCategories(videos) {
      if (!videos.length) return videos;
      const ids = videos.map((v) => v.id);
      let links = [];
      try {
        links = await listIn("video_categories", "video_id", ids, [], mapRow);
      } catch (e) { links = []; }
      const byVideo = {};
      links.forEach((l) => {
        const num = slugToCategoryId(l.category_id);
        if (num === null) return;
        (byVideo[l.video_id] = byVideo[l.video_id] || []).push(num);
      });
      videos.forEach((v) => { v.category_ids = byVideo[v.id] || []; });
      return videos;
    }

    /* Public-video loader: the client-side reproduction of the old
     * public_videos view (spec §6.2). Base query (approved + public) +
     * profile join + post-filters in spec order (no public profile ->
     * drop; private-account rule; blocked rule) + category/poll mapping.
     * `viewerId` null means guest: private-account creators are dropped. */
    async function loadPublicVideos(opts) {
      const queries = (opts.queries || []).slice();
      const limit = opts.limit || 30;
      queries.push(Q.limit(limit));
      const { rows } = await listRows("videos", queries);
      let videos = rows.map(mapVideo);
      /* Deterministic published_at-desc with $createdAt fallback, as the
       * spec prescribes, when the caller asked for published ordering. */
      if (opts.publishedOrder) {
        videos.sort((a, b) => {
          const ka = a.published_at || a.created_at || "";
          const kb = b.published_at || b.created_at || "";
          return ka < kb ? 1 : ka > kb ? -1 : 0;
        });
      }
      const creatorIds = [...new Set(videos.map((v) => v.creator_id).filter(Boolean))];
      const profilesById = await getPublicProfiles(creatorIds);
      videos.forEach((v) => {
        const p = profilesById[v.creator_id];
        v.username = p ? p.username : "unknown";
        v.display_name = p ? p.display_name : "";
        v.avatar_url = p ? p.avatar_url : "";
        v.verified = !!(p && p.verified);
        v._profile = p || null;
      });
      /* Post-filter 1: no public profile (suspended creator) -> drop. */
      videos = videos.filter((v) => !!v._profile);
      /* Post-filter 2: private-account rule. */
      const privateOnes = videos.filter((v) => v._profile.private_account && v.creator_id !== opts.viewerId);
      if (privateOnes.length) {
        let allowed = new Set();
        if (opts.viewerId) {
          const privateIds = [...new Set(privateOnes.map((v) => v.creator_id))];
          try {
            const fols = await listIn("follows", "following_id", privateIds, [Q.equal("follower_id", opts.viewerId)], mapRow);
            allowed = new Set(fols.map((f) => f.following_id));
          } catch (e) { allowed = new Set(); }
        }
        videos = videos.filter((v) => !(v._profile.private_account && v.creator_id !== opts.viewerId && !allowed.has(v.creator_id)));
      }
      /* Post-filter 3: blocked rule (drop creators the viewer blocked). */
      if (opts.viewerId && videos.length) {
        try {
          const blocks = await listIn("blocked_users", "blocked_id", creatorIds, [Q.equal("blocker_id", opts.viewerId)], mapRow);
          const blocked = new Set(blocks.map((b) => b.blocked_id));
          if (blocked.size) videos = videos.filter((v) => !blocked.has(v.creator_id));
        } catch (e) { /* blocking filter is best-effort */ }
      }
      videos.forEach((v) => { delete v._profile; });
      if (opts.attachCategories) await attachCategories(videos);
      if (opts.slice) videos = videos.slice(0, opts.slice);
      return videos;
    }

    /* Function execution: bodies are always sent as JSON strings; the
     * response body is parsed back. A failed execution, an HTTP error
     * status, or an { error } payload all throw an Error. */
    async function execFunction(functionId, payload) {
      let execution;
      try {
        execution = await functionsSvc.createExecution({ functionId, body: JSON.stringify(payload || {}) });
      } catch (e) { throw asError(e); }
      const status = execution && execution.status;
      const httpStatus = execution && (execution.responseStatusCode || execution.response_status_code);
      let body = execution && (execution.responseBody !== undefined ? execution.responseBody : execution.response);
      if (typeof body === "string") {
        const trimmed = body.trim();
        if (trimmed) { try { body = JSON.parse(trimmed); } catch (e) { /* keep the raw string */ } }
        else body = null;
      }
      if (status === "failed" || (typeof httpStatus === "number" && httpStatus >= 400)) {
        const msg = (body && body.error) || (body && body.message) || ("Function " + functionId + " failed.");
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      if (body && typeof body === "object" && body.error) throw new Error(String(body.error));
      return body;
    }
    async function callApi(action, params) {
      return execFunction(API_FUNCTION, Object.assign({ action }, params || {}));
    }
    function extractPrefs(result) {
      /* callApi returns the { ok, data } envelope: the gate values live
       * in result.data. The direct-row and { prefs } shapes are kept
       * as fallbacks. */
      const src = (result && result.data) || (result && result.prefs) || result || {};
      const d = { allow_comment: "everyone", allow_mention: "everyone", allow_like: "everyone", allow_download: "everyone", view_follow_list: "everyone" };
      ["allow_comment", "allow_mention", "allow_like", "allow_download", "view_follow_list"].forEach((k) => {
        if (typeof src[k] === "string") d[k] = src[k];
      });
      return d;
    }

    /* Best-effort own-profile lookup (role only, for the sound
     * source_type label). Never throws: callers default to "user". */
    async function fetchMyProfile() {
      try {
        const u = await account.get();
        const uid2 = u && (u.$id || u.id);
        if (!uid2) return null;
        return await getOrNull("profiles", uid2, mapRow);
      } catch (e) { return null; }
    }

    /* Cross-user grants (a document carrying another user's read, or the
     * team's read) must be verified live (spec §5.10/§5.11/§5.19, risk R5).
     * Notifications and reports therefore try the direct create first and
     * fall back to the api function's notify / file-report actions, which
     * create the same document with the API key. Best-effort callers pass
     * { swallow: true } and never see either failure. */
    async function createNotification(data, permissions, opts) {
      const swallow = !!(opts && opts.swallow);
      try {
        await tables.createRow({ databaseId: APPWRITE_DB, tableId: "notifications", rowId: ID.unique(), data, permissions });
        return true;
      } catch (directErr) {
        try {
          await callApi("notify", { user_id: data.user_id, type: data.type, actor_id: data.actor_id || null, video_id: data.video_id || null, comment_id: data.comment_id || null });
          return true;
        } catch (fallbackErr) {
          if (swallow) return false;
          throw asError(directErr);
        }
      }
    }
    async function createReport(data, permissions) {
      try {
        await tables.createRow({ databaseId: APPWRITE_DB, tableId: "reports", rowId: ID.unique(), data, permissions });
        return true;
      } catch (directErr) {
        try {
          await callApi("file-report", { target_type: data.target_type, target_id: data.target_id, reason: data.reason });
          return true;
        } catch (fallbackErr) {
          throw asError(directErr);
        }
      }
    }

    const enrichLive = async (rows, me) => {
      const list = (rows || []).slice();
      try {
        const duetIds = [...new Set(list.filter((v) => v.duet_of).map((v) => v.duet_of))];
        if (duetIds.length) {
          let srcs = [];
          try {
            srcs = await loadPublicVideos({ queries: [Q.equal("$id", duetIds)], limit: duetIds.length, viewerId: me });
          } catch (e) {
            /* $id IN-query fallback: fetch duet sources one by one. */
            for (const id of duetIds) {
              const oneSrc = await getQuiet("videos", id, mapVideo);
              if (oneSrc) srcs.push(oneSrc);
            }
            const profById = await getPublicProfiles(srcs.map((s) => s.creator_id)).catch(() => ({}));
            srcs.forEach((s) => {
              const p = profById[s.creator_id];
              s.username = p ? p.username : "unknown";
              s.display_name = p ? p.display_name : "";
              s.avatar_url = p ? p.avatar_url : "";
              s.verified = !!(p && p.verified);
            });
          }
          const byId = Object.fromEntries(srcs.map((x) => [x.id, x]));
          list.forEach((v) => { const s2 = v.duet_of && byId[v.duet_of]; if (s2) v.duet_source = { id: s2.id, storage_path: s2.storage_path, thumbnail_path: s2.thumbnail_path, creator_id: s2.creator_id, username: s2.username, display_name: s2.display_name }; });
        }
        const rcIds = [...new Set(list.filter((v) => v.reply_comment_id).map((v) => v.reply_comment_id))];
        if (rcIds.length) {
          const cs = await listIn("comments", "$id", rcIds, [], mapRow);
          const byId = Object.fromEntries(cs.map((x) => [x.id, x]));
          list.forEach((v) => { const c = v.reply_comment_id && byId[v.reply_comment_id]; if (c) v.reply_comment = { id: c.id, body: c.body, username: "", video_id: c.video_id }; });
        }
        const pollIds = list.filter((v) => v.poll).map((v) => v.id);
        if (pollIds.length) {
          const votes = await listIn("poll_votes", "video_id", pollIds, [Q.limit(100)], mapRow);
          list.forEach((v) => {
            if (!v.poll) return;
            const vs = votes.filter((x) => x.video_id === v.id);
            const counts = [0, 0]; vs.forEach((x) => { counts[x.choice] = (counts[x.choice] || 0) + 1; });
            const mine = me ? vs.find((x) => x.user_id === me) : null;
            v.poll_state = { counts, total: vs.length, my: mine ? mine.choice : null };
          });
        }
      } catch (e) { /* enrichment is best-effort */ }
      return list;
    };
    /* Session hygiene for auth: a half-finished signup (account +
     * session created, profile creation failed) leaves a live session
     * behind, and Appwrite then refuses the next session creation.
     * clearStaleSession drops a pre-existing session before signup;
     * createSessionWithRetry deletes + retries exactly once when the
     * server reports a session already active. */
    async function clearStaleSession() {
      let active = false;
      try { const u = await account.get(); active = !!(u && (u.$id || u.id)); } catch (e) { active = false; }
      if (!active) return;
      try { await account.deleteSession({ sessionId: "current" }); } catch (e) { /* already gone */ }
    }
    async function dropCurrentSession() {
      try { await account.deleteSession({ sessionId: "current" }); } catch (e) { /* already gone */ }
    }
    async function createSessionWithRetry(email, password) {
      try {
        await account.createEmailPasswordSession({ email, password });
      } catch (e) {
        if (isSessionActiveError(e)) {
          await dropCurrentSession();
          await account.createEmailPasswordSession({ email, password });
        } else { throw e; }
      }
    }

    return {
      mode: "live",
      async signUp(email, password, username) {
        /* Account creation does not log the user in, so a session is
         * created explicitly and the profile is then created by the api
         * function (never by a direct client insert: the function forces
         * role="user" and validates the username — spec §5.1/J3).
         * A stale session from an earlier half-finished attempt is
         * cleared first, and an already-existing account proceeds to
         * session creation instead of erroring out. */
        await clearStaleSession();
        let created = null;
        try {
          created = await account.create({ userId: ID.unique(), email, password, name: String(username || "") });
        } catch (e) {
          if (!isAlreadyExistsError(e)) throw asError(e);
        }
        try {
          await createSessionWithRetry(email, password);
        } catch (e) {
          if (/verif/i.test(errMessage(e))) throw new Error("Check your email to verify your account, then log in.");
          throw asError(e);
        }
        const uname = String(username || "").toLowerCase();
        try {
          await callApi("create-profile", { username: uname, display_name: String(username || "") });
        } catch (e) { throw asError(e); }
        let authUser = created;
        if (!authUser) { try { authUser = await account.get(); } catch (e) { authUser = null; } }
        authUser = authUser || {};
        return { id: authUser.$id || authUser.id, email: authUser.email || email, name: authUser.name || String(username || "") };
      },
      async logIn(email, password) {
        try {
          await createSessionWithRetry(email, password);
        } catch (e) { throw asError(e); }
        return this.currentUser();
      },
      async logOut() {
        /* Idempotent: signing out with no session must not throw, or the
         * caller's reload/logout flow never runs. */
        try { await account.deleteSession({ sessionId: "current" }); } catch (e) { /* already signed out */ }
      },
      async changePassword(newPassword, oldPassword) {
        /* PATCH /account/password. The session stays valid — Appwrite
         * does not delete sessions on a password update. */
        try { await account.updatePassword({ password: newPassword, oldPassword }); }
        catch (e) { throw asError(e); }
      },
      async currentUser() {
        let authUser;
        try { authUser = await account.get(); } catch (e) { return null; }
        if (!authUser || !authUser.$id) return null;
        try {
          const p = await getOrNull("profiles", authUser.$id, mapRow);
          return p;
        } catch (e) { return null; }
      },
      async usernameAvailable(username) {
        /* Format first (same rule as demo): an invalid name is never
         * "available". A genuine empty result means available; any
         * query failure (database/table missing, network, permissions)
         * THROWS so the UI can say the check failed instead of lying
         * that every name is available. one() returns null on empty
         * and never throws for "no rows". */
        const u = String(username || "").trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,24}$/.test(u)) return false;
        const row = await one("public_profiles", [Q.equal("username", u)], mapRow);
        return !row;
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
        try {
          const doc = await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "profiles", rowId: me, data: clean });
          return mapRow(doc);
        } catch (e) {
          const msg = errMessage(e);
          throw new Error((e.code === 409 || /unique|duplicate|already exists/i.test(msg)) ? "That username is taken." : msg);
        }
      },
      async setPreferences(me, categoryIds) {
        /* Category IDs are numbers in the UI and slugs in the database
         * (spec J4). Translate at this boundary in both directions. */
        const slugs = (categoryIds || []).map((c) => (typeof c === "string" && CATEGORIES.some((x) => x.slug === c) ? c : categoryIdToSlug(c))).filter(Boolean);
        try {
          await tables.upsertRow({ databaseId: APPWRITE_DB, tableId: "user_preferences", rowId: ID.custom(me), data: { user_id: me, category_ids: slugs }, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
        } catch (e) { throw asError(e); }
      },
      async getPreferences(me) {
        const row = await one("user_preferences", [Q.equal("user_id", me)], mapRow).catch(() => null);
        const slugs = (row && row.category_ids) || [];
        const ids = slugs.map((s) => slugToCategoryId(s)).filter((n) => n !== null);
        return { category_ids: ids };
      },
      async feed(me, kind) {
        const queries = [Q.equal("moderation_status", "approved"), Q.equal("visibility", "public"), Q.orderDesc("published_at")];
        if (kind === "following" && me) {
          const fol = await listMapped("follows", [Q.equal("follower_id", me), Q.limit(100)], mapRow);
          const ids = fol.map((f) => f.following_id);
          if (!ids.length) return [];
          queries.push(Q.equal("creator_id", ids));
        }
        /* Over-fetch to 50, post-filter, then slice to 30 (spec §6.2). */
        const videos = await loadPublicVideos({ queries, limit: 50, viewerId: me || null, publishedOrder: true, attachCategories: true, slice: 30 });
        return enrichLive(videos, me);
      },
      async myVideos(me) {
        const rows = await listMapped("videos", [Q.equal("creator_id", me), Q.orderDesc("$createdAt"), Q.limit(100)], mapVideo);
        return rows;
      },
      async profileVideos(userId, me) {
        const videos = await loadPublicVideos({ queries: [Q.equal("creator_id", userId), Q.orderDesc("published_at")], limit: 100, viewerId: me || null, publishedOrder: true });
        return videos;
      },
      async getProfile(userId) {
        return getQuiet("public_profiles", userId, mapRow);
      },
      async socialCounts(userId) {
        const [f1, f2, v] = await Promise.all([
          countRows("follows", [Q.equal("following_id", userId)]),
          countRows("follows", [Q.equal("follower_id", userId)]),
          countRows("videos", [Q.equal("creator_id", userId), Q.equal("moderation_status", "approved"), Q.equal("visibility", "public")]),
        ]);
        return { followers: f1 || 0, following: f2 || 0, videos: v || 0 };
      },
      async isFollowing(me, userId) {
        const row = await one("follows", [Q.equal("follower_id", me), Q.equal("following_id", userId)], mapRow).catch(() => null);
        return !!row;
      },
      async profileStats(userId, me) {
        const [fr, fg, fl] = await Promise.all([
          countRows("follows", [Q.equal("following_id", userId)]),
          countRows("follows", [Q.equal("follower_id", userId)]),
          me ? one("follows", [Q.equal("follower_id", me), Q.equal("following_id", userId)], mapRow).catch(() => null) : Promise.resolve(null),
        ]);
        return { followers: fr || 0, following: fg || 0, is_following: !!fl };
      },
      async toggleFollow(me, userId) {
        if (me === userId) throw new Error("You cannot follow yourself.");
        const existing = await one("follows", [Q.equal("follower_id", me), Q.equal("following_id", userId)], mapRow).catch(() => null);
        if (existing) { await deleteRowLenient("follows", existing.id); return false; }
        try {
          await tables.createRow({ databaseId: APPWRITE_DB, tableId: "follows", rowId: ID.unique(), data: { follower_id: me, following_id: userId }, permissions: [readAny(), deleteUser(me)] });
        } catch (e) { throw asError(e); }
        return true;
      },
      async likedIds(me) {
        const rows = await listMapped("video_likes", [Q.equal("user_id", me), Q.limit(100)], mapRow);
        return new Set(rows.map((x) => x.video_id));
      },
      async toggleLike(me, videoId) {
        const existing = await one("video_likes", [Q.equal("user_id", me), Q.equal("video_id", videoId)], mapRow).catch(() => null);
        if (existing) { await deleteRowLenient("video_likes", existing.id); return false; }
        const v = await getQuiet("videos", videoId, mapRow);
        if (v && v.creator_id !== me) {
          const lp = await this.getAllowPrefs(v.creator_id);
          if (lp.allow_like === "nobody") throw new Error("Likes are turned off for this video.");
          if (lp.allow_like === "followers") {
            const f = await one("follows", [Q.equal("follower_id", me), Q.equal("following_id", v.creator_id)], mapRow).catch(() => null);
            if (!f) throw new Error("Only followers can like this video.");
          }
        }
        try {
          await tables.createRow({ databaseId: APPWRITE_DB, tableId: "video_likes", rowId: ID.unique(), data: { user_id: me, video_id: videoId }, permissions: [readAny(), deleteUser(me)] });
        } catch (e) { throw asError(e); }
        return true;
      },
      async savedIds(me) {
        const rows = await listMapped("saved_videos", [Q.equal("user_id", me), Q.limit(100)], mapRow);
        return new Set(rows.map((x) => x.video_id));
      },
      async toggleSave(me, videoId) {
        const existing = await one("saved_videos", [Q.equal("user_id", me), Q.equal("video_id", videoId)], mapRow).catch(() => null);
        if (existing) { await deleteRowLenient("saved_videos", existing.id); return false; }
        try {
          await tables.createRow({ databaseId: APPWRITE_DB, tableId: "saved_videos", rowId: ID.unique(), data: { user_id: me, video_id: videoId }, permissions: [readUser(me), deleteUser(me)] });
        } catch (e) { throw asError(e); }
        return true;
      },
      async savedVideos(me) {
        const rows = await listMapped("saved_videos", [Q.equal("user_id", me), Q.limit(100)], mapRow);
        const ids = rows.map((x) => x.video_id);
        if (!ids.length) return [];
        return loadPublicVideos({ queries: [Q.equal("$id", ids)], limit: ids.length, viewerId: me });
      },
      async myPrivateVideos(me) {
        return listMapped("videos", [Q.equal("creator_id", me), Q.equal("visibility", "private"), Q.orderDesc("$createdAt"), Q.limit(100)], mapVideo);
      },
      async likedVideos(me) {
        const rows = await listMapped("video_likes", [Q.equal("user_id", me), Q.limit(100)], mapRow);
        const ids = rows.map((x) => x.video_id);
        if (!ids.length) return [];
        return loadPublicVideos({ queries: [Q.equal("$id", ids)], limit: ids.length, viewerId: me });
      },
      async recordView(videoId, me) {
        /* Best-effort throughout: a failed view count must never break
         * playback. The function increments only approved videos. */
        try { await callApi("increment-view", { video_id: videoId }); } catch (e) {}
        if (me) {
          try {
            const existing = await one("watch_history", [Q.equal("user_id", me), Q.equal("video_id", videoId)], mapRow).catch(() => null);
            const watchedAt = new Date().toISOString();
            if (existing) {
              await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "watch_history", rowId: existing.id, data: { watched_at: watchedAt } });
            } else {
              try {
                await tables.createRow({ databaseId: APPWRITE_DB, tableId: "watch_history", rowId: ID.unique(), data: { user_id: me, video_id: videoId, watched_at: watchedAt }, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
              } catch (e) {
                /* 409 (unique index race) means the row exists now: update it. */
                if (e.code === 409 || /unique|duplicate|already exists/i.test(errMessage(e))) {
                  const retry = await one("watch_history", [Q.equal("user_id", me), Q.equal("video_id", videoId)], mapRow).catch(() => null);
                  if (retry) await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "watch_history", rowId: retry.id, data: { watched_at: watchedAt } });
                } else throw e;
              }
            }
          } catch (e) {}
        }
      },
      async myWatchHistory(me) {
        const hist = await listMapped("watch_history", [Q.equal("user_id", me), Q.orderDesc("watched_at"), Q.limit(100)], mapRow);
        if (!hist.length) return [];
        const vids = await loadPublicVideos({ queries: [Q.equal("$id", hist.map((h) => h.video_id))], limit: hist.length, viewerId: me });
        const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
        return hist.map((h) => (byId[h.video_id] ? Object.assign({}, byId[h.video_id], { watched_at: h.watched_at }) : null)).filter(Boolean);
      },
      async myComments(me) {
        const cs = await listMapped("comments", [Q.equal("user_id", me), Q.orderDesc("$createdAt"), Q.limit(100)], mapRow);
        if (!cs.length) return [];
        const vids = await loadPublicVideos({ queries: [Q.equal("$id", cs.map((c) => c.video_id))], limit: cs.length, viewerId: me });
        const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
        return cs.map((c) => Object.assign({}, c, { video_caption: byId[c.video_id] ? byId[c.video_id].caption : "", video_thumbnail: byId[c.video_id] ? byId[c.video_id].thumbnail_path : "", video_creator: byId[c.video_id] ? byId[c.video_id].username : "" }));
      },
      async logEvent(me, type, detail) { try { await tables.createRow({ databaseId: APPWRITE_DB, tableId: "account_events", rowId: ID.unique(), data: { user_id: me, type, detail: detail || "" }, permissions: [readUser(me)] }); } catch (e) {} },
      async myEvents(me) {
        const rows = await listMapped("account_events", [Q.equal("user_id", me), Q.orderDesc("$createdAt"), Q.limit(50)], mapRow);
        return rows.map((e) => Object.assign({}, e, { at: e.created_at }));
      },
      async creatorStats(me) {
        const vids = await listMapped("videos", [Q.equal("creator_id", me), Q.equal("moderation_status", "approved"), Q.orderDesc("view_count"), Q.limit(100)], mapVideo);
        const followers = await countRows("follows", [Q.equal("following_id", me)]);
        return { videos: vids, videoCount: vids.length,
          totalViews: vids.reduce((a, v) => a + (v.view_count || 0), 0),
          totalLikes: vids.reduce((a, v) => a + (v.like_count || 0), 0),
          totalComments: vids.reduce((a, v) => a + (v.comment_count || 0), 0),
          followers: followers || 0 };
      },
      async trending() {
        return loadPublicVideos({ queries: [Q.orderDesc("like_count")], limit: 5, viewerId: null });
      },
      async accountDetails(me) {
        const data = await getQuiet("profiles", me, mapRow);
        let email = "";
        try { const u = await account.get(); email = (u && u.email) || ""; } catch (e) {}
        return data ? Object.assign({}, data, { email }) : null;
      },
      async setPrivateAccount(me, on) {
        await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "profiles", rowId: me, data: { private_account: !!on } });
      },
      async getAllowPrefs(userId) {
        /* Preferences are owner-only, so another user's gates can only be
         * read through the api function (spec J10). Try the function
         * first; fall back to a direct read (own row), then to the
         * everyone defaults — a failed prefs read defaults open, as before. */
        try {
          const result = await callApi("check-allow-prefs", { user_id: userId });
          return extractPrefs(result);
        } catch (e) { /* fall through to direct read */ }
        try {
          const row = await one("user_preferences", [Q.equal("user_id", userId)], mapRow);
          if (row) return extractPrefs(row);
        } catch (e) { /* fall through to defaults */ }
        return extractPrefs(null);
      },
      async setAllowPref(me, key, value) {
        try {
          await tables.upsertRow({ databaseId: APPWRITE_DB, tableId: "user_preferences", rowId: ID.custom(me), data: { user_id: me, [key]: value }, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
        } catch (e) { throw asError(e); }
        return this.getAllowPrefs(me);
      },
      async followList(userId, kind) {
        const col = kind === "followers" ? "following_id" : "follower_id";
        const other = kind === "followers" ? "follower_id" : "following_id";
        const rows = await listMapped("follows", [Q.equal(col, userId), Q.limit(100)], mapRow);
        const ids = rows.map((r) => r[other]);
        if (!ids.length) return [];
        const byId = await getPublicProfiles(ids);
        return ids.map((id) => byId[id]).filter(Boolean);
      },
      async applyForVerification(me, info) {
        const tid = String((info && info.tid) || "").trim();
        if (tid.length < 6) throw new Error("Enter the payment Transaction ID (TID).");
        const pending = await one("verification_requests", [Q.equal("user_id", me), Q.equal("status", "pending")], mapRow).catch(() => null);
        if (pending) throw new Error("Your application is already under review.");
        const data = { user_id: me, full_name: String(info.full_name || "").slice(0, 80), category: info.category || "Creator", note: String(info.note || "").slice(0, 300), payment_method: info.method || "JazzCash", payment_tid: tid };
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "verification_requests", rowId: ID.unique(), data, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
          return mapRow(doc);
        } catch (e) { throw asError(e); }
      },
      async myVerification(me) {
        const rows = await listMapped("verification_requests", [Q.equal("user_id", me), Q.orderDesc("$createdAt"), Q.limit(1)], mapRow);
        return rows[0] || null;
      },
      async adminVerifyRequests() {
        const rows = await listMapped("verification_requests", [Q.equal("status", "pending"), Q.orderAsc("$createdAt"), Q.limit(100)], mapRow);
        if (!rows.length) return [];
        const byId = await getPublicProfiles(rows.map((r) => r.user_id));
        return rows.map((r) => Object.assign({}, r, { username: byId[r.user_id] ? byId[r.user_id].username : "?", display_name: byId[r.user_id] ? byId[r.user_id].display_name : "", method: r.payment_method, tid: r.payment_tid }));
      },
      async adminDecideVerification(adminId, reqId, decision) {
        const status = decision === "approved" ? "approved" : "rejected";
        try {
          await callApi("decide-verification", { request_id: reqId, decision: status });
        } catch (e) { throw asError(e); }
        const row = await getQuiet("verification_requests", reqId, mapRow);
        if (row) return row;
        return { id: reqId, status, decided_at: new Date().toISOString(), decided_by: adminId };
      },
      async conversations(me) {
        const rows = await listMapped("messages", [Q.or([Q.equal("sender_id", me), Q.equal("recipient_id", me)]), Q.orderAsc("$createdAt"), Q.limit(300)], mapRow);
        const ids = [...new Set(rows.map((m) => (m.sender_id === me ? m.recipient_id : m.sender_id)))];
        if (!ids.length) return [];
        const byId = await getPublicProfiles(ids);
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
        return listMapped("messages", [Q.or([Q.and([Q.equal("sender_id", me), Q.equal("recipient_id", otherId)]), Q.and([Q.equal("sender_id", otherId), Q.equal("recipient_id", me)])]), Q.orderAsc("$createdAt"), Q.limit(300)], mapRow);
      },
      async sendMessage(me, otherId, body) {
        body = String(body || "").trim();
        if (!body) throw new Error("Write a message first.");
        if (body.length > 1000) throw new Error("Message is too long.");
        if (me === otherId) throw new Error("You cannot message yourself.");
        /* Recipient read grant caveat (spec §5.19, risk R5): if the
         * direct create fails with a permission error (401/403), fall
         * back exactly once to the api `send-message` action, which
         * creates the same document with the API key. Any other direct
         * failure, or a failed fallback, surfaces as an error. */
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "messages", rowId: ID.unique(), data: { sender_id: me, recipient_id: otherId, body }, permissions: [readUser(me), readUser(otherId), updateUser(otherId)] });
          return mapRow(doc);
        } catch (directErr) {
          if (!isPermissionError(directErr)) throw asError(directErr);
          let fallbackResult;
          try {
            fallbackResult = await callApi("send-message", { recipient_id: otherId, body });
          } catch (fallbackErr) {
            throw asError(directErr);
          }
          const data = (fallbackResult && typeof fallbackResult === "object" && fallbackResult.data !== undefined) ? fallbackResult.data : fallbackResult;
          const doc = (data && data.message) || data;
          if (!doc || typeof doc !== "object" || !(doc.$id || doc.id)) throw asError(directErr);
          return mapRow(doc);
        }
      },
      async markThreadRead(me, otherId) {
        try {
          const rows = await listMapped("messages", [Q.equal("recipient_id", me), Q.equal("sender_id", otherId), Q.equal("is_read", false), Q.limit(100)], mapRow);
          for (const r of rows) {
            try { await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "messages", rowId: r.id, data: { is_read: true } }); } catch (e) {}
          }
        } catch (e) {}
      },
      async unreadMessages(me) {
        const n = await countRows("messages", [Q.equal("recipient_id", me), Q.equal("is_read", false)]);
        return n || 0;
      },
      async totalLikesReceived(userId) {
        const rows = await listMapped("videos", [Q.equal("creator_id", userId), Q.limit(100)], mapRow);
        return rows.reduce((a, v) => a + (v.like_count || 0), 0);
      },
      async people(me) {
        const queries = [Q.limit(12)];
        if (me) queries.push(Q.notEqual("$id", me));
        return listMapped("public_profiles", queries, mapRow);
      },
      async shareVideo(me, videoId, toUserId) {
        await createNotification({ user_id: toUserId, type: "share", actor_id: me, video_id: videoId }, [readUser(toUserId), updateUser(toUserId), deleteUser(toUserId)]);
        return true;
      },
      async comments(videoId, me) {
        /* No relationship-embed in listRows: comments first, authors joined
         * in JS (the pattern used everywhere else in this file). */
        let rows = await listMapped("comments", [Q.equal("video_id", videoId), Q.equal("moderation_status", "visible"), Q.orderDesc("is_pinned"), Q.orderAsc("$createdAt"), Q.limit(100)], mapRow);
        if (rows.length) {
          const byId = await getPublicProfiles(rows.map((c) => c.user_id));
          rows.forEach((c) => {
            const p = byId[c.user_id];
            c.username = p ? p.username : "user";
            c.avatar_url = p ? p.avatar_url : "";
          });
        }
        try {
          if (rows.length) {
            const ids = rows.map((c) => c.id);
            const [lk, rp] = await Promise.all([
              listIn("comment_likes", "comment_id", ids, [Q.limit(100)], mapRow).catch(() => []),
              listIn("videos", "reply_comment_id", ids, [Q.equal("moderation_status", "approved"), Q.limit(100)], mapRow).catch(() => []),
            ]);
            rows.forEach((c) => {
              const ls = lk.filter((l) => l.comment_id === c.id);
              c.like_count = ls.length;
              c.liked_by_me = !!(me && ls.some((l) => l.user_id === me));
              const r = rp.find((x) => x.reply_comment_id === c.id);
              c.reply_video_id = r ? r.id : null;
            });
          }
        } catch (e) { /* likes/replies are best-effort */ }
        return rows;
      },
      async toggleCommentLike(me, commentId) {
        const existing = await one("comment_likes", [Q.equal("comment_id", commentId), Q.equal("user_id", me)], mapRow).catch(() => null);
        if (existing) await deleteRowLenient("comment_likes", existing.id);
        else {
          try {
            await tables.createRow({ databaseId: APPWRITE_DB, tableId: "comment_likes", rowId: ID.unique(), data: { comment_id: commentId, user_id: me }, permissions: [readAny(), deleteUser(me)] });
          } catch (e) { throw asError(e); }
        }
        const count = await countRows("comment_likes", [Q.equal("comment_id", commentId)]);
        return { liked: !existing, count: count || 0 };
      },
      async pinComment(me, commentId) {
        const c = await getQuiet("comments", commentId, mapRow);
        const target = !(c && c.is_pinned);
        try {
          await callApi("set-comment-pin", { comment_id: commentId, pinned: target });
        } catch (e) { throw asError(e); }
        return target;
      },
      async votePoll(me, videoId, choice) {
        choice = choice === 1 ? 1 : 0;
        const existing = await one("poll_votes", [Q.equal("video_id", videoId), Q.equal("user_id", me)], mapRow).catch(() => null);
        try {
          if (existing) {
            await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "poll_votes", rowId: existing.id, data: { choice } });
          } else {
            try {
              await tables.createRow({ databaseId: APPWRITE_DB, tableId: "poll_votes", rowId: ID.unique(), data: { video_id: videoId, user_id: me, choice }, permissions: [readAny(), updateUser(me), deleteUser(me)] });
            } catch (e) {
              if (e.code === 409 || /unique|duplicate|already exists/i.test(errMessage(e))) {
                const retry = await one("poll_votes", [Q.equal("video_id", videoId), Q.equal("user_id", me)], mapRow).catch(() => null);
                if (retry) await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "poll_votes", rowId: retry.id, data: { choice } });
                else throw e;
              } else throw e;
            }
          }
        } catch (e) { throw asError(e); }
        const votes = await listMapped("poll_votes", [Q.equal("video_id", videoId), Q.limit(100)], mapRow);
        const counts = [0, 0]; votes.forEach((x) => { counts[x.choice] = (counts[x.choice] || 0) + 1; });
        const mine = votes.find((x) => x.user_id === me);
        return { counts, total: votes.length, my: mine ? mine.choice : null };
      },
      async addComment(me, videoId, body) {
        body = String(body || "").trim(); if (!body) throw new Error("Write a comment first.");
        const v = await getQuiet("videos", videoId, mapRow);
        if (v && v.creator_id !== me) {
          const pr = await this.getAllowPrefs(v.creator_id);
          if (pr.allow_comment === "nobody") throw new Error("Comments are turned off for this video.");
          if (pr.allow_comment === "followers") {
            const f = await one("follows", [Q.equal("follower_id", me), Q.equal("following_id", v.creator_id)], mapRow).catch(() => null);
            if (!f) throw new Error("Only followers can comment on this video.");
          }
        }
        let created;
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "comments", rowId: ID.unique(), data: { video_id: videoId, user_id: me, body: body.slice(0, 500) }, permissions: [readAny(), updateUser(me), deleteUser(me)] });
          created = mapRow(doc);
        } catch (e) { throw asError(e); }
        /* @mentions (respecting mention settings; best-effort). */
        try {
          const names = [...new Set((body.match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
          for (const name of names) {
            const target = await one("public_profiles", [Q.equal("username", name)], mapRow).catch(() => null);
            if (!target || target.id === me || (v && target.id === v.creator_id)) continue;
            const mp = await this.getAllowPrefs(target.id);
            if (mp.allow_mention === "nobody") continue;
            if (mp.allow_mention === "followers") {
              const f = await one("follows", [Q.equal("follower_id", me), Q.equal("following_id", target.id)], mapRow).catch(() => null);
              if (!f) continue;
            }
            await createNotification({ user_id: target.id, type: "mention", actor_id: me, video_id: videoId }, [readUser(target.id), updateUser(target.id), deleteUser(target.id)], { swallow: true });
          }
        } catch (e) {}
        return created;
      },
      async deleteComment(me, commentId) {
        try { await deleteRowLenient("comments", commentId); } catch (e) { throw asError(e); }
      },
      async submitVideo(me, meta) {
        /* Spec §8.3 inverted flow: the file bytes go to the media bucket
         * FIRST (owner + team file permissions), then create-upload
         * validates and creates the row. The upload UI hands this store
         * the File object as meta.file (app.js doSubmit); the file-first
         * branch below also runs when an already-uploaded file id is
         * supplied. The create-upload response envelope { ok, data } is
         * unwrapped here: the caller receives
         * { video, upload_url: null } (there is no upload_url in this
         * contract — the file is already uploaded), never the raw
         * envelope. Thumbnail data URLs are uploaded as files on this
         * same path, because a canvas data URL can exceed the 2048-char
         * thumbnail_path attribute (a short data URL is passed through
         * verbatim only when no file upload happens). */
        const m = meta || {};
        /* File-id aliases, mirroring the names create-upload accepts:
         * canonical fileId, file_id, and a bare-id storage_path. A
         * storage_path that is a data URL / external URL is not a file
         * id (it is the pre-upload placeholder) and is ignored here. */
        const isBareFileId = (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 64 && !v.trim().startsWith("data:") && !/^https?:\/\//i.test(v.trim()) && !v.includes("/") && !v.includes(" ");
        let fileId = m.fileId || m.file_id || (isBareFileId(m.storage_path) ? String(m.storage_path).trim() : null) || null;
        let thumbFileId = m.thumbnailFileId || m.thumbnail_file_id || (isBareFileId(m.thumbnail_path) ? String(m.thumbnail_path).trim() : null) || null;
        let thumbPath = m.thumbnail_path || "";
        try {
          /* Owner-only permissions here on purpose (spec §0: a user can
           * only grant a permission they hold — team:admins grants are
           * rejected for non-members). create-upload flips the file to
           * the full template server-side with the API key. */
          if (!fileId && m.file && storage && typeof storage.createFile === "function") {
            const uploaded = await storage.createFile({ bucketId: MEDIA_BUCKET, fileId: ID.unique(), file: m.file, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
            fileId = (uploaded && (uploaded.$id || uploaded.id)) || null;
          }
          if (!thumbFileId && typeof thumbPath === "string" && thumbPath.indexOf("data:") === 0) {
            const blob = dataUrlToBlob(thumbPath);
            if (blob && storage && typeof storage.createFile === "function") {
              const uploadedThumb = await storage.createFile({ bucketId: MEDIA_BUCKET, fileId: ID.unique(), file: blob, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
              thumbFileId = (uploadedThumb && (uploadedThumb.$id || uploadedThumb.id)) || null;
            }
          }
        } catch (e) {
          /* A failed pre-upload must not fall through to a row with no
           * file: surface the real upload error, not a generic string. */
          throw asError(e);
        }
        const payload = Object.assign({}, m);
        delete payload.file;
        delete payload.fileId;
        delete payload.file_id;
        delete payload.thumbnailFileId;
        delete payload.thumbnail_file_id;
        /* The upload/post path carries no categories: never send
         * category_ids to create-upload. `location` (optional string),
         * sound_*, trim_*, content_disclosure and link_url pass through
         * as extra fields; create-upload stores them on the video row. */
        delete payload.category_ids;
        /* Send the file ids under the canonical names create-upload
         * reads first (fileId / thumbnailFileId). When a file id is
         * present, drop the raw storage_path / thumbnail_path fields so
         * the function never sees the empty placeholder or the giant
         * thumbnail data URL alongside the id. When no file id exists,
         * the original fields pass through and create-upload returns
         * its own "fileId is required" error. */
        if (fileId) {
          payload.fileId = fileId;
          delete payload.storage_path;
        }
        if (thumbFileId) {
          payload.thumbnailFileId = thumbFileId;
          delete payload.thumbnail_path;
        }
        let result;
        try {
          result = await callApi("create-upload", payload);
        } catch (e) {
          throw asError(e);
        }
        /* Unwrap the { ok, data } envelope. Also accept the legacy
         * { video, upload_url } shape and a bare video document, so a
         * mock / older function response still works. */
        const shaped = (result && typeof result === "object" && result.data !== undefined) ? result.data : result;
        const videoDoc = (shaped && shaped.video) || shaped;
        if (videoDoc && (videoDoc.$id || videoDoc.id)) {
          return { video: mapVideo(videoDoc), upload_url: (shaped && shaped.upload_url) || null };
        }
        return result;
      },
      async report(me, targetType, targetId, reason) {
        const data = { reporter_id: me, target_type: targetType, target_id: targetId, reason: String(reason).slice(0, 500) };
        await createReport(data, [readUser(me), updateUser(me), deleteUser(me)]);
      },
      async reportSound(me, soundId, reason) {
        if (!me) throw new Error("Sign in to report a sound.");
        const clean = String(reason || "").trim().slice(0, 500);
        if (!clean) throw new Error("Give a reason for the report.");
        /* Same pattern as report(): direct `reports` row first, with
         * the api file-report action as fallback (createReport). The
         * reported sound stays visible until an admin removes it — no
         * auto-hide. The api file-report action accepts target_type
         * "sound" too (REPORT_TYPES), so the fallback files the
         * report server-side when the direct row write fails. */
        const data = { reporter_id: me, target_type: "sound", target_id: soundId, reason: clean };
        await createReport(data, [readUser(me), updateUser(me), deleteUser(me)]);
      },
      async toggleBlock(me, userId) {
        if (me === userId) throw new Error("You cannot block yourself.");
        const existing = await one("blocked_users", [Q.equal("blocker_id", me), Q.equal("blocked_id", userId)], mapRow).catch(() => null);
        if (existing) { await deleteRowLenient("blocked_users", existing.id); return false; }
        try {
          await tables.createRow({ databaseId: APPWRITE_DB, tableId: "blocked_users", rowId: ID.unique(), data: { blocker_id: me, blocked_id: userId }, permissions: [readUser(me), deleteUser(me)] });
        } catch (e) { throw asError(e); }
        return true;
      },
      async blockedList(me) {
        const rows = await listMapped("blocked_users", [Q.equal("blocker_id", me), Q.limit(100)], mapRow);
        if (!rows.length) return [];
        const byId = await getPublicProfiles(rows.map((x) => x.blocked_id));
        const at = Object.fromEntries(rows.map((x) => [x.blocked_id, x.created_at]));
        return rows.map((x) => byId[x.blocked_id]).filter(Boolean).map((pr) => Object.assign({}, pr, { blocked_at: at[pr.id] || null }));
      },
      async notifications(me) {
        return listMapped("notifications", [Q.equal("user_id", me), Q.orderDesc("$createdAt"), Q.limit(50)], mapRow);
      },
      async markNotificationsRead(me) {
        try {
          const rows = await listMapped("notifications", [Q.equal("user_id", me), Q.equal("is_read", false), Q.limit(100)], mapRow);
          for (const r of rows) {
            try { await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "notifications", rowId: r.id, data: { is_read: true } }); } catch (e) {}
          }
        } catch (e) {}
      },
      async search(me, q) {
        q = String(q || "").trim(); if (!q) return { users: [], videos: [] };
        const [users, videos] = await Promise.all([
          listMapped("public_profiles", [Q.search("username", q), Q.limit(20)], mapRow).catch(() => []),
          loadPublicVideos({ queries: [Q.search("caption", q)], limit: 20, viewerId: me || null }).catch(() => []),
        ]);
        return { users, videos };
      },
      /* --- sounds library (catalog + user-added + original sounds) ---
       * Live contract (to be backed by the `sounds` table + media bucket
       * per APPWRITE_SETUP.md): rows carry title, category,
       * duration_seconds, storage_path (media file id) and source, plus
       * — once the table gains them — creator_id, source_type, status,
       * report_count and video_id. Direct-to-library (2026-11-03):
       * any signed-in user can add a sound, live at once, no role
       * check in the client. deleteSound marks status "removed" via
       * updateRow and only falls back to deleteRow when the update is
       * impossible (e.g. the status attribute does not exist yet).
       * Original sounds are created server-side by create-upload /
       * publish-draft (NOT by this client: all live video creation
       * goes through those functions); their rows merge here like any
       * other row, deduped by the stable "original-<videoId>" id.
       * When the table does not exist yet, listSounds degrades to the
       * built-in catalog (empty) and addSound surfaces the real error
       * instead of pretending the sound was saved. */
      async loadSoundsCatalog(fetcher) { return loadSoundsCatalog(fetcher); },
      async listSounds() {
        let rows = [];
        try {
          rows = await listMapped("sounds", [Q.orderAsc("$createdAt"), Q.limit(100)], mapRow);
        } catch (e) { rows = []; }
        const mapped = rows.map((r) => {
          const out = { id: r.id, title: r.title, category: r.category,
            duration_seconds: r.duration_seconds || null,
            src: r.storage_path || r.src || "",
            source: r.source || "Added by the owner",
            creator_id: r.creator_id || null, creator_username: r.creator_username || null,
            source_type: r.source_type || "admin", status: r.status || "live",
            report_count: Number(r.report_count) || 0, video_id: r.video_id || null,
            created_at: r.created_at || null };
          if (looksLikeFileId(out.src)) out.src = fileViewUrl(out.src);
          return out;
        }).filter((s) => s.status !== "removed");
        /* Best-effort creator-name enrichment for rows that carry only
         * creator_id (server-created originals / legacy rows). A failed
         * lookup leaves the rows usable without a name. */
        try {
          const ids = [...new Set(mapped.filter((s) => s.creator_id && !s.creator_username).map((s) => s.creator_id))];
          if (ids.length) {
            const byId = await getPublicProfiles(ids);
            mapped.forEach((s) => { if (s.creator_id && !s.creator_username && byId[s.creator_id]) s.creator_username = byId[s.creator_id].username || null; });
          }
        } catch (e) { /* names are display-only */ }
        /* Catalog-file entries merge in front of collection rows and
         * resolve a media-bucket file id to a streaming view URL, the
         * same as collection rows; sounds are streamed for playback
         * only, never exposed as downloads in the UI. */
        const catalog = await loadSoundsCatalog();
        const fileCatalog = catalog.map((s) => {
          const out = Object.assign({ creator_id: null, creator_username: null, video_id: null, report_count: 0, status: "live", source_type: "catalog" }, s,
            { source_type: s.source_type || "catalog", status: s.status || "live", report_count: Number(s.report_count) || 0 });
          if (looksLikeFileId(out.src)) out.src = fileViewUrl(out.src);
          return out;
        });
        return dedupeSounds(SOUNDS_CATALOG.concat(fileCatalog, mapped));
      },
      async addSound(me, input) {
        if (!me) throw new Error("Sign in to add a sound.");
        const title = String((input && input.title) || "").trim().slice(0, 80);
        const category = String((input && input.category) || "");
        if (!title) throw new Error("Give the sound a title.");
        if (!SOUND_CATEGORIES.some(([slug]) => slug === category)) throw new Error("Pick a sound category.");
        let path = String((input && input.src) || "").trim();
        if (input && input.file) {
          const uploaded = await storage.createFile({ bucketId: MEDIA_BUCKET, fileId: ID.unique(), file: input.file, permissions: [readAny(), updateUser(me), deleteUser(me)] });
          path = (uploaded && (uploaded.$id || uploaded.id)) || "";
        }
        if (!path) throw new Error("Choose an audio file for the sound.");
        const source = String((input && input.source) || "").trim().slice(0, 120);
        const prof = await fetchMyProfile();
        const isStaff = !!(prof && (prof.role === "admin" || prof.role === "moderator"));
        const sourceType = isStaff ? "admin" : "user";
        const localMeta = { creator_id: me, creator_username: prof ? (prof.username || null) : null,
          source_type: sourceType, status: "live", report_count: 0,
          video_id: (input && input.video_id) || null,
          source: source || (isStaff ? "Added by the owner" : "Added by a user") };
        const legacyData = { title, category, duration_seconds: Number((input && input.duration_seconds) || 0) || null,
          storage_path: path, source: localMeta.source };
        const fullData = Object.assign({}, legacyData, { creator_id: me, source_type: sourceType, status: "live", report_count: 0 });
        if (localMeta.video_id) fullData.video_id = localMeta.video_id;
        let row = null;
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "sounds", rowId: ID.unique(),
            data: fullData, permissions: [readAny(), updateUser(me), deleteUser(me)] });
          row = mapRow(doc);
        } catch (e) {
          /* The sounds table as documented has only the 5 legacy
           * attributes: an unknown-attribute rejection means the new
           * fields are not in the table yet. Retry with the legacy
           * shape so the sound is still saved; the metadata above is
           * returned in-session. Any other failure surfaces as-is. */
          if (!isUnknownAttributeError(e)) throw asError(e);
          try {
            const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "sounds", rowId: ID.unique(),
              data: legacyData, permissions: [readAny(), updateUser(me), deleteUser(me)] });
            row = mapRow(doc);
          } catch (e2) { throw asError(e2); }
        }
        return { id: row.id, title: row.title, category: row.category, duration_seconds: row.duration_seconds || null,
          src: looksLikeFileId(row.storage_path) ? fileViewUrl(row.storage_path) : (row.storage_path || row.src || ""),
          source: row.source || localMeta.source,
          creator_id: row.creator_id || localMeta.creator_id, creator_username: row.creator_username || localMeta.creator_username,
          source_type: row.source_type || localMeta.source_type, status: row.status || "live",
          report_count: Number(row.report_count) || 0, video_id: row.video_id || localMeta.video_id,
          created_at: row.created_at || null };
      },
      async deleteSound(me, soundId) {
        try {
          await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "sounds", rowId: soundId, data: { status: "removed" } });
          return;
        } catch (updateErr) {
          /* Status-removed via update is the contract; row delete is
           * only the fallback when the update is impossible (status
           * attribute missing, or update not permitted by the mock /
           * permissions). If the delete also fails, surface the
           * original update error. */
          try { await tables.deleteRow({ databaseId: APPWRITE_DB, tableId: "sounds", rowId: soundId }); }
          catch (e) { throw asError(updateErr); }
        }
      },
      async myDrafts(me) {
        return listMapped("videos", [Q.equal("creator_id", me), Q.equal("moderation_status", "draft"), Q.orderDesc("$createdAt"), Q.limit(100)], mapVideo);
      },
      async publishDraft(me, videoId) {
        /* Drafts go live at once: the api publish-draft action must set
         * the live status ("approved") directly — no review queue. */
        try {
          await callApi("publish-draft", { video_id: videoId });
        } catch (e) { throw asError(e); }
        /* Caption @mentions fire on publish (best-effort, same as addComment). */
        try {
          const v = await getQuiet("videos", videoId, mapRow);
          const names = [...new Set((String((v && v.caption) || "").match(/@([a-z0-9_.]+)/gi) || []).map((x) => x.slice(1).toLowerCase()))];
          for (const name of names) {
            const target = await one("public_profiles", [Q.equal("username", name)], mapRow).catch(() => null);
            if (!target || target.id === me) continue;
            await createNotification({ user_id: target.id, type: "mention", actor_id: me, video_id: videoId }, [readUser(target.id), updateUser(target.id), deleteUser(target.id)], { swallow: true });
          }
        } catch (e) {}
      },
      async deleteDraft(me, videoId) {
        /* The old guarded delete (id + creator + draft) is a no-op when
         * the guards fail; the api delete-video action owns the cascade. */
        const row = await getQuiet("videos", videoId, mapRow);
        if (!row || row.creator_id !== me || row.moderation_status !== "draft") return;
        try {
          await callApi("delete-video", { video_id: videoId });
        } catch (e) { throw asError(e); }
      },
      async hashtagVideos(me, tag) {
        tag = String(tag || "").replace(/^#/, "").toLowerCase(); if (!tag) return [];
        /* Full-text search is word-based, not substring: the JS exact
         * filter below restores precision; recall depends on the search
         * index returning the row (see MIGRATION_NOTES.md). */
        const found = await loadPublicVideos({ queries: [Q.search("caption", "#" + tag)], limit: 40, viewerId: me || null }).catch(() => []);
        const rows = found.filter((v) => (String(v.caption || "").match(/#([^\s#]+)/g) || [])
          .some((t) => t.slice(1).toLowerCase() === tag));
        return enrichLive(rows, me);
      },
      async trendingHashtags(me) {
        const rows = await listMapped("videos", [Q.equal("moderation_status", "approved"), Q.equal("visibility", "public"), Q.orderDesc("$createdAt"), Q.limit(100)], mapRow);
        const counts = {};
        rows.forEach((v) => {
          (String(v.caption || "").match(/#([^\s#]+)/g) || []).forEach((t) => {
            const k = t.slice(1).toLowerCase(); counts[k] = (counts[k] || 0) + 1;
          });
        });
        return Object.entries(counts).map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count).slice(0, 12);
      },
      async profileByUsername(username) {
        const row = await one("public_profiles", [Q.equal("username", String(username || "").toLowerCase())], mapRow).catch(() => null);
        return row || null;
      },
      /* --- stories (24h, moderated before they show) --- */
      async submitStory(me, meta) {
        let path = meta.storage_path || "";
        if (meta.file) {
          try {
            const uploaded = await storage.createFile({ bucketId: MEDIA_BUCKET, fileId: ID.unique(), file: meta.file, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
            path = (uploaded && (uploaded.$id || uploaded.id)) || "";
          } catch (e) { throw asError(e); }
        }
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "stories", rowId: ID.unique(), data: {
            user_id: me, media_type: meta.media_type === "video" ? "video" : "image",
            storage_path: path, caption: String(meta.caption || "").slice(0, 200),
            duration_seconds: meta.duration_seconds || null,
          }, permissions: [readUser(me), updateUser(me), deleteUser(me)] });
          return mapStory(doc);
        } catch (e) { throw asError(e); }
      },
      async storiesFeed(me) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const rows = await listMapped("stories", [Q.equal("moderation_status", "approved"), Q.greaterThan("$createdAt", since), Q.orderAsc("$createdAt"), Q.limit(100)], mapStory);
        const ids = [...new Set(rows.map((r) => r.user_id))];
        const profById = await getPublicProfiles(ids);
        let seen = [];
        if (me && rows.length) {
          const vs = await listIn("story_views", "story_id", rows.map((r) => r.id), [Q.equal("user_id", me), Q.limit(100)], mapRow).catch(() => []);
          seen = vs.map((x) => x.story_id);
        }
        const byUser = new Map();
        for (const r of rows) {
          if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user: profById[r.user_id] || { id: r.user_id, username: "unknown" }, stories: [], has_unseen: false });
          const g = byUser.get(r.user_id);
          g.stories.push(r);
          if (!seen.includes(r.id)) g.has_unseen = true;
        }
        return [...byUser.values()].sort((a, b) => (b.has_unseen ? 1 : 0) - (a.has_unseen ? 1 : 0));
      },
      async myStories(me) {
        return listMapped("stories", [Q.equal("user_id", me), Q.orderDesc("$createdAt"), Q.limit(100)], mapStory);
      },
      async markStorySeen(me, storyId) {
        try {
          const existing = await one("story_views", [Q.equal("story_id", storyId), Q.equal("user_id", me)], mapRow).catch(() => null);
          if (!existing) {
            try {
              await tables.createRow({ databaseId: APPWRITE_DB, tableId: "story_views", rowId: ID.unique(), data: { story_id: storyId, user_id: me }, permissions: [readUser(me), deleteUser(me)] });
            } catch (e) { if (!(e.code === 409 || /unique|duplicate|already exists/i.test(errMessage(e)))) throw e; }
          }
        } catch (e) {}
      },
      async adminStoryQueue() {
        const rows = await listMapped("stories", [Q.equal("moderation_status", "pending"), Q.orderAsc("$createdAt"), Q.limit(100)], mapStory);
        const profById = await getPublicProfiles(rows.map((r) => r.user_id));
        return rows.map((r) => Object.assign({}, r, { username: profById[r.user_id] ? profById[r.user_id].username : "unknown", avatar_url: profById[r.user_id] ? profById[r.user_id].avatar_url : "" }));
      },
      async adminDecideStory(adminId, storyId, decision) {
        try {
          await callApi("moderate-story", { story_id: storyId, decision: decision === "approved" ? "approved" : "rejected" });
        } catch (e) { throw asError(e); }
      },
      async adminQueue() {
        const rows = await listMapped("videos", [Q.equal("moderation_status", ["pending", "needs_review"]), Q.orderAsc("$createdAt"), Q.limit(100)], mapVideo);
        const profById = await getPublicProfiles(rows.map((v) => v.creator_id));
        rows.forEach((v) => {
          const p = profById[v.creator_id];
          v.username = p ? p.username : v.creator_id;
          v.display_name = p ? p.display_name : "";
          v.avatar_url = p ? p.avatar_url : "";
          v.verified = !!(p && p.verified);
        });
        await attachCategories(rows);
        return rows;
      },
      async adminDecide(adminId, videoId, decision, reason) {
        /* The function writes the moderation_reviews row, sets
         * published_at on first approval, flips file permissions and
         * notifies the creator (spec §8). */
        try {
          await callApi("moderate-video", { video_id: videoId, decision, reason: reason || null });
        } catch (e) { throw asError(e); }
      },
      async adminReports() {
        return listMapped("reports", [Q.equal("status", "open"), Q.orderAsc("$createdAt"), Q.limit(100)], mapRow);
      },
      async adminSetReportStatus(id, status) {
        try {
          await callApi("decide-report", { report_id: id, status });
        } catch (e) { throw asError(e); }
      },
      async adminStats() {
        const [u, a, p, r, rep] = await Promise.all([
          countRows("profiles", []),
          countRows("videos", [Q.equal("moderation_status", "approved")]),
          countRows("videos", [Q.equal("moderation_status", ["pending", "needs_review"])]),
          countRows("videos", [Q.equal("moderation_status", "rejected")]),
          countRows("reports", [Q.equal("status", "open")]),
        ]);
        return { users: u || 0, approved: a || 0, pending: p || 0, rejected: r || 0, openReports: rep || 0 };
      },
      async deleteAccount(me) {
        try {
          await callApi("delete-account", {});
        } catch (e) {
          throw new Error("Account deletion runs through the delete-account function at connection time.");
        }
      },
      async ensureDemoAdmin() { return null; }, // live mode: no demo admin exists
      async adminUsers() {
        return listMapped("profiles", [Q.orderDesc("$createdAt"), Q.limit(100)], mapRow);
      },
      async adminSetSuspended(userId, suspended) {
        try {
          if (suspended) await callApi("suspend-user", { user_id: userId });
          else await callApi("unsuspend-user", { user_id: userId });
        } catch (e) { throw asError(e); }
      },
      async adminReviews() {
        return listMapped("moderation_reviews", [Q.orderDesc("$createdAt"), Q.limit(100)], mapRow);
      },
      async adminCategories() {
        return listMapped("categories", [Q.orderAsc("sort_order"), Q.limit(100)], mapRow);
      },
      async adminAddCategory(name) {
        const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        /* Document IDs cap at 36 chars; the slug attribute keeps the full
         * value, the row ID is the truncated slug when it would overflow. */
        const rowId = slug.slice(0, 36);
        try {
          const doc = await tables.createRow({ databaseId: APPWRITE_DB, tableId: "categories", rowId: ID.custom(rowId), data: { name: String(name).slice(0, 60), slug, sort_order: 999, is_active: true } });
          return mapRow(doc);
        } catch (e) { throw asError(e); }
      },
      async adminToggleCategory(id) {
        const data = await getOrNull("categories", id, mapRow);
        if (!data) throw new Error("Category not found.");
        const nextVal = !data.is_active;
        try {
          await tables.updateRow({ databaseId: APPWRITE_DB, tableId: "categories", rowId: id, data: { is_active: nextVal } });
        } catch (e) { throw asError(e); }
        return nextVal;
      },
    };
  }

  /* Blob/File -> data URL (demo sound storage), without DOM access. */
  async function blobToDataUrl(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const b64 = (typeof Buffer !== "undefined") ? Buffer.from(buf).toString("base64") : btoa(binary);
    return "data:" + (blob.type || "audio/mpeg") + ";base64," + b64;
  }

  /* Data-URL (canvas thumbnail) -> Blob, without any DOM access. Used
   * only by the live upload path; never called at module load time. */
  function dataUrlToBlob(dataUrl) {
    try {
      const comma = dataUrl.indexOf(",");
      if (comma === -1) return null;
      const header = dataUrl.slice(0, comma);
      const mimeMatch = /data:([^;]+)/.exec(header);
      const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const b64 = dataUrl.slice(comma + 1);
      const bin = (typeof atob === "function") ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (typeof Blob !== "undefined") return new Blob([bytes], { type: mime });
      return null;
    } catch (e) { return null; }
  }

  function createStore(storage, backendClient) {
    if (DEMO) return makeDemoStore(storage);
    return makeLiveStore(backendClient);
  }

  const api = { createStore, CATEGORIES, DEMO, CFG, SOUNDS_CATALOG, SOUND_CATEGORIES, SOUND_ORIGINAL_CATEGORY, SOUNDS_CATALOG_PATH, loadSoundsCatalog };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.TokislaStore = api;
})(typeof window !== "undefined" ? window : globalThis);
