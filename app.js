/* Tokisla app UI — talks ONLY to store.js (TokislaStore). No backend logic here. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const CFG = window.TOKISLA_CONFIG;
  const CATS = window.TokislaStore.CATEGORIES;
  const DEMO = window.TokislaStore.DEMO;

  let sb = null;
  if (!DEMO && window.supabase) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const store = window.TokislaStore.createStore(window.localStorage, sb);

  let me = null;           // my profile (null = guest)
  let feedKind = "foryou";
  let likedSet = new Set(), savedSet = new Set();
  let commentVideoId = null;
  let sessionUploads = {}; // demo: videoId -> object URL (plays this session only)
  let observer = null;


  /* ---------------- language + display ----------------
     English is the source language; Urdu switches the main chrome (nav,
     headings, profile and settings labels) and flips the layout to RTL.
     Display theme (light/dark) restyles the light surfaces; the video
     feed itself is always black, like other short-video apps. */
  const I18N = {
    en: { nav_home: "Home", nav_friends: "Friends", nav_discover: "Discover", nav_create: "Create", nav_alerts: "Alerts", nav_profile: "Profile",
      feed_following: "Following", feed_foryou: "For You", discover_title: "Discover", search_ph: "Search videos, creators, #hashtags",
      create_title: "Create", notif_title: "Notifications", friends_title: "Friends",
      prof_edit: "Edit profile", prof_follow: "Follow", prof_following: "Following", stat_followers: "Followers", stat_following: "Following", stat_likes: "Likes",
      tab_videos: "My videos", tab_saved: "Saved", tab_liked: "Liked", tab_locked: "Locked",
      set_title: "Settings and privacy", set_studio: "Tokisla Studio · Analytics", set_activity: "Activity center", set_account: "Account",
      set_share: "Share profile", set_private: "Private account", set_blocked: "Blocked accounts", set_guidelines: "Community Guidelines",
      set_terms: "Terms of Service", set_privacy: "Privacy Policy", set_delete: "Delete my account", set_logout: "Log out",
      set_display: "Display", set_language: "Language", disp_dark: "Dark", disp_light: "Light",
      allow_title: "Allow", allow_comments: "Who can comment", allow_mentions: "Who can mention you", allow_likes: "Who can like your videos",
      allow_downloads: "Who can download your videos", allow_followlist: "Who can view your follow lists" },
    ur: { nav_home: "ہوم", nav_friends: "دوست", nav_discover: "دریافت", nav_create: "بنائیں", nav_alerts: "اطلاعات", nav_profile: "پروفائل",
      feed_following: "فالو کیے گئے", feed_foryou: "آپ کے لیے", discover_title: "دریافت کریں", search_ph: "ویڈیوز، صارفین، #ٹیگز تلاش کریں",
      create_title: "ویڈیو بنائیں", notif_title: "اطلاعات", friends_title: "دوست",
      prof_edit: "پروفائل میں ترمیم", prof_follow: "فالو کریں", prof_following: "فالو کیا ہوا", stat_followers: "فالوورز", stat_following: "فالو کیے گئے", stat_likes: "پسند",
      tab_videos: "میری ویڈیوز", tab_saved: "محفوظ", tab_liked: "پسندیدہ", tab_locked: "نجی",
      set_title: "ترتیبات اور رازداری", set_studio: "ٹوکسلا اسٹوڈیو · اعداد و شمار", set_activity: "سرگرمی مرکز", set_account: "اکاؤنٹ",
      set_share: "پروفائل شیئر کریں", set_private: "نجی اکاؤنٹ", set_blocked: "مسدود اکاؤنٹس", set_guidelines: "کمیونٹی رہنما اصول",
      set_terms: "سروس کی شرائط", set_privacy: "رازداری کی پالیسی", set_delete: "میرا اکاؤنٹ حذف کریں", set_logout: "لاگ آؤٹ",
      set_display: "ڈسپلے", set_language: "زبان", disp_dark: "گہرا (ڈارک)", disp_light: "روشن (لائٹ)",
      allow_title: "اجازت", allow_comments: "کون تبصرہ کر سکتا ہے", allow_mentions: "کون آپ کا ذکر کر سکتا ہے", allow_likes: "کون آپ کی ویڈیوز پسند کر سکتا ہے",
      allow_downloads: "کون آپ کی ویڈیوز ڈاؤن لوڈ کر سکتا ہے", allow_followlist: "کون آپ کی فالو فہرست دیکھ سکتا ہے" },
  };
  let lang = "en";
  try { lang = localStorage.getItem("tokisla_lang") || "en"; } catch (e) {}
  if (!I18N[lang]) lang = "en";
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  function applyLanguage() {
    document.documentElement.lang = lang === "ur" ? "ur" : "en";
    document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    const fy = $("#feedForYouBtn"), fl = $("#feedFollowingBtn");
    if (fy) fy.textContent = t("feed_foryou");
    if (fl) fl.textContent = t("feed_following");
  }
  function applyTheme() {
    let th = "light";
    try { th = localStorage.getItem("tokisla_theme") || "dark"; } catch (e) {}
    document.documentElement.dataset.theme = th;
  }
  const safeUrl = (u) => { const x = String(u || "").trim(); if (!x) return ""; return /^https?:\/\//i.test(x) ? x : "https://" + x.replace(/^\/+/, ""); };
  const prettyUrl = (u) => String(u || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const fmtWhen = (x) => { try { return new Date(x).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; } };
  const fmtWhenTime = (x) => { try { return new Date(x).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
  const searchHistKey = () => "tokisla_searches_" + (me ? me.id : "guest");
  function pushSearch(q) {
    if (!me || !q) return;
    try {
      let a = JSON.parse(localStorage.getItem(searchHistKey()) || "[]");
      a = a.filter((x) => x.q !== q);
      a.unshift({ q, at: new Date().toISOString() });
      localStorage.setItem(searchHistKey(), JSON.stringify(a.slice(0, 20)));
    } catch (e) {}
  }
  function getSearchHist() { try { return JSON.parse(localStorage.getItem(searchHistKey()) || "[]"); } catch (e) { return []; } }

  /* ------------------------------------------------------------ utilities */
  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms || 2600);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmt(n) { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k"; return String(n); }
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d";
  }
  function initials(name) { return String(name || "?").replace(/^@/, "").slice(0, 2).toUpperCase(); }
  function avatarHtml(p, cls) {
    if (p && p.avatar_url) return `<img class="${cls || ""}" src="${esc(p.avatar_url)}" alt="">`;
    return `<span class="${cls || ""} avatar-fallback" style="display:inline-flex;align-items:center;justify-content:center;background:var(--emerald);color:#fff;font-weight:700">${esc(initials(p ? (p.display_name || p.username) : "?"))}</span>`;
  }
  function needLogin() {
    if (me) return false;
    toast("Please log in to do that.");
    showAuth();
    return true;
  }
  function showSheet(id) { $("#sheetBackdrop").classList.remove("hidden"); $(id).classList.remove("hidden"); }
  function hideSheets() { $("#sheetBackdrop").classList.add("hidden"); $$(".sheet").forEach((s) => s.classList.add("hidden")); }
  function openActionSheet(title, html) { $("#actionSheetTitle").textContent = title; $("#actionSheetBody").innerHTML = html; showSheet("#actionSheet"); }
  /* Professional SVG icons (original stroke/filled shapes, TikTok-style layout) */
  const ICON_PATHS = {
    home: '<path d="M12 3.1 2.9 10.5c-.4.3-.1 1 .5 1H5v8.2c0 .6.5 1 1 1h4.1v-6h3.8v6H18c.6 0 1-.5 1-1v-8.2h1.6c.6 0 .9-.7.5-1L12 3.1Z" fill="currentColor" stroke="none"/>',
    compass: '<circle cx="12" cy="12" r="8.7"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2 5.2-2Z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.6-4.6"/>',
    bell: '<path d="M18.2 16.8H5.8c1-1.1 1.4-2.2 1.4-3.9v-2c0-3.1 1.7-5.3 3.9-6.1-.2-1.1.3-2 1-2s1.2.9 1 2c2.2.8 3.9 3 3.9 6.1v2c0 1.7.4 2.8 1.3 3.9Z" fill="currentColor" stroke="none"/><path d="M10 20a2.3 2.3 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4" fill="currentColor" stroke="none"/><path d="M4.5 20.2c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    heart: '<path d="M12 20.4S3.3 15.3 2 9.8C1.1 6 3.5 3 6.8 3c2 0 3.9 1.1 5.2 3 1.3-1.9 3.2-3 5.2-3 3.3 0 5.7 3 4.8 6.8-1.3 5.5-10 10.6-10 10.6Z" fill="currentColor" stroke="none"/>',
    comment: '<path fill-rule="evenodd" fill="currentColor" stroke="none" d="M12 3.4c-5 0-9 3.5-9 7.9 0 2.5 1.3 4.7 3.4 6.1-.2 1.1-.6 2.4-1.5 3.5-.2.3 0 .7.4.7 2.3-.3 4.3-1.5 5.5-2.6 1.2.3 2.4.5 3.7.5 5 0 9-3.5 9-7.9s-4-7.9-9-7.9ZM7.4 10.1a1.3 1.3 0 1 0 .01 2.6 1.3 1.3 0 0 0-.01-2.6Zm4.6 0a1.3 1.3 0 1 0 .01 2.6 1.3 1.3 0 0 0-.01-2.6Zm4.6 0a1.3 1.3 0 1 0 .01 2.6 1.3 1.3 0 0 0-.01-2.6Z"/>',
    send: '<path d="M22 2 11 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2 15 22l-4-9-9-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    share: '<path d="M21.3 11.4 13.2 4.6c-.5-.4-1.2-.1-1.2.6v3.2c-5.1.4-8.5 3.4-9.8 8.8-.1.6.7 1 1.2.5 2-3 4.5-4.4 7.6-4.7v3.1c0 .7.7 1 1.2.6l8.1-6.8c.4-.4.4-1.1 0-1.5Z" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M6.9 3.4h10.2c.5 0 .9.4.9.9v16.2c0 .6-.7 1-1.2.6L12 16.9l-4.8 4.2c-.5.4-1.2 0-1.2-.6V4.3c0-.5.4-.9.9-.9Z" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 3.5V14.5m0 0 4.2-4.2M12 14.5l-4.2-4.2"/><path d="M4 17.5v1.7A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8v-1.7"/>',
    activity: '<path d="M4.6 8.6A8.5 8.5 0 1 1 3.5 13"/><path d="M3.3 4v4.8h4.8"/><path d="M12 7.8V12l3 1.9"/>',
    chart: '<path d="M4 20h16"/><path d="M6.5 20v-5.5"/><path d="M11.5 20V6.5"/><path d="M16.5 20v-8.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
    at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.8a2.8 2.8 0 0 0 5 .8V12a9 9 0 1 0-3.1 6.6"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    edit: '<path d="M4.5 19.5h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5.5 16.5v3Z"/><path d="m13.8 7.2 3 3"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M15.6 5.6a3.2 3.2 0 1 1 0 5.8M17.9 15.2c1.5.7 2.4 2 2.8 4.3"/>',
    more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    play: '<path d="M8 5.4v13.2L18.5 12Z" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    userPlus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19.5c1.1-2.9 3.5-4.4 6.5-4.4 1.2 0 2.3.2 3.3.7"/><path d="M18.5 8v6M15.5 11h6"/>',
    link: '<path d="M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.1"/><path d="M14 10a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 19.1l1.2-1.1"/>',
    flag: '<path d="M5 22V4"/><path d="M5 5h12.3l-2.4 3.8 2.4 3.7H5" fill="currentColor" stroke="none"/>',
    ban: '<circle cx="12" cy="12" r="8.7"/><path d="M6.2 6.2l11.6 11.6"/>',
    eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.2A9.7 9.7 0 0 1 12 5c5 0 8.8 4.4 10 7a11.4 11.4 0 0 1-3 3.6M6.6 6.9A11.3 11.3 0 0 0 2 12c1.2 2.6 5 7 10 7 1.4 0 2.8-.3 4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.7 5-2.9v8.4l-5-2.9"/>',
    leaf: '<path d="M5 19C5 10.5 11.5 4.5 20 4c0 8.5-5 15-13.5 15"/><path d="M5 19c2-5 5-8.3 9-10.3"/>',
    badge: '<circle cx="12" cy="12" r="8.7" fill="currentColor" stroke="none"/><path d="m8.7 12.3 2.3 2.3 4.3-4.6" stroke="#fff"/>',
    shield: '<path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9.3 4.1-1.7 7-4.9 7-9.3V5.8Z"/><path d="m9 11.7 2.2 2.2 4-4.2"/>',
    file: '<path d="M6 2.8h8L19 8v13.2H6Z"/><path d="M13.5 3v5.5H19"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 16 4-4-4-4"/><path d="M19 12H9"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>'
  };
  function icon(name) { return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`; }
  $$("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  applyTheme();
  applyLanguage();


  /* ------------------------------------------------------------ boot */
  async function boot() {
    setTimeout(() => { const sp = $("#splash"); sp.style.opacity = "0"; setTimeout(() => sp.remove(), 450); }, 700);
    me = await store.currentUser().catch(() => null);
    if (me) { await afterLogin(false); } else { me = null; likedSet = new Set(); savedSet = new Set(); enterApp(); } // guest-first: videos before account
    pushSentinel();
    if (navigator.serviceWorker && navigator.serviceWorker.register) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  function showAuth() {
    $("#authScreen").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
    $("#onboardingScreen").classList.add("hidden");
  }
  async function afterLogin(checkOnboarding) {
    pushSentinel();
    $("#authScreen").classList.add("hidden");
    likedSet = me ? await store.likedIds(me.id) : new Set();
    savedSet = me ? await store.savedIds(me.id) : new Set();
    const prefs = me ? await store.getPreferences(me.id) : { category_ids: [] };
    if (checkOnboarding && me && !(prefs.category_ids || []).length) { showOnboarding(); return; }
    enterApp();
  }
  function enterApp() {
    $("#onboardingScreen").classList.add("hidden");
    $("#authScreen").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    goto("home");
    refreshNotifDot();
  }

  /* ------------------------------------------------------------ auth */
  let authMode = "login";
  function setAuthMode(m) {
    authMode = m;
    $("#tabLogin").classList.toggle("active", m === "login");
    $("#tabSignup").classList.toggle("active", m === "signup");
    $("#usernameField").classList.toggle("hidden", m === "login");
    $("#authSubmit").textContent = m === "login" ? "Log in" : "Create account";
    $("#authPassword").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
    $("#authError").classList.add("hidden");
  }
  $("#tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("#tabSignup").addEventListener("click", () => setAuthMode("signup"));
  let userCheckTimer = null;
  $("#authUsername").addEventListener("input", (e) => {
    clearTimeout(userCheckTimer);
    const v = e.target.value.trim().toLowerCase();
    const hint = $("#usernameHint");
    if (v.length < 3) { hint.textContent = ""; return; }
    userCheckTimer = setTimeout(async () => {
      const okAvail = await store.usernameAvailable(v).catch(() => false);
      hint.textContent = okAvail ? "Available" : "Taken or invalid (3-24 chars: a-z 0-9 . _)";
      hint.style.color = okAvail ? "var(--emerald)" : "var(--error)";
    }, 350);
  });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#authError"); err.classList.add("hidden");
    const email = $("#authEmail").value.trim(), pass = $("#authPassword").value;
    try {
      if (authMode === "signup") { me = await store.signUp(email, pass, $("#authUsername").value); store.logEvent(me.id, "Account created", ""); toast("Account created — welcome to Tokisla!"); }
      else { me = await store.logIn(email, pass); store.logEvent(me.id, "Logged in", ""); toast("Welcome back!"); }
      await afterLogin(false);
      if (authMode === "signup") goto("profile"); // TikTok-style: new accounts land on their profile, no categories step
    } catch (ex) { err.textContent = ex.message || "Something went wrong."; err.classList.remove("hidden"); }
  });
  $("#forgotBtn").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) { toast("Type your email above first, then tap Forgot password."); return; }
    if (!DEMO && sb) { const { error } = await sb.auth.resetPasswordForEmail(email); toast(error ? error.message : "Password reset email sent."); }
    else toast("Demo mode: password reset email would be sent to " + email + " in the live app.");
  });
  function continueAsGuest() { me = null; likedSet = new Set(); savedSet = new Set(); enterApp(); }
  $("#guestBtn").addEventListener("click", continueAsGuest);
  $("#authCloseBtn").addEventListener("click", continueAsGuest);

  /* ------------------------------------------------------------ onboarding */
  const pickedCats = new Set();
  function showOnboarding() {
    $("#authScreen").classList.add("hidden");
    $("#appShell").classList.add("hidden");
    $("#onboardingScreen").classList.remove("hidden");
    const grid = $("#categoryGrid"); grid.innerHTML = "";
    CATS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip"; b.textContent = c.name;
      b.addEventListener("click", () => { pickedCats.has(c.id) ? pickedCats.delete(c.id) : pickedCats.add(c.id); b.classList.toggle("on", pickedCats.has(c.id)); });
      grid.appendChild(b);
    });
  }
  $("#onboardingDone").addEventListener("click", async () => {
    if (me) await store.setPreferences(me.id, Array.from(pickedCats));
    enterApp();
  });

  /* ------------------------------------------------------------ navigation */
  let currentView = "home";
  function goto(view) {
    currentView = view;
    $$(".view").forEach((v) => v.classList.add("hidden"));
    $("#view-" + view).classList.remove("hidden");
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.goto === view));
    $("#topBar").style.display = view === "home" ? "flex" : "none";
    if (view !== "home") pauseAllVideos();
    if (view === "home") loadFeed();
    if (view === "discover") renderDiscover();
    if (view === "create") renderMyVideos();
    if (view === "notifications") renderNotifications();
    if (view === "messages") renderConversations();
    if (view === "friends") renderFriends();
    if (view === "profile") renderProfile(me ? me.id : null);
  }
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.goto;
    if ((v === "create" || v === "notifications") && !me) { needLogin(); return; }
    goto(v);
  }));
  /* Android/browser Back: one step back at a time; only on the video feed
     (with nothing open) does the next Back leave/close the app. A single
     sentinel history entry drives this: each Back consumes it, the handler
     steps the UI back once, and re-arms it unless the feed root is reached.
     The WebView shell already maps Back to web history, so no native
     change is needed. */
  let sentinelActive = false;
  function pushSentinel() {
    if (sentinelActive) return;
    try { history.pushState({ tokisla: true }, ""); sentinelActive = true; } catch (e) {}
  }
  function atFeedRoot() {
    return !$("#appShell").classList.contains("hidden")
      && $("#authScreen").classList.contains("hidden")
      && $("#onboardingScreen").classList.contains("hidden")
      && $("#sheetBackdrop").classList.contains("hidden")
      && currentView === "home";
  }
  function handleBackStep() {
    if (!$("#sheetBackdrop").classList.contains("hidden")) { hideSheets(); return; }
    if (currentView === "messages" && !$("#threadPanel").classList.contains("hidden")) { closeThread(); return; }
    if (!$("#authScreen").classList.contains("hidden")) { continueAsGuest(); return; }
    if (!$("#onboardingScreen").classList.contains("hidden")) { enterApp(); return; }
    if (currentView !== "home") { goto("home"); return; }
  }
  window.addEventListener("popstate", () => {
    sentinelActive = false;
    handleBackStep();
    if (!atFeedRoot()) pushSentinel();
  });
  $("#feedForYouBtn").addEventListener("click", () => setFeedKind("foryou"));
  $("#feedFollowingBtn").addEventListener("click", () => setFeedKind("following"));
  $("#topSearchBtn").addEventListener("click", () => goto("discover"));
  document.addEventListener("click", async (e) => {
    const tg = e.target && e.target.closest ? e.target.closest("[data-tag]") : null;
    if (tg) { openHashtag(tg.dataset.tag); return; }
    const mn = e.target && e.target.closest ? e.target.closest("[data-mention]") : null;
    if (mn) {
      const pr = await store.profileByUsername(mn.dataset.mention).catch(() => null);
      if (pr) openProfile(pr.id); else toast("@" + mn.dataset.mention + " not found.");
    }
  });
  $("#msgEntry").addEventListener("click", () => { if (!me) { needLogin(); return; } goto("messages"); });
  $("#msgBack").addEventListener("click", () => goto("notifications"));
  $("#threadBack").addEventListener("click", () => closeThread());
  $("#threadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!threadWith) return;
    const body = $("#threadInput").value;
    if (!body.trim()) return;
    try { await store.sendMessage(me.id, threadWith.id, body); $("#threadInput").value = ""; await renderThreadMsgs(); }
    catch (err) { toast(err.message); }
  });
  function setFeedKind(k) {
    if (k === "following" && !me) { toast("Log in to see videos from people you follow."); showAuth(); return; }
    feedKind = k;
    $("#feedForYouBtn").classList.toggle("active", k === "foryou");
    $("#feedFollowingBtn").classList.toggle("active", k === "following");
    loadFeed();
  }

  /* ------------------------------------------------------------ feed */
  function pauseAllVideos() { $$("#feed video").forEach((v) => { try { v.pause(); } catch (e) {} }); }
  async function loadFeed() {
    const feedEl = $("#feed");
    feedEl.innerHTML = '<div class="slide shimmer"></div>';
    const list = await store.feed(me ? me.id : null, feedKind).catch(() => []);
    feedEl.innerHTML = "";
    $("#feedEmpty").classList.toggle("hidden", list.length > 0);
    list.forEach((v) => feedEl.appendChild(slideEl(v)));
    observeSlides();
  }
  const countedViews = new Set();
  function observeSlides() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const vids = en.target.querySelectorAll("video");
        if (!vids.length) return;
        if (en.intersectionRatio >= 0.6) {
          vids.forEach((x) => x.play().catch(() => {}));
          const id = en.target.dataset.id;
          if (id && !countedViews.has(id)) { countedViews.add(id); store.recordView(id, me ? me.id : null).catch(() => {}); }
        }
        else { vids.forEach((x) => x.pause()); }
      });
    }, { root: $("#feed"), threshold: [0, 0.6, 1] });
    $$("#feed .slide").forEach((s) => observer.observe(s));
  }
  const FILTER_CSS = { normal: "", warm: "sepia(.35) saturate(1.25) contrast(1.02)", cool: "saturate(1.1) hue-rotate(12deg) brightness(1.05)", mono: "grayscale(1) contrast(1.05)", vivid: "saturate(1.65) contrast(1.12)" };
  function linkify(text) {
    return esc(String(text || ""))
      .replace(/#([^\s#]+)/g, '<span class="tag-link" data-tag="$1">#$1</span>')
      .replace(/@([a-z0-9_.]+)/gi, '<span class="mention-link" data-mention="$1">@$1</span>');
  }
  function scrollToVideo(id) {
    goto("home");
    setTimeout(() => { const sl = $(`#feed .slide[data-id="${id}"]`); if (sl) sl.scrollIntoView(); else toast("Open the feed to watch."); }, 350);
  }
  async function openHashtag(tag) {
    goto("discover");
    const inp = $("#searchInput"); if (inp) inp.value = "#" + tag;
    const vids = await store.hashtagVideos(me ? me.id : null, tag).catch(() => []);
    const box = $("#searchResults"); box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "list-item";
    head.innerHTML = `<div class="grow"><div class="t">#${esc(tag)}</div><div class="s">${vids.length} video(s)</div></div>`;
    box.appendChild(head);
    vids.forEach((v) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${v.thumbnail_path ? `<img class="thumb" src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t">${esc(v.caption || "Video")}</div><div class="s">@${esc(v.username || "")} · ${fmt(v.like_count)} likes</div></div>`;
      el.style.cursor = "pointer";
      el.addEventListener("click", () => scrollToVideo(v.id));
      box.appendChild(el);
    });
    if (!vids.length) box.innerHTML += '<p class="muted center" style="padding:14px">No videos with this hashtag yet.</p>';
  }
  function renderPoll(box, v) {
    const st = v.poll_state || { counts: [0, 0], total: 0, my: null };
    const total = st.total || 0;
    const showRes = st.my !== null && st.my !== undefined;
    box.innerHTML = `<div class="poll-q">${esc(v.poll.question)}</div>` + v.poll.options.map((opt, i) => {
      const pct = total ? Math.round((st.counts[i] || 0) / total * 100) : 0;
      return `<button class="poll-opt ${st.my === i ? "mine" : ""}" data-poll-opt="${i}">${showRes ? `<span class="pf" style="width:${pct}%"></span>` : ""}<span class="pl"><span>${esc(opt)}${st.my === i ? " ✓" : ""}</span>${showRes ? `<span>${pct}%</span>` : ""}</span></button>`;
    }).join("") + (total ? `<div class="tiny" style="color:rgba(255,255,255,.75);margin-top:5px">${total} vote(s)</div>` : "");
    box.querySelectorAll("[data-poll-opt]").forEach((b) => b.addEventListener("click", async () => {
      if (needLogin()) return;
      try { v.poll_state = await store.votePoll(me.id, v.id, Number(b.dataset.pollOpt)); renderPoll(box, v); }
      catch (e) { toast(e.message); }
    }));
  }
  function slideEl(v) {
    const slide = document.createElement("div");
    slide.className = "slide"; slide.dataset.id = v.id;
    const src = sessionUploads[v.id] || v.storage_path;
    const liked = likedSet.has(v.id), saved = savedSet.has(v.id);
    const filt = FILTER_CSS[v.filter] || "";
    const duet = v.duet_source ? v.duet_source : null;
    slide.innerHTML = `
      ${duet ? `<div class="duet-wrap"><video class="duet-src" src="${esc(sessionUploads[duet.id] || duet.storage_path)}" loop playsinline preload="metadata"></video><video class="duet-main" src="${esc(src)}" ${v.thumbnail_path ? `poster="${esc(v.thumbnail_path)}"` : ""} loop playsinline preload="metadata" ${filt ? `style="filter:${filt}"` : ""}></video></div>`
        : `<video src="${esc(src)}" ${v.thumbnail_path ? `poster="${esc(v.thumbnail_path)}"` : ""} loop playsinline preload="metadata" ${filt ? `style="filter:${filt}"` : ""}></video>`}
      <div class="scrim"></div>
      <div class="rail">
        <div class="rail-profile"><img class="avatar" data-act="profile" src="${esc(v.avatar_url || "")}" alt="" onerror="this.style.background='var(--emerald)';this.removeAttribute('src')"><button class="rail-follow" data-act="follow" aria-label="Follow creator">${icon("plus")}</button></div>
        <button class="rail-btn" data-act="like"><span class="bubble">${icon("heart")}</span><span data-like-count>${fmt(v.like_count)}</span></button>
        <button class="rail-btn" data-act="comments"><span class="bubble">${icon("comment")}</span><span data-comment-count>${fmt(v.comment_count)}</span></button>
        <button class="rail-btn ${saved ? "saved" : ""}" data-act="save"><span class="bubble">${icon("bookmark")}</span><span>Save</span></button>
        <button class="rail-btn" data-act="share"><span class="bubble">${icon("share")}</span><span>Share</span></button>
        <button class="rail-btn" data-act="more"><span class="bubble">${icon("more")}</span><span>More</span></button>
      </div>
      <div class="caption-box">
        ${duet ? `<div><span class="duet-tag" data-act="duet-profile">Duet with @${esc(duet.username)}</span></div>` : ""}
        ${v.reply_comment ? `<div class="reply-card" data-act="reply-open"><div class="rc-h">Reply to @${esc(v.reply_comment.username)}</div><div class="rc-b">${esc(v.reply_comment.body)}</div></div>` : ""}
        ${v.poll ? `<div class="poll-box" data-poll></div>` : ""}
        <div class="user" data-act="profile">${esc(v.display_name || v.username)} ${v.verified ? `<span class="verified">${icon("badge")}</span>` : ""}</div>
        <div class="cap">${linkify(v.caption)}</div>
      </div>
      <div class="progress"><i></i></div>`;
    const vid = slide.querySelector("video.duet-main") || slide.querySelector("video");
    const duetVid = slide.querySelector("video.duet-src");
    if (duetVid) {
      vid.addEventListener("play", () => { duetVid.play().catch(() => {}); });
      vid.addEventListener("pause", () => duetVid.pause());
      vid.addEventListener("timeupdate", () => { if (Math.abs((duetVid.currentTime || 0) - vid.currentTime) > 0.6) { try { duetVid.currentTime = vid.currentTime; } catch (e) {} } });
    }
    const bar = slide.querySelector(".progress > i");
    const pollBox = slide.querySelector("[data-poll]");
    if (pollBox && v.poll) renderPoll(pollBox, v);
    const dpEl = slide.querySelector('[data-act="duet-profile"]');
    if (dpEl) dpEl.addEventListener("click", () => openProfile(duet.creator_id));
    const roEl = slide.querySelector('[data-act="reply-open"]');
    if (roEl) roEl.addEventListener("click", () => scrollToVideo(v.reply_video_id));
    vid.addEventListener("timeupdate", () => { if (vid.duration) bar.style.width = (vid.currentTime / vid.duration * 100) + "%"; });
    let lastTap = 0;
    // Long-press the video -> the share popup (Share / Download / Copy link),
    // like TikTok. A long press must not also trigger the tap actions.
    let lpTimer = null, lpX = 0, lpY = 0, longPressed = false;
    const lpCancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    vid.addEventListener("pointerdown", (e) => {
      lpX = e.clientX || 0; lpY = e.clientY || 0; longPressed = false; lpCancel();
      lpTimer = setTimeout(() => {
        longPressed = true;
        try { if (navigator.vibrate) navigator.vibrate(25); } catch (err) {}
        doShare(v);
      }, 550);
    });
    vid.addEventListener("pointermove", (e) => {
      if (Math.abs((e.clientX || 0) - lpX) > 12 || Math.abs((e.clientY || 0) - lpY) > 12) lpCancel();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => vid.addEventListener(ev, lpCancel));
    vid.addEventListener("contextmenu", (e) => e.preventDefault());
    vid.addEventListener("click", () => {
      if (longPressed) { longPressed = false; lastTap = 0; return; }
      const t = Date.now();
      if (t - lastTap < 300) { doLike(v, slide, true); }
      else { setTimeout(() => { if (Date.now() - lastTap >= 300) { vid.paused ? vid.play().catch(() => {}) : vid.pause(); } }, 310); }
      lastTap = t;
    });
    slide.querySelector('[data-act="like"]').addEventListener("click", () => doLike(v, slide, false));
    slide.querySelector('[data-act="follow"]').addEventListener("click", async (e) => {
      if (needLogin()) return;
      const on = await store.toggleFollow(me.id, v.creator_id);
      e.currentTarget.classList.toggle("following", on);
      e.currentTarget.innerHTML = icon(on ? "check" : "plus");
      toast(on ? "Following @" + v.username : "Unfollowed @" + v.username);
    });
    slide.querySelector('[data-act="comments"]').addEventListener("click", () => openComments(v));
    slide.querySelector('[data-act="share"]').addEventListener("click", () => doShare(v));
    slide.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
      if (needLogin()) return;
      const on = await store.toggleSave(me.id, v.id);
      savedSet[on ? "add" : "delete"](v.id);
      e.currentTarget.classList.toggle("saved", on);
      toast(on ? "Saved to your profile." : "Removed from saved.");
    });
    slide.querySelector('[data-act="more"]').addEventListener("click", () => moreMenu(v, slide));
    slide.querySelectorAll('[data-act="profile"]').forEach((el) => el.addEventListener("click", () => openProfile(v.creator_id)));
    const likeBtn = slide.querySelector('[data-act="like"]');
    if (liked) likeBtn.classList.add("liked");
    return slide;
  }
  async function doLike(v, slide, fromDoubleTap) {
    if (needLogin()) return;
    const was = likedSet.has(v.id);
    if (fromDoubleTap && was) return; // double-tap only adds a like
    let on; try { on = await store.toggleLike(me.id, v.id); } catch (e) { toast(e.message); return; }
    likedSet[on ? "add" : "delete"](v.id);
    const btn = slide.querySelector('[data-act="like"]');
    btn.classList.toggle("liked", on);
    btn.querySelector(".bubble").innerHTML = icon("heart");
    const countEl = slide.querySelector("[data-like-count]");
    countEl.textContent = fmt(Math.max(0, (parseInt(countEl.dataset.raw || v.like_count, 10) || 0) + (on ? 1 : -1)));
    countEl.dataset.raw = String((parseInt(countEl.dataset.raw || v.like_count, 10) || 0) + (on ? 1 : -1));
    if (on) {
      const h = document.createElement("div");
      h.className = "heart-pop"; h.innerHTML = icon("heart");
      h.style.left = "50%"; h.style.top = "38%"; h.style.marginLeft = "-44px";
      slide.appendChild(h); setTimeout(() => h.remove(), 750);
    }
  }
  function videoLink(v) { return location.href.split("#")[0] + "#v=" + v.id; }
  function copyLink(v) {
    const url = videoLink(v);
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Link copied.")).catch(() => toast(url));
    else toast(url);
  }
  function systemShare(v) {
    if (navigator.share) navigator.share({ title: "Tokisla", text: v.caption || "Watch on Tokisla", url: videoLink(v) }).catch(() => {});
    else copyLink(v);
  }
  async function watermarkedBlob(src, v) {
    // Re-encodes the clip with a burned-in "Tokisla / @user" watermark.
    // Returns null where the device cannot do it — caller falls back.
    try {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
      const blob = await (await fetch(src)).blob();
      const url = URL.createObjectURL(blob);
      const vid = document.createElement("video");
      vid.src = url; vid.playsInline = true;
      await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = rej; });
      const cv = document.createElement("canvas");
      cv.width = vid.videoWidth || 360; cv.height = vid.videoHeight || 640;
      const ctx = cv.getContext("2d"); if (!ctx) { URL.revokeObjectURL(url); return null; }
      const stream = cv.captureStream(30);
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          const ac = new AC();
          const node = ac.createMediaElementSource(vid);
          const dest = ac.createMediaStreamDestination();
          node.connect(dest); // routed into the recording only — speakers stay silent
          dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
      } catch (e) { /* video-only watermark is still fine */ }
      const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported("video/mp4") ? { mimeType: "video/mp4" } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || "video/webm" })); });
      const draw = () => {
        if (vid.paused || vid.ended) return;
        ctx.drawImage(vid, 0, 0, cv.width, cv.height);
        const fs = Math.max(16, Math.round(cv.width * 0.05));
        ctx.textAlign = "right";
        ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(255,255,255,.93)";
        ctx.font = "700 " + fs + "px sans-serif";
        ctx.fillText("Tokisla", cv.width - 14, cv.height - 16 - Math.round(fs * 0.9));
        ctx.font = "400 " + Math.round(fs * 0.78) + "px sans-serif";
        ctx.fillText("@" + (v.username || ""), cv.width - 14, cv.height - 14);
        requestAnimationFrame(draw);
      };
      rec.start(250);
      await vid.play();
      requestAnimationFrame(draw);
      await new Promise((res) => { vid.onended = res; setTimeout(res, ((vid.duration || 20) + 2) * 1000); });
      try { rec.stop(); } catch (e) {}
      const out = await done;
      URL.revokeObjectURL(url);
      return out && out.size > 10000 ? out : null;
    } catch (e) { return null; }
  }
  async function downloadVideo(v) {
    const src = sessionUploads[v.id] || v.storage_path;
    const name = "tokisla-" + v.id + ".mp4";
    try {
      toast("Preparing download...");
      const wm = await watermarkedBlob(src, v).catch(() => null);
      if (wm) {
        const wmName = "tokisla-" + v.id + (wm.type.includes("mp4") ? ".mp4" : ".webm");
        if (window.TokislaNative && window.TokislaNative.saveVideo) {
          const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(wm); });
          window.TokislaNative.saveVideo(b64, wmName);
        } else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(wm); a.download = wmName; document.body.appendChild(a); a.click(); a.remove();
        }
        toast("Downloaded with watermark.");
        return;
      }
      if (window.TokislaNative && window.TokislaNative.saveVideo) {
        const blob = await (await fetch(src)).blob();
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
        window.TokislaNative.saveVideo(b64, name);
        return;
      }
      const a = document.createElement("a");
      a.href = src; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      toast("Download started.");
    } catch (e) { toast("Download failed on this device."); }
  }
  function doShare(v) { openShareSheet(v); }
  async function openShareSheet(v) {
    openActionSheet("Share video", `
      <div class="share-sec">Send to friends</div>
      <div class="share-friends" id="shareFriends"><p class="muted tiny">Loading...</p></div>
      <div class="share-actions">
        <button class="share-act" id="shDownload"><span class="share-ico">${icon("download")}</span><span>Download video</span></button>
        <button class="share-act" id="shCopy"><span class="share-ico">${icon("link")}</span><span>Copy link</span></button>
        <button class="share-act" id="shApps"><span class="share-ico">${icon("share")}</span><span>More apps</span></button>
      </div>`);
    $("#shDownload").addEventListener("click", () => { hideSheets(); downloadVideo(v); });
    $("#shCopy").addEventListener("click", () => { hideSheets(); copyLink(v); });
    $("#shApps").addEventListener("click", () => { hideSheets(); systemShare(v); });
    // Honour the creator's "who can download" setting.
    if (me && v.creator_id !== me.id) {
      try {
        const pr = await store.getAllowPrefs(v.creator_id);
        let dlNote = "";
        if (pr.allow_download === "nobody") dlNote = "Downloads are turned off for this video.";
        else if (pr.allow_download === "followers") { const st = await store.profileStats(v.creator_id, me.id); if (!st.is_following) dlNote = "Only followers can download this video."; }
        if (dlNote) { const dl = $("#shDownload"); if (dl) { const c = dl.cloneNode(true); c.style.opacity = ".55"; c.innerHTML = `<span class="share-ico">${icon("download")}</span><span>${dlNote}</span>`; dl.replaceWith(c); } }
      } catch (e) {}
    }
    const people = await store.people(me ? me.id : null).catch(() => []);
    const row = $("#shareFriends"); if (!row) return;
    row.innerHTML = people.length ? "" : '<p class="muted tiny">No friends yet.</p>';
    people.forEach((person) => {
      const b = document.createElement("button");
      b.className = "share-friend";
      b.innerHTML = `${avatarHtml(person, "")}<span>@${esc(person.username)}</span>`;
      b.addEventListener("click", async () => {
        hideSheets();
        if (needLogin()) return;
        try { await store.shareVideo(me.id, v.id, person.id); toast("Sent to @" + person.username); }
        catch (e) { toast("Could not send. Try More apps instead."); }
      });
      row.appendChild(b);
    });
  }
  function moreMenu(v, slide) {
    const mine = me && me.id === v.creator_id;
    openActionSheet("Video options", `
      ${mine ? "" : `<button class="menu-row" id="mmFollow"><span class="menu-ico">${icon("userPlus")}</span> Follow / unfollow @${esc(v.username)}</button>`}
      <button class="menu-row" id="mmCopy"><span class="menu-ico">${icon("link")}</span> Copy link</button>
      <button class="menu-row" id="mmDuet"><span class="menu-ico">${icon("users")}</span> Duet with this video</button>
      ${mine ? "" : `<button class="menu-row danger" id="mmReport"><span class="menu-ico">${icon("flag")}</span> Report this video</button>`}
      ${mine ? "" : `<button class="menu-row danger" id="mmBlock"><span class="menu-ico">${icon("ban")}</span> Block @${esc(v.username)}</button>`}
      ${mine ? "" : `<button class="menu-row" id="mmHide"><span class="menu-ico">${icon("eyeOff")}</span> Not interested</button>`}`);
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
    bind("#mmCopy", () => { hideSheets(); copyLink(v); });
    bind("#mmDuet", () => { hideSheets(); if (needLogin()) return; startDuet(v); });
    bind("#mmFollow", async () => { hideSheets(); if (needLogin()) return; const on = await store.toggleFollow(me.id, v.creator_id); toast(on ? "Following @" + v.username : "Unfollowed @" + v.username); });
    bind("#mmReport", () => reportMenu("video", v.id));
    bind("#mmBlock", async () => { hideSheets(); if (needLogin()) return; await store.toggleBlock(me.id, v.creator_id); toast("Blocked. Their videos will no longer appear."); loadFeed(); });
    bind("#mmHide", () => { hideSheets(); slide.remove(); toast("Got it — showing less like this."); });
  }

  /* ------------------------------------------------------------ comments */
  let commentVideo = null;
  async function openComments(v) {
    commentVideoId = v.id; commentVideo = v;
    showSheet("#commentSheet");
    await renderComments();
    // Honour the creator's "who can comment" setting in the composer.
    if (me && v.creator_id !== me.id) {
      try {
        const pr = await store.getAllowPrefs(v.creator_id);
        let okC = pr.allow_comment === "everyone";
        if (pr.allow_comment === "followers") { const st = await store.profileStats(v.creator_id, me.id); okC = !!st.is_following; }
        if (!okC) {
          const f = $("#commentForm");
          if (f) f.innerHTML = `<p class="muted center" style="padding:12px">${pr.allow_comment === "nobody" ? "Comments are turned off for this video." : "Only followers can comment on this video."}</p>`;
        }
      } catch (e) {}
    }
  }
  async function renderComments() {
    const list = await store.comments(commentVideoId, me ? me.id : null).catch(() => []);
    const box = $("#commentList");
    box.innerHTML = list.length ? "" : '<p class="muted center" style="padding:18px">No comments yet. Be kind and start one.</p>';
    list.forEach((c) => {
      const row = document.createElement("div");
      row.className = "comment";
      row.innerHTML = `${avatarHtml(c, "")}<div style="flex:1;min-width:0"><div class="cu">@${esc(c.username)} <span class="muted" style="font-weight:400">${ago(c.created_at)}</span>${c.is_pinned ? `<span class="pin-badge">Pinned</span>` : ""}</div><div class="cb">${linkify(c.body)}</div>
        <div class="c-actions">
          ${c.reply_video_id ? `<button class="c-act accent" data-watch-reply="${c.reply_video_id}">Watch video reply</button>` : ""}
          <button class="c-act" data-reply-video>Reply with video</button>
          ${me && commentVideo && commentVideo.creator_id === me.id ? `<button class="c-act" data-pin>${c.is_pinned ? "Unpin" : "Pin"}</button>` : ""}
        </div></div>
        <div class="c-like ${c.liked_by_me ? "liked" : ""}"><button data-like-comment aria-label="Like comment">${icon("heart")}</button><span data-clike-count>${c.like_count || ""}</span></div>
        ${me && c.user_id === me.id ? `<button class="icon-btn" data-del-comment aria-label="Delete comment" style="background:var(--emerald-soft);color:var(--error);width:30px;height:30px">${icon("close")}</button>` : ""}`;
      const del = row.querySelector("[data-del-comment]");
      if (del) del.addEventListener("click", async () => { await store.deleteComment(me.id, c.id); renderComments(); });
      row.querySelector("[data-like-comment]").addEventListener("click", async () => {
        if (needLogin()) return;
        try {
          const r = await store.toggleCommentLike(me.id, c.id);
          row.querySelector(".c-like").classList.toggle("liked", r.liked);
          row.querySelector("[data-clike-count]").textContent = r.count || "";
        } catch (e) { toast(e.message); }
      });
      const pn = row.querySelector("[data-pin]");
      if (pn) pn.addEventListener("click", async () => { try { await store.pinComment(me.id, c.id); renderComments(); } catch (e) { toast(e.message); } });
      row.querySelector("[data-reply-video]").addEventListener("click", () => { if (needLogin()) return; hideSheets(); startVideoReply(c); });
      const wr = row.querySelector("[data-watch-reply]");
      if (wr) wr.addEventListener("click", () => { hideSheets(); scrollToVideo(wr.dataset.watchReply); });
      box.appendChild(row);
    });
  }
  $("#commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (needLogin()) return;
    const inp = $("#commentInput");
    try { await store.addComment(me.id, commentVideoId, inp.value); inp.value = ""; renderComments(); }
    catch (ex) { toast(ex.message); }
  });

  /* ------------------------------------------------------------ report */
  function reportMenu(targetType, targetId) {
    const reasons = ["Contains music", "Inappropriate content", "Abuse or harassment", "Spam", "Impersonation", "Religious disrespect", "Misinformation", "Other"];
    openActionSheet("Report", reasons.map((r) => `<button class="menu-row" data-reason="${esc(r)}">${esc(r)}</button>`).join(""));
    $$("#actionSheetBody [data-reason]").forEach((b) => b.addEventListener("click", async () => {
      hideSheets(); if (needLogin()) return;
      await store.report(me.id, targetType, targetId, b.dataset.reason);
      toast("Thank you — our moderation team will review this.");
    }));
  }

  /* ------------------------------------------------------------ messages */
  let threadWith = null;
  async function renderConversations() {
    threadWith = null;
    $("#threadPanel").classList.add("hidden");
    $("#convPanel").classList.remove("hidden");
    const convs = await store.conversations(me.id).catch(() => []);
    const box = $("#convList"); box.innerHTML = "";
    $("#convEmpty").classList.toggle("hidden", convs.length > 0);
    convs.forEach((c) => {
      const el = document.createElement("div");
      el.className = "list-item";
      const mine = c.last.sender_id === me.id;
      el.innerHTML = `${avatarHtml(c.user, "")}<div class="grow"><div class="t">${esc(c.user.display_name || c.user.username)} ${c.user.verified ? `<span class="verified">${icon("badge")}</span>` : ""}</div>
        <div class="s ${c.unread ? "unread" : ""}">${mine ? "You: " : ""}${esc(c.last.body)}</div></div>
        <div class="conv-side"><span class="s muted">${ago(c.last.created_at)}</span>${c.unread ? `<span class="msg-badge">${c.unread}</span>` : ""}</div>`;
      el.addEventListener("click", () => openThread(c.user));
      box.appendChild(el);
    });
    const people = await store.followList(me.id, "following").catch(() => []);
    const pb = $("#msgPeople"); pb.innerHTML = "";
    people.forEach((u) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${avatarHtml(u, "")}<div class="grow"><div class="t">${esc(u.display_name || u.username)}</div><div class="s muted">@${esc(u.username)}</div></div><button class="btn btn-ghost" style="height:37px">Message</button>`;
      el.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); openThread(u); });
      el.addEventListener("click", () => openProfile(u.id));
      pb.appendChild(el);
    });
    updateMsgBadge();
  }
  async function openThread(user) {
    threadWith = user;
    $("#convPanel").classList.add("hidden");
    $("#threadPanel").classList.remove("hidden");
    $("#threadName").textContent = user.display_name || user.username;
    $("#threadHandle").textContent = "@" + user.username;
    const av = $("#threadAvatar");
    if (user.avatar_url) { av.src = user.avatar_url; av.style.background = ""; } else { av.removeAttribute("src"); av.style.background = "var(--emerald)"; }
    await store.markThreadRead(me.id, user.id).catch(() => {});
    await renderThreadMsgs();
    updateMsgBadge();
  }
  function closeThread() { renderConversations(); }
  async function renderThreadMsgs() {
    if (!threadWith) return;
    const msgs = await store.thread(me.id, threadWith.id).catch(() => []);
    const box = $("#threadMsgs");
    box.innerHTML = msgs.map((m) => `<div class="bubble-row ${m.sender_id === me.id ? "mine" : ""}"><div class="bubble">${esc(m.body)}</div></div>`).join("");
    const last = box.lastElementChild;
    if (last) { try { last.scrollIntoView({ block: "end" }); } catch (e) {} }
  }

  /* ------------------------------------------------------------ discover */
  function renderDiscover() {
    (async () => {
      const tt = await store.trendingHashtags(me ? me.id : null).catch(() => []);
      const tgEl = $("#trendingTags"); if (!tgEl) return;
      tgEl.innerHTML = tt.length ? "" : '<p class="muted tiny" style="padding:2px">No hashtags yet — put # in a caption.</p>';
      tt.forEach((t) => { const b = document.createElement("button"); b.className = "chip"; b.textContent = "#" + t.tag + " · " + t.count; b.addEventListener("click", () => openHashtag(t.tag)); tgEl.appendChild(b); });
    })();
    const grid = $("#discoverCategories"); grid.innerHTML = "";
    CATS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip"; b.textContent = c.name;
      b.addEventListener("click", () => { $("#searchInput").value = ""; renderSearchResults([], [], CATS.filter((x) => x.id === c.id), c); });
      grid.appendChild(b);
    });
    renderSearchResults([], [], [], null);
  }
  let searchTimer = null;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(async () => {
      if (!q.trim()) { renderSearchResults([], [], [], null); return; }
      const r = await store.search(me ? me.id : null, q).catch(() => ({ users: [], videos: [] }));
      renderSearchResults(r.users, r.videos, [], null);
      if (q.trim().length >= 2) pushSearch(q.trim());
    }, 300);
  });
  async function renderSearchResults(users, videos, cats, onlyCat) {
    const box = $("#searchResults"); box.innerHTML = "";
    if (onlyCat) {
      const all = await store.feed(me ? me.id : null, "foryou");
      videos = all.filter((v) => (v.category_ids || []).includes(onlyCat.id));
      box.innerHTML = `<div class="list-item"><div class="grow"><div class="t">${esc(onlyCat.name)}</div><div class="s">${videos.length} video(s)</div></div></div>`;
    }
    users.forEach((u) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${avatarHtml(u, "")}<div class="grow"><div class="t">@${esc(u.username)}</div><div class="s">${esc(u.display_name || "")}</div></div>`;
      el.style.cursor = "pointer";
      el.addEventListener("click", () => openProfile(u.id));
      box.appendChild(el);
    });
    videos.forEach((v) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${v.thumbnail_path ? `<img class="thumb" src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t">${esc(v.caption || "Video")}</div><div class="s">@${esc(v.username || "")} · ${fmt(v.like_count)} likes</div></div>`;
      el.style.cursor = "pointer";
      el.addEventListener("click", () => { goto("home"); setTimeout(() => { const s = $(`#feed .slide[data-id="${v.id}"]`); if (s) s.scrollIntoView(); }, 350); });
      box.appendChild(el);
    });
    if (!users.length && !videos.length && !onlyCat) box.innerHTML = '<p class="muted center" style="padding:14px">Search for creators and videos, or pick a category.</p>';
  }

  /* ------------------------------------------------------------ create / upload */
  let uploadFile = null, uploadDuration = 0, uploadThumb = "";
  let uploadFilter = "normal", duetTarget = null, replyTarget = null;
  const FILTERS = [["normal", "Normal"], ["warm", "Warm"], ["cool", "Cool"], ["mono", "Mono"], ["vivid", "Vivid"]];
  FILTERS.forEach(([fid, fname]) => {
    const b = document.createElement("button");
    b.className = "fchip" + (fid === "normal" ? " active" : ""); b.textContent = fname; b.type = "button";
    b.addEventListener("click", () => {
      uploadFilter = fid;
      $$("#filterChips .fchip").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      const pv = $("#uploadPreview"); if (pv) pv.style.filter = FILTER_CSS[fid] || "";
    });
    $("#filterChips").appendChild(b);
  });
  $("#pollToggle").addEventListener("change", (e) => $("#pollFields").classList.toggle("hidden", !e.target.checked));
  function readPoll() {
    if (!$("#pollToggle").checked) return null;
    const q = $("#pollQ").value.trim(), a = $("#pollA").value.trim(), b = $("#pollB").value.trim();
    if (!q || !a || !b) return "invalid";
    return { question: q, options: [a, b] };
  }
  function updateCreateContext() {
    const box = $("#createContext"), txt = $("#createContextText");
    if (duetTarget) { txt.textContent = "Duet with @" + duetTarget.username + " — your video will play side-by-side with theirs."; box.classList.remove("hidden"); }
    else if (replyTarget) { txt.textContent = "Video reply to @" + replyTarget.username + ": \"" + String(replyTarget.body || "").slice(0, 60) + "\""; box.classList.remove("hidden"); }
    else box.classList.add("hidden");
  }
  $("#createContextClear").addEventListener("click", () => { duetTarget = null; replyTarget = null; updateCreateContext(); });
  function startDuet(v) { duetTarget = v; replyTarget = null; updateCreateContext(); goto("create"); }
  function startVideoReply(c) { replyTarget = { commentId: c.id, username: c.username, body: c.body }; duetTarget = null; updateCreateContext(); goto("create"); }
  const catSelect = $("#uploadCategory");
  CATS.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; catSelect.appendChild(o); });
  /* profile photo: the + badge on the profile picture opens the gallery */
  $("#avatarFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) await applyAvatarFile(f);
  });
  $("#pickVideoBtn").addEventListener("click", () => $("#videoFile").click());
  $("#videoFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    uploadFile = f; uploadDuration = 0; uploadThumb = "";
    const msg = $("#uploadMsg");
    if (!f.type.startsWith("video/")) { msg.textContent = "Please choose a video file."; msg.style.color = "var(--error)"; uploadFile = null; return; }
    if (f.size > CFG.MAX_VIDEO_MB * 1024 * 1024) { msg.textContent = `Too large — max ${CFG.MAX_VIDEO_MB} MB.`; msg.style.color = "var(--error)"; uploadFile = null; return; }
    const pv = $("#uploadPreview");
    pv.src = URL.createObjectURL(f); pv.classList.remove("hidden");
    pv.onloadedmetadata = () => {
      uploadDuration = pv.duration || 0;
      $("#uploadMeta").textContent = `${f.name} · ${uploadDuration.toFixed(1)}s · ${(f.size / 1048576).toFixed(1)} MB`;
      if (uploadDuration > CFG.MAX_VIDEO_SECONDS + 0.5) {
        msg.textContent = `This video is ${uploadDuration.toFixed(1)}s — Tokisla allows max ${CFG.MAX_VIDEO_SECONDS} seconds. Please trim it.`;
        msg.style.color = "var(--error)";
      } else { msg.textContent = "Duration OK"; msg.style.color = "var(--emerald)"; }
      validatePublish();
      // capture a thumbnail frame
      try {
        pv.currentTime = Math.min(1, uploadDuration / 2);
        pv.onseeked = () => {
          const cv = document.createElement("canvas");
          cv.width = 270; cv.height = 480;
          const cx2 = cv.getContext("2d");
          try { cx2.filter = FILTER_CSS[uploadFilter] || ""; } catch (err) {}
          cx2.drawImage(pv, 0, 0, cv.width, cv.height);
          uploadThumb = cv.toDataURL("image/jpeg", 0.6);
          pv.onseeked = null;
        };
      } catch (err) { /* thumbnail is optional */ }
    };
  });
  function validatePublish() {
    const okFile = !!uploadFile && uploadDuration > 0 && uploadDuration <= CFG.MAX_VIDEO_SECONDS + 0.5;
    $("#publishBtn").disabled = !(okFile && $("#policyCheck").checked);
    $("#draftBtn").disabled = !okFile;
  }
  $("#policyCheck").addEventListener("change", validatePublish);
  async function doSubmit(isDraft) {
    if (needLogin()) return;
    const pollVal = readPoll();
    if (pollVal === "invalid") { $("#uploadMsg").textContent = "Poll needs a question and two options — or switch the poll off."; $("#uploadMsg").style.color = "var(--error)"; return; }
    const wrap = $("#uploadProgressWrap"), bar = $("#uploadProgress");
    wrap.classList.remove("hidden");
    let p = 0;
    const iv = setInterval(() => { p = Math.min(92, p + 9); bar.style.width = p + "%"; }, 120);
    try {
      const meta = {
        caption: $("#uploadCaption").value, category_ids: [Number(catSelect.value)],
        visibility: $("#uploadVisibility").value, duration_seconds: Math.round(uploadDuration * 100) / 100,
        size_bytes: uploadFile.size, storage_path: "", thumbnail_path: uploadThumb || "",
        filter: uploadFilter, poll: pollVal,
        duet_of: duetTarget ? duetTarget.id : null,
        reply_comment_id: replyTarget ? replyTarget.commentId : null,
        is_draft: !!isDraft,
      };
      let created;
      if (DEMO) {
        meta.storage_path = "demo-upload";
        created = await store.submitVideo(me.id, meta);
        sessionUploads[created.id] = $("#uploadPreview").src;
        if (uploadThumb) { /* thumb stored as data URL in the row */ }
      } else {
        // Live: create-upload Edge Function verifies metadata server-side,
        // returns { video, upload_url }; we PUT the file, the row stays
        // 'pending' until a moderator approves it.
        created = await store.submitVideo(me.id, { ...meta, filename: uploadFile.name, content_type: uploadFile.type });
        if (created && created.upload_url) {
          await fetch(created.upload_url, { method: "PUT", headers: { "Content-Type": uploadFile.type }, body: uploadFile });
        }
        created = created.video || created;
      }
      clearInterval(iv); bar.style.width = "100%";
      if (isDraft) {
        store.logEvent(me.id, "Draft saved", meta.caption);
        toast("Saved as a draft — post it any time from My videos below.");
        $("#uploadMsg").textContent = "Draft saved. Only you can see it until you post it for review.";
      } else {
        store.logEvent(me.id, "Video uploaded", meta.caption);
        toast("Sent for review — it will appear in the feed once approved.");
        $("#uploadMsg").textContent = DEMO ? "Demo: your video is in the moderation queue. Open the Admin panel (admin.html) to approve it." : "Your video is in the moderation queue.";
      }
      $("#uploadMsg").style.color = "var(--emerald)";
      uploadFile = null; $("#publishBtn").disabled = true; $("#draftBtn").disabled = true;
      duetTarget = null; replyTarget = null; updateCreateContext();
      renderMyVideos();
    } catch (ex) {
      clearInterval(iv); wrap.classList.add("hidden");
      $("#uploadMsg").textContent = ex.message; $("#uploadMsg").style.color = "var(--error)";
    }
  }
  $("#publishBtn").addEventListener("click", () => doSubmit(false));
  $("#draftBtn").addEventListener("click", () => { if (uploadFile) doSubmit(true); });
  async function renderMyVideos() {
    if (!me) return;
    const list = await store.myVideos(me.id).catch(() => []);
    const box = $("#myVideos"); box.innerHTML = list.length ? "" : '<p class="muted center" style="padding:12px">You have not uploaded any videos yet.</p>';
    list.forEach((v) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${v.thumbnail_path ? `<img class="thumb" src="${esc(v.thumbnail_path)}" alt="">` : ""}
        <div class="grow"><div class="t">${esc(v.caption || "Untitled")}</div>
        <div class="s">${v.duration_seconds}s · ${ago(v.created_at)} ago</div>
        ${v.moderation_status === "rejected" && v.rejection_reason ? `<div class="s" style="color:var(--error)">Reason: ${esc(v.rejection_reason)}</div>` : ""}</div>
        <span class="status ${v.moderation_status}">${v.moderation_status === "needs_review" ? "needs review" : v.moderation_status}</span>`;
      if (v.moderation_status === "draft") {
        const acts = document.createElement("div");
        acts.style.display = "flex"; acts.style.gap = "6px"; acts.style.marginTop = "8px";
        const pb = document.createElement("button"); pb.className = "btn btn-primary"; pb.style.height = "36px"; pb.textContent = "Post for review";
        pb.addEventListener("click", async () => { try { await store.publishDraft(me.id, v.id); toast("Sent for review."); renderMyVideos(); } catch (e) { toast(e.message); } });
        const db = document.createElement("button"); db.className = "btn btn-ghost"; db.style.height = "36px"; db.textContent = "Delete";
        db.addEventListener("click", async () => { try { await store.deleteDraft(me.id, v.id); renderMyVideos(); } catch (e) { toast(e.message); } });
        acts.appendChild(pb); acts.appendChild(db); el.appendChild(acts);
      }
      box.appendChild(el);
    });
  }

  /* ------------------------------------------------------------ stories */
  const sessionStoryMedia = {};
  let storyPick = null;
  function fileToScaledDataUrl(file, maxDim) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const cv = document.createElement("canvas");
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            const cx = cv.getContext("2d"); if (!cx) return res(String(r.result));
            cx.drawImage(img, 0, 0, cv.width, cv.height);
            res(cv.toDataURL("image/jpeg", 0.82));
          } catch (e) { res(String(r.result)); }
        };
        img.onerror = () => res(String(r.result));
        img.src = String(r.result);
      };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  $("#storyBtn").addEventListener("click", () => { if (needLogin()) return; openStoryComposer(); });
  $("#storyFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    const prev = $("#storyPreview"), msg = $("#storyMsg"), post = $("#storyPostBtn");
    storyPick = null; if (post) post.disabled = true;
    if (f.type.startsWith("image/")) {
      const dataUrl = await fileToScaledDataUrl(f, 900);
      storyPick = { kind: "image", file: f, dataUrl };
      if (prev) prev.innerHTML = `<img src="${dataUrl}" style="width:100%;border-radius:12px" alt="">`;
      if (msg) { msg.textContent = "Photo ready."; msg.style.color = "var(--emerald)"; }
      if (post) post.disabled = false;
    } else if (f.type.startsWith("video/")) {
      const url = URL.createObjectURL(f);
      const probe = document.createElement("video");
      probe.preload = "metadata"; probe.src = url;
      probe.onloadedmetadata = () => {
        const d = probe.duration || 0;
        if (d > CFG.MAX_VIDEO_SECONDS + 0.5) { if (msg) { msg.textContent = `This video is ${d.toFixed(1)}s — stories are max ${CFG.MAX_VIDEO_SECONDS} seconds.`; msg.style.color = "var(--error)"; } return; }
        storyPick = { kind: "video", file: f, url, duration: d };
        if (prev) prev.innerHTML = `<video src="${url}" controls playsinline style="width:100%;border-radius:12px"></video>`;
        if (msg) { msg.textContent = "Video ready."; msg.style.color = "var(--emerald)"; }
        if (post) post.disabled = false;
      };
      probe.onerror = () => { if (msg) { msg.textContent = "Could not read that video."; msg.style.color = "var(--error)"; } };
    } else if (msg) { msg.textContent = "Choose a photo or a video."; msg.style.color = "var(--error)"; }
  });
  function openStoryComposer() {
    storyPick = null;
    openActionSheet("Post a story", `
      <p class="muted" style="margin-top:0">A photo, or a video up to ${CFG.MAX_VIDEO_SECONDS} seconds. Stories are reviewed first, then stay up for 24 hours.</p>
      <button class="btn btn-ghost btn-block" id="storyPickBtn">Choose photo or video</button>
      <div id="storyPreview" style="margin-top:10px"></div>
      <div class="field" style="margin-top:10px"><label>Caption (optional)</label><input id="storyCaption" maxlength="200" placeholder="Say something kind..."></div>
      <div id="storyMsg" class="tiny"></div>
      <button class="btn btn-primary btn-block" id="storyPostBtn" disabled>Post story for review</button>`);
    $("#storyPickBtn").addEventListener("click", () => $("#storyFile").click());
    $("#storyPostBtn").addEventListener("click", async () => {
      if (!storyPick) return;
      try {
        let created;
        if (DEMO) {
          created = await store.submitStory(me.id, { media_type: storyPick.kind, storage_path: storyPick.kind === "image" ? storyPick.dataUrl : "story-media", caption: $("#storyCaption").value, duration_seconds: storyPick.duration || null });
          if (storyPick.kind === "video") sessionStoryMedia[created.id] = storyPick.url;
        } else {
          created = await store.submitStory(me.id, { media_type: storyPick.kind, caption: $("#storyCaption").value, duration_seconds: storyPick.duration || null, file: storyPick.file });
        }
        hideSheets(); toast("Story sent for review — it will show for 24 hours once approved.");
        storyPick = null;
      } catch (ex) { toast(ex.message); }
    });
  }
  let lastStoryGroups = [];
  async function renderStoriesRail() {
    const rail = $("#storiesRail"); if (!rail || !me) return;
    const groups = await store.storiesFeed(me.id).catch(() => []);
    lastStoryGroups = groups;
    rail.innerHTML = "";
    const mine = document.createElement("button");
    mine.className = "story-item";
    mine.innerHTML = `<span class="story-ring seen"><span style="position:relative;display:block;width:100%;height:100%">${avatarHtml(me, "")}<span class="avatar-plus">${icon("plus")}</span></span></span><span class="sn">Your story</span>`;
    mine.addEventListener("click", () => { if (needLogin()) return; openStoryComposer(); });
    rail.appendChild(mine);
    groups.forEach((g, gi) => {
      const b = document.createElement("button");
      b.className = "story-item";
      b.innerHTML = `<span class="story-ring ${g.has_unseen ? "" : "seen"}">${avatarHtml(g.user, "")}</span><span class="sn">@${esc(g.user.username)}</span>`;
      b.addEventListener("click", () => openStories(gi));
      rail.appendChild(b);
    });
  }
  let svGroup = 0, svIndex = 0, svTimer = null;
  function openStories(gi) { svGroup = gi; svIndex = 0; $("#storyViewer").classList.remove("hidden"); pauseAllVideos(); showStory(); }
  function closeStories() { $("#storyViewer").classList.add("hidden"); if (svTimer) { clearTimeout(svTimer); svTimer = null; } $("#svMedia").innerHTML = ""; }
  function animateSvBar(ms) {
    const b = $$("#svBars i b")[svIndex]; if (!b) return;
    const t0 = Date.now();
    const tick = () => { const pc = Math.min(100, (Date.now() - t0) / ms * 100); b.style.width = pc + "%"; if (pc < 100 && !$("#storyViewer").classList.contains("hidden")) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function showStory() {
    if (svTimer) { clearTimeout(svTimer); svTimer = null; }
    const g = lastStoryGroups[svGroup];
    if (!g) { closeStories(); return; }
    const st = g.stories[svIndex];
    if (!st) { svGroup++; svIndex = 0; showStory(); return; }
    const u = g.user;
    const av = $("#svAvatar");
    if (u.avatar_url) { av.src = u.avatar_url; av.style.background = ""; } else { av.removeAttribute("src"); av.style.background = "var(--emerald)"; }
    $("#svName").textContent = u.display_name || u.username;
    $("#svTime").textContent = "@" + u.username + " · " + ago(st.created_at) + " ago";
    $("#svCaption").textContent = st.caption || "";
    $("#svBars").innerHTML = g.stories.map((x, i) => `<i><b style="width:${i < svIndex ? "100" : "0"}%"></b></i>`).join("");
    const box = $("#svMedia");
    const src = sessionStoryMedia[st.id] || st.storage_path;
    if (st.media_type === "video") {
      box.innerHTML = `<video src="${esc(src)}" playsinline autoplay></video>`;
      const vv = box.querySelector("video");
      vv.play().catch(() => {});
      const durMs = ((st.duration_seconds || 15) * 1000);
      animateSvBar(durMs);
      svTimer = setTimeout(nextStory, durMs + 400);
    } else {
      box.innerHTML = `<img src="${esc(src)}" alt="">`;
      animateSvBar(5000);
      svTimer = setTimeout(nextStory, 5000);
    }
    if (me) store.markStorySeen(me.id, st.id).catch(() => {});
  }
  function nextStory() { svIndex++; showStory(); }
  function prevStory() { if (svIndex > 0) { svIndex--; showStory(); } }
  $("#svNext").addEventListener("click", nextStory);
  $("#svPrev").addEventListener("click", prevStory);
  $("#svClose").addEventListener("click", closeStories);

  /* ------------------------------------------------------------ notifications */
  async function refreshNotifDot() {
    if (!me) { $("#notifDot").classList.add("hidden"); return; }
    const ns = await store.notifications(me.id).catch(() => []);
    $("#notifDot").classList.toggle("hidden", !ns.some((n) => !n.is_read));
  }

  async function renderFriends() {
    const box = $("#friendsBox"); if (!box) return;
    if (!me) {
      box.innerHTML = `<div class="empty-state"><div class="big-ico">${icon("users")}</div><h3>${t("nav_friends")}</h3>
        <p class="muted">Log in to see videos from your friends and find people you know.</p>
        <button class="btn btn-primary" id="friendsLogin" style="margin-top:12px">Log in / Sign up</button></div>`;
      $("#friendsLogin").addEventListener("click", showAuth);
      return;
    }
    box.innerHTML = '<p class="muted center" style="padding:20px">Loading…</p>';
    const [people, stats] = await Promise.all([
      store.people(me.id).catch(() => []),
      store.profileStats(me.id, me.id).catch(() => ({ following_count: 0 })),
    ]);
    let feedVids = [];
    if (stats.following_count) {
      const lists = await Promise.all((await store.followList(me.id, "following")).map((u) => store.profileVideos(u.id, me.id).catch(() => [])));
      feedVids = lists.flat().sort((a, b) => (a.published_at < b.published_at ? 1 : -1)).slice(0, 30);
    }
    box.innerHTML = `
      <div id="storiesRail" class="stories-rail"></div>
      <div class="card" style="margin-bottom:14px"><h3 style="margin-bottom:8px">Find friends</h3>
        ${people.length ? people.map((u) => `<div class="list-item" style="border:none;padding:8px 0">${avatarHtml(u, "")}<div class="grow"><div class="t">${esc(u.display_name || u.username)} ${u.verified ? icon("verified") : ""}</div><div class="muted" style="font-size:12.5px">@${esc(u.username)}</div></div><button class="btn btn-ghost" data-friend-open="${u.id}" style="height:38px">View</button></div>`).join("") : '<p class="muted">No suggestions right now.</p>'}
      </div>
      <h3 style="margin:4px 2px 10px">From people you follow</h3>
      ${feedVids.length ? `<div class="video-grid" style="padding:0">${feedVids.map((v) => `<div class="cell">${v.thumbnail_path ? `<img src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}<span class="dur">${icon("play")} ${fmt(v.view_count || 0)}</span></div>`).join("")}</div>`
        : '<p class="muted center" style="padding:16px">Videos from people you follow will appear here.</p>'}`;
    $$("#friendsBox [data-friend-open]").forEach((b) => b.addEventListener("click", () => openProfile(b.dataset.friendOpen)));
    renderStoriesRail();
  }

  async function updateMsgBadge() {
    try {
      const n = me ? await store.unreadMessages(me.id) : 0;
      const b = $("#msgBadge");
      b.textContent = n > 99 ? "99+" : String(n);
      b.classList.toggle("hidden", !n);
    } catch (e) {}
  }

  async function renderNotifications() {
    updateMsgBadge();
    if (!me) return;
    const ns = await store.notifications(me.id).catch(() => []);
    const box = $("#notifList"); box.innerHTML = "";
    $("#notifEmpty").classList.toggle("hidden", ns.length > 0);
    const text = { follow: "started following you", like: "liked your video", comment: "commented on your video", share: "shared a video with you", moderation: "your video review was completed", system: "" };
    ns.forEach((n) => {
      const el = document.createElement("div");
      el.className = "list-item";
      el.innerHTML = `${avatarHtml({ username: n.actor_name, display_name: n.actor_name, avatar_url: n.actor_avatar }, "")}
        <div class="grow"><div class="t" style="font-weight:${n.is_read ? 500 : 700}">@${esc(n.actor_name || "Tokisla")} <span style="font-weight:400">${esc(text[n.type] || "")}</span></div>
        <div class="s">${ago(n.created_at)} ago</div></div>`;
      box.appendChild(el);
    });
    await store.markNotificationsRead(me.id);
    $("#notifDot").classList.add("hidden");
  }

  /* ------------------------------------------------------------ profile */
  let profileTab = "videos";
  async function openProfile(userId) { if (!me && !userId) { needLogin(); return; } goto("profile"); renderProfile(userId || me.id); }
  async function renderProfile(userId) {
    const box = $("#profileBox");
    if (!userId) {
      box.innerHTML = `<div class="guest-profile">
        <div class="guest-logo"><span></span></div>
        <h2>Log in to Tokisla</h2>
        <p class="muted" style="line-height:1.55">Create a free account to like, comment, follow creators, save videos and upload your own — videos stay free to watch without an account.</p>
        <button class="btn btn-primary btn-block" id="guestLoginBtn">Log in / Sign up</button>
        <button class="btn btn-ghost btn-block" id="guestWatchBtn">Continue watching</button>
      </div>`;
      $("#guestLoginBtn").addEventListener("click", showAuth);
      $("#guestWatchBtn").addEventListener("click", () => goto("home"));
      return;
    }
    const p = await store.getProfile(userId).catch(() => null);
    if (!p) { box.innerHTML = '<p class="muted center" style="padding:30px">Profile not found.</p>'; return; }
    const counts = await store.socialCounts(userId);
    const likesTotal = await store.totalLikesReceived(userId).catch(() => 0);
    const mine = me && me.id === userId;
    const following = me && !mine ? await store.isFollowing(me.id, userId) : false;
    box.innerHTML = `
      ${mine ? `<button class="profile-gear" id="profileGearBtn" aria-label="Settings and privacy">${icon("settings")}</button><button class="profile-edit-icon" id="profileEditBtn" aria-label="Edit profile">${icon("edit")}</button>` : ""}
      <div class="profile-head">
        <div class="avatar-wrap">${avatarHtml(p, "")}${mine ? `<button class="avatar-plus" id="avatarPlusBtn" aria-label="Change profile photo">${icon("plus")}</button>` : ""}</div>
        <div class="pname">${esc(p.display_name || p.username)} ${p.verified ? `<span class="verified">${icon("badge")}</span>` : ""}</div>
        <div class="phandle">@${esc(p.username)}</div>
        <p style="max-width:420px">${esc(p.bio || "")}</p>${p.website ? `<a class="profile-link" href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">${icon("link")} ${esc(prettyUrl(p.website))}</a>` : ""}${p.private_account ? `<div class="muted" style="font-size:12.5px">${icon("lock")} Private account</div>` : ""}
        <div class="stats-row">
          <div class="st"><div class="n">${fmt(counts.videos)}</div><div class="l">Videos</div></div>
          <div class="st" id="statFollowers" style="cursor:pointer"><div class="n">${fmt(counts.followers)}</div><div class="l">${t("stat_followers")}</div></div>
          <div class="st" id="statFollowing" style="cursor:pointer"><div class="n">${fmt(counts.following)}</div><div class="l">${t("stat_following")}</div></div>
          <div class="st"><div class="n">${fmt(likesTotal)}</div><div class="l">${t("stat_likes")}</div></div>
        </div>
        ${mine
          ? ``
          : `<div style="display:flex;gap:8px"><button class="btn ${following ? "btn-ghost" : "btn-primary"}" id="followBtn" style="height:44px">${following ? t("prof_following") : t("prof_follow")}</button><button class="btn btn-ghost" id="msgUserBtn" style="height:44px">Message</button><button class="btn btn-ghost" id="userMoreBtn" style="height:44px" aria-label="More options">${icon("more")}</button></div>`}
      </div>
      ${mine ? `<div class="tabs" style="max-width:520px;margin:6px auto"><button class="tab ${profileTab === "videos" ? "active" : ""}" id="ptVideos">${t("tab_videos")}</button><button class="tab ${profileTab === "saved" ? "active" : ""}" id="ptSaved">${t("tab_saved")}</button><button class="tab ${profileTab === "liked" ? "active" : ""}" id="ptLiked">${icon("heart")} ${t("tab_liked")}</button><button class="tab ${profileTab === "locked" ? "active" : ""}" id="ptLocked">${icon("lock")} ${t("tab_locked")}</button></div>` : ""}
      <div class="video-grid" id="profileGrid"></div>`;
    // avatar sizing inside profile head
    const av = box.querySelector(".profile-head .avatar-wrap > img, .profile-head .avatar-wrap > span");
    if (av) { av.style.width = "92px"; av.style.height = "92px"; av.style.borderRadius = "50%"; av.style.fontSize = "30px"; }
    { const sf = $("#statFollowers"), sg = $("#statFollowing");
      if (sf) sf.addEventListener("click", () => followListSheet(userId, "followers"));
      if (sg) sg.addEventListener("click", () => followListSheet(userId, "following")); }
    const grid = $("#profileGrid");
    const vids = mine && profileTab === "saved" ? await store.savedVideos(me.id)
      : mine && profileTab === "liked" ? await store.likedVideos(me.id)
      : mine && profileTab === "locked" ? await store.myPrivateVideos(me.id)
      : await store.profileVideos(userId, me ? me.id : null);
    const emptyText = profileTab === "liked" ? "Videos you like will appear here." : profileTab === "saved" ? "Saved videos will appear here." : profileTab === "locked" ? "Private videos you keep for yourself will appear here. Only you can see them." : "No videos yet.";
    grid.innerHTML = vids.length ? "" : `<p class="muted center" style="grid-column:1/-1;padding:22px">${!mine && p.private_account && !following && profileTab === "videos" ? "This account is private. Follow them to see their videos." : emptyText}</p>`;
    vids.forEach((v) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      const isLockedTab = mine && profileTab === "locked";
      const badge = isLockedTab && v.moderation_status !== "approved"
        ? (v.moderation_status === "rejected" ? "Rejected" : "In review")
        : `${icon("play")} ${fmt(v.view_count || 0)}`;
      cell.innerHTML = `${v.thumbnail_path ? `<img src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}${isLockedTab ? `<span class="lock-badge">${icon("lock")}</span>` : ""}<span class="dur">${badge}</span>`;
      cell.style.cursor = "pointer";
      cell.addEventListener("click", () => { goto("home"); setTimeout(() => { const s = $(`#feed .slide[data-id="${v.id}"]`); if (s) s.scrollIntoView(); else toast("Open the feed to watch."); }, 350); });
      grid.appendChild(cell);
    });
    if (mine) {
      $("#avatarPlusBtn").addEventListener("click", () => { const inp = $("#avatarFile"); if (inp) { inp.value = ""; inp.click(); } });
      $("#profileGearBtn").addEventListener("click", settingsSheet);
      $("#profileEditBtn").addEventListener("click", () => editProfileSheet(p));
      $("#ptVideos").addEventListener("click", () => { profileTab = "videos"; renderProfile(userId); });
      $("#ptSaved").addEventListener("click", () => { profileTab = "saved"; renderProfile(userId); });
      $("#ptLiked").addEventListener("click", () => { profileTab = "liked"; renderProfile(userId); });
      $("#ptLocked").addEventListener("click", () => { profileTab = "locked"; renderProfile(userId); });
    } else {
      $("#followBtn").addEventListener("click", async () => { if (needLogin()) return; await store.toggleFollow(me.id, userId); renderProfile(userId); });
      const mub = $("#msgUserBtn");
      if (mub) mub.addEventListener("click", () => { if (needLogin()) return; goto("messages"); setTimeout(() => openThread(p), 80); });
      $("#userMoreBtn").addEventListener("click", () => {
        openActionSheet("@" + p.username, `
          <button class="menu-row danger" id="umReport"><span class="menu-ico">${icon("flag")}</span> Report this user</button>
          <button class="menu-row danger" id="umBlock"><span class="menu-ico">${icon("ban")}</span> Block this user</button>`);
        $("#umReport").addEventListener("click", () => reportMenu("user", userId));
        $("#umBlock").addEventListener("click", async () => { hideSheets(); if (needLogin()) return; await store.toggleBlock(me.id, userId); toast("User blocked."); goto("home"); });
      });
    }
  }
  function readFileDataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  }
  function shrinkImage(dataUrl, size) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = size; c.height = size;
          const ctx = c.getContext("2d"); if (!ctx) return res(null);
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          res(c.toDataURL("image/jpeg", 0.85));
        } catch (e) { res(null); }
      };
      img.onerror = () => res(null);
      img.src = dataUrl;
    });
  }
  async function applyAvatarFile(file) {
    if (!me) return;
    if (!file.type || file.type.indexOf("image/") !== 0) { toast("Please choose an image."); return; }
    try {
      let url = await readFileDataUrl(file);
      if (file.size > 400 * 1024) {
        const small = await shrinkImage(url, 256);
        if (small) url = small;
        else if (file.size > 2 * 1024 * 1024) { toast("Photo is too large — please choose a smaller one."); return; }
      }
      me = await store.updateProfile(me.id, { avatar_url: url });
      store.logEvent(me.id, "Profile photo updated", "");
      toast("Profile photo updated.");
      renderProfile(me.id);
    } catch (e) { toast((e && e.message) || "Could not update the photo."); }
  }
  function editProfileSheet(p) {
    openActionSheet(t("prof_edit"), `
      <div class="field"><label>Username (handle)</label><div class="handle-input"><span>@</span><input id="epUsername" value="${esc(p.username || "")}" maxlength="24" style="flex:1"></div><p class="muted" style="font-size:12px;margin-top:4px">3-24 characters: letters, numbers, dot or underscore.</p></div>
      <div class="field"><label>Display name</label><input id="epName" value="${esc(p.display_name || "")}" maxlength="60"></div>
      <div class="field"><label>Bio</label><textarea id="epBio" rows="3" maxlength="160">${esc(p.bio || "")}</textarea></div>
      <div class="field"><label>Link (website or social)</label><input id="epWebsite" value="${esc(p.website || "")}" placeholder="youtube.com/@you" maxlength="200"></div>
      <div class="field"><label>Avatar image URL (optional)</label><input id="epAvatar" value="${esc(p.avatar_url || "")}" placeholder="https://\u2026"></div>
      <button class="btn btn-primary btn-block" id="epSave">Save changes</button>`);
    $("#epSave").addEventListener("click", async () => {
      try {
        me = await store.updateProfile(me.id, { username: $("#epUsername").value, display_name: $("#epName").value, bio: $("#epBio").value, website: $("#epWebsite").value, avatar_url: $("#epAvatar").value });
        store.logEvent(me.id, "Profile updated", "");
        hideSheets(); toast("Profile updated."); renderProfile(me.id);
      } catch (e) { toast(e.message); }
    });
  }

  /* ------------------------------------------------------------ settings & pages */
  const GUIDELINES = `<p><b>Welcome to Tokisla.</b> We keep this a positive, family-friendly place:</p>
    <ul style="line-height:1.55;padding-left:18px">
      <li>Videos are max <b>20 seconds</b>.</li>
      <li><b>No music or songs</b> in videos. Voice, recitation, nasheed-style vocals without instruments as per community standards, and natural sounds are welcome.</li>
      <li>No inappropriate, explicit or suggestive content.</li>
      <li>No abuse, harassment, hate or personal attacks.</li>
      <li>No spam, scams, misleading or dangerous content.</li>
      <li>No impersonation of other people or organisations.</li>
      <li>Respect Islam, the Quran, the Prophet ﷺ, all Prophets, scholars and every religion — no disrespect or mockery.</li>
      <li>Every video is reviewed by our moderation team before it appears publicly.</li>
    </ul><p class="muted">Breaking the rules can lead to removal, restricted features, suspension or a permanent ban. You may appeal any decision from the app.</p>`;
  const TERMS = `<div style="line-height:1.65">
  <p><b>1. Your account.</b> You must be at least 13 years old to use Tokisla. You are responsible for your account, your password and everything posted through it. One person, one account — impersonation is not allowed.</p>
  <p><b>2. Your content.</b> You keep ownership of the videos you upload. By uploading, you give Tokisla permission to store, process and show your video inside the app so other users can watch it. Only upload content you created or have clear permission to share.</p>
  <p><b>3. Moderation.</b> Every upload is reviewed by a human moderator before it becomes public. We may reject, remove or limit any content that breaks the Community Guidelines, and we may suspend accounts that break the rules repeatedly.</p>
  <p><b>4. Video rules.</b> Videos must be 20 seconds or shorter. Content must follow the Community Guidelines at all times, including the no-music policy.</p>
  <p><b>5. Acceptable use.</b> Do not use Tokisla for spam, scams, harassment, illegal activity, or to collect other users' data. Do not try to break, overload or reverse-engineer the service.</p>
  <p><b>6. Availability.</b> Tokisla is provided "as is". Features may change, and the service may be interrupted for maintenance or reasons beyond our control. We are not liable for indirect losses arising from use of the service, to the maximum extent allowed by law.</p>
  <p><b>7. Ending your account.</b> You may delete your account at any time from Settings and privacy. We may suspend or end accounts that seriously or repeatedly violate these terms.</p>
  <p><b>8. Changes.</b> If these terms change in an important way, we will note the change in the app. Continuing to use Tokisla after a change means you accept the new terms.</p>
  <p class="muted">Questions about these terms: use the contact option on the Tokisla website.</p></div>`;
  const PRIVACY = `<div style="line-height:1.65">
  <p><b>What we collect.</b></p>
  <ul style="margin:4px 0 10px;padding-inline-start:20px"><li><b>Account:</b> your email address, username, display name, bio and profile photo.</li>
  <li><b>Content:</b> videos you upload, comments, likes, saves, follows, reports and blocks.</li>
  <li><b>Activity:</b> your watch history, search history and account history — these are private to you and exist so the Activity center can show them to you.</li>
  <li><b>Technical:</b> basic device and app information needed to run and secure the service.</li></ul>
  <p><b>How we use it.</b> To run your account, show your content, moderate uploads for safety, prevent abuse, and improve the app. We do not sell your personal data, and we do not show your email address to anyone — it is never public.</p>
  <p><b>Who can see what.</b> Your profile and approved public videos are visible to other users according to your privacy settings (private account, Locked videos and the Allow options in Settings). Your histories, settings and email are visible only to you. Moderators see uploads and reports in order to review them.</p>
  <p><b>Sharing.</b> We share data only with the service providers needed to run Tokisla (hosting and storage), or when the law requires it.</p>
  <p><b>Your choices.</b> You can edit your profile, change who can interact with you, block users, and delete your account at any time from Settings and privacy. Deleting your account removes your profile, videos, comments and histories.</p>
  <p><b>Children.</b> Tokisla is not for children under 13.</p>
  <p><b>Changes.</b> If this policy changes in an important way, we will note the change in the app.</p></div>`;

  async function settingsSheet() {
    const allow = me ? await store.getAllowPrefs(me.id).catch(() => null) : null;
    const val = (k) => { const v = allow ? allow[k] : "everyone"; return v === "everyone" ? "Everyone" : v === "followers" ? "Followers" : v === "nobody" ? "No one" : "Only me"; };
    const aRow = (id, ic, labelKey, key) => `<button class="menu-row" id="${id}"><span class="menu-ico">${icon(ic)}</span><span style="flex:1;text-align:start">${t(labelKey)}</span><span class="muted" style="font-size:13px">${val(key)}</span></button>`;
    const themeNow = document.documentElement.dataset.theme === "dark" ? t("disp_dark") : t("disp_light");
    openActionSheet(t("set_title"), `
      <button class="menu-row" id="stStudio"><span class="menu-ico">${icon("chart")}</span> ${t("set_studio")}</button>
      <button class="menu-row" id="stActivity"><span class="menu-ico">${icon("activity")}</span> ${t("set_activity")}</button>
      <button class="menu-row" id="stAccount"><span class="menu-ico">${icon("user")}</span> ${t("set_account")}</button>
      <button class="menu-row" id="stShareProfile"><span class="menu-ico">${icon("share")}</span> ${t("set_share")}</button>
      <button class="menu-row" id="stVerify"><span class="menu-ico" style="color:#38bdf8">${icon("badge")}</span><span style="flex:1;text-align:start">Apply for blue tick</span><span class="muted" style="font-size:13px">Rs 300/month</span></button>
      <button class="menu-row" id="stDisplay"><span class="menu-ico">${icon("sun")}</span><span style="flex:1;text-align:start">${t("set_display")}</span><span class="muted" style="font-size:13px">${themeNow}</span></button>
      <button class="menu-row" id="stLanguage"><span class="menu-ico">${icon("globe")}</span><span style="flex:1;text-align:start">${t("set_language")}</span><span class="muted" style="font-size:13px">${lang === "ur" ? "اردو" : "English"}</span></button>
      <div class="share-sec">Privacy</div>
      <button class="menu-row" id="stPrivate"><span class="menu-ico">${icon("lock")}</span><span style="flex:1;text-align:start">${t("set_private")}</span><span class="switch ${me && me.private_account ? "on" : ""}"><span class="knob"></span></span></button>
      <div class="share-sec">${t("allow_title")}</div>
      ${aRow("stAllowComment", "comment", "allow_comments", "allow_comment")}
      ${aRow("stAllowMention", "at", "allow_mentions", "allow_mention")}
      ${aRow("stAllowLike", "heart", "allow_likes", "allow_like")}
      ${aRow("stAllowDownload", "download", "allow_downloads", "allow_download")}
      ${aRow("stAllowFollowList", "users", "allow_followlist", "view_follow_list")}
      <button class="menu-row" id="stBlocked"><span class="menu-ico">${icon("ban")}</span> ${t("set_blocked")}</button>
      <div class="share-sec">About</div>
      <button class="menu-row" id="stGuidelines"><span class="menu-ico">${icon("shield")}</span> ${t("set_guidelines")}</button>
      <button class="menu-row" id="stTerms"><span class="menu-ico">${icon("file")}</span> ${t("set_terms")}</button>
      <button class="menu-row" id="stPrivacy"><span class="menu-ico">${icon("lock")}</span> ${t("set_privacy")}</button>
      <button class="menu-row danger" id="stDelete"><span class="menu-ico">${icon("trash")}</span> ${t("set_delete")}</button>
      <button class="btn btn-ghost" id="stLogout" style="width:100%;height:48px;margin-top:16px">${icon("logout")} ${t("set_logout")}</button>`);
    $("#stStudio").addEventListener("click", studioSheet);
    $("#stActivity").addEventListener("click", activityCenterSheet);
    $("#stAccount").addEventListener("click", accountSheet);
    $("#stShareProfile").addEventListener("click", profileShareSheet);
    $("#stVerify").addEventListener("click", verifySheet);
    $("#stDisplay").addEventListener("click", displaySheet);
    $("#stLanguage").addEventListener("click", languageSheet);
    $("#stPrivate").addEventListener("click", async () => {
      const on = !(me && me.private_account);
      try { await store.setPrivateAccount(me.id, on); me.private_account = on; toast(on ? "Your account is now private." : "Your account is now public."); }
      catch (e) { toast(e.message); }
      settingsSheet();
    });
    const allowBind = (id, key, labelKey, opts) => { const el = $(id); if (el) el.addEventListener("click", () => allowOptionSheet(key, labelKey, opts)); };
    allowBind("#stAllowComment", "allow_comment", "allow_comments");
    allowBind("#stAllowMention", "allow_mention", "allow_mentions");
    allowBind("#stAllowLike", "allow_like", "allow_likes");
    allowBind("#stAllowDownload", "allow_download", "allow_downloads");
    allowBind("#stAllowFollowList", "view_follow_list", "allow_followlist", ["everyone", "onlyme"]);
    $("#stGuidelines").addEventListener("click", () => openActionSheet(t("set_guidelines"), GUIDELINES));
    $("#stTerms").addEventListener("click", () => openActionSheet(t("set_terms"), TERMS));
    $("#stPrivacy").addEventListener("click", () => openActionSheet(t("set_privacy"), PRIVACY));
    $("#stBlocked").addEventListener("click", async () => {
      const list = await store.blockedList(me.id);
      openActionSheet(t("set_blocked"), list.length
        ? list.map((u) => `<div class="list-item">${avatarHtml(u, "")}<div class="grow"><div class="t">${esc(u.display_name || u.username)} ${u.verified ? icon("verified") : ""}</div><div class="muted" style="font-size:12.5px">@${esc(u.username)}${u.blocked_at ? " · Blocked " + fmtWhen(u.blocked_at) : ""}</div></div><button class="btn btn-ghost" data-unblock="${u.id}" style="height:38px">Unblock</button></div>`).join("")
        : '<p class="muted center" style="padding:14px">You have not blocked anyone.</p>');
      $$("[data-unblock]").forEach((b) => b.addEventListener("click", async () => { await store.toggleBlock(me.id, b.dataset.unblock); hideSheets(); toast("Unblocked."); }));
    });
    $("#stLogout").addEventListener("click", async () => { try { await store.logEvent(me.id, "Logged out", ""); } catch (e) {} await store.logOut(); me = null; likedSet = new Set(); savedSet = new Set(); hideSheets(); toast("Logged out. You can keep watching as a guest."); enterApp(); });
    $("#stDelete").addEventListener("click", () => {
      openActionSheet("Delete account", `<p style="line-height:1.55">This permanently deletes your profile, videos, comments and followers. This cannot be undone.</p>
        <button class="btn btn-danger btn-block" id="confirmDelete">Yes, delete my account</button>`);
      $("#confirmDelete").addEventListener("click", async () => {
        try { await store.deleteAccount(me.id); me = null; likedSet = new Set(); savedSet = new Set(); hideSheets(); toast("Your account has been deleted."); enterApp(); }
        catch (ex) { toast(ex.message); }
      });
    });
  }

  function displaySheet() {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    openActionSheet(t("set_display"), `
      <button class="menu-row" data-theme-opt="light"><span class="menu-ico">${icon("sun")}</span><span style="flex:1;text-align:start">${t("disp_light")}</span>${cur === "light" ? icon("check") : ""}</button>
      <button class="menu-row" data-theme-opt="dark"><span class="menu-ico">${icon("moon")}</span><span style="flex:1;text-align:start">${t("disp_dark")}</span>${cur === "dark" ? icon("check") : ""}</button>`);
    $$("[data-theme-opt]").forEach((b) => b.addEventListener("click", () => {
      try { localStorage.setItem("tokisla_theme", b.dataset.themeOpt); } catch (e) {}
      applyTheme(); toast(b.dataset.themeOpt === "dark" ? "Dark display on." : "Light display on."); settingsSheet();
    }));
  }

  function languageSheet() {
    openActionSheet(t("set_language"), `
      <button class="menu-row" data-lang-opt="en"><span class="menu-ico">${icon("globe")}</span><span style="flex:1;text-align:start">English</span>${lang === "en" ? icon("check") : ""}</button>
      <button class="menu-row" data-lang-opt="ur"><span class="menu-ico">${icon("globe")}</span><span style="flex:1;text-align:start">اردو (Urdu)</span>${lang === "ur" ? icon("check") : ""}</button>
      <p class="muted" style="padding:10px 4px;font-size:12.5px">Urdu switches the main menus, headings and settings. Video captions and comments stay in the language they were written in.</p>`);
    $$("[data-lang-opt]").forEach((b) => b.addEventListener("click", () => {
      lang = b.dataset.langOpt;
      try { localStorage.setItem("tokisla_lang", lang); } catch (e) {}
      applyLanguage(); settingsSheet();
      if (currentView === "profile") renderProfile(me ? me.id : null);
      toast(lang === "ur" ? "زبان اردو کر دی گئی ہے۔" : "Language set to English.");
    }));
  }

  async function allowOptionSheet(key, labelKey, opts) {
    const options = opts || ["everyone", "followers", "nobody"];
    const label = (v) => v === "everyone" ? "Everyone" : v === "followers" ? "Followers" : v === "nobody" ? "No one" : "Only me";
    const cur = (await store.getAllowPrefs(me.id))[key];
    openActionSheet(t(labelKey), options.map((v) => `<button class="menu-row" data-allow-opt="${v}"><span style="flex:1;text-align:start">${label(v)}</span>${cur === v ? icon("check") : ""}</button>`).join(""));
    $$("[data-allow-opt]").forEach((b) => b.addEventListener("click", async () => {
      await store.setAllowPref(me.id, key, b.dataset.allowOpt);
      toast("Saved: " + label(b.dataset.allowOpt)); settingsSheet();
    }));
  }

  async function studioSheet() {
    openActionSheet(t("set_studio"), '<p class="muted center" style="padding:18px">Loading your analytics…</p>');
    const [stats, trend] = await Promise.all([store.creatorStats(me.id).catch(() => null), store.trending().catch(() => [])]);
    if (!stats) { openActionSheet(t("set_studio"), '<p class="muted center" style="padding:18px">Analytics are not available right now.</p>'); return; }
    const top = stats.videos[0];
    openActionSheet(t("set_studio"), `
      <div class="studio-grid">
        <div class="studio-card"><div class="studio-num">${fmt(stats.totalViews)}</div><div class="studio-label">Total views</div></div>
        <div class="studio-card"><div class="studio-num">${fmt(stats.totalLikes)}</div><div class="studio-label">Total likes</div></div>
        <div class="studio-card"><div class="studio-num">${fmt(stats.totalComments)}</div><div class="studio-label">Comments</div></div>
        <div class="studio-card"><div class="studio-num">${fmt(stats.followers)}</div><div class="studio-label">Followers</div></div>
      </div>
      ${top ? `<div class="share-sec">Your most popular video</div>
      <div class="list-item">${top.thumbnail_path ? `<img class="thumb" src="${esc(sessionUploads[top.id] || top.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(top.caption || "")}</div><div class="muted" style="font-size:12.5px">${icon("play")} ${fmt(top.view_count || 0)} · ${icon("heart")} ${fmt(top.like_count || 0)} · ${icon("comment")} ${fmt(top.comment_count || 0)}</div></div></div>` : ""}
      <div class="share-sec">Your videos (${stats.videoCount})</div>
      ${stats.videos.length ? stats.videos.map((v) => `<div class="list-item">${v.thumbnail_path ? `<img class="thumb" src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(v.caption || "")}</div><div class="muted" style="font-size:12.5px">${icon("play")} ${fmt(v.view_count || 0)} views · ${icon("heart")} ${fmt(v.like_count || 0)} · ${icon("comment")} ${fmt(v.comment_count || 0)}</div></div></div>`).join("") : '<p class="muted center" style="padding:12px">Upload a video and its numbers will appear here.</p>'}
      <div class="share-sec">Trending on Tokisla</div>
      ${trend.length ? trend.map((v, i) => `<div class="list-item"><span class="rank-badge">${i + 1}</span>${v.thumbnail_path ? `<img class="thumb" src="${esc(v.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(v.caption || "")}</div><div class="muted" style="font-size:12.5px">@${esc(v.username)} · ${icon("heart")} ${fmt(v.like_count || 0)} · ${icon("play")} ${fmt(v.view_count || 0)}</div></div></div>`).join("") : '<p class="muted center" style="padding:12px">Nothing trending yet.</p>'}`);
  }

  async function activityCenterSheet() {
    openActionSheet(t("set_activity"), `
      <div class="ac-chips">
        <button class="ac-chip active" data-ac="watch">Watch history</button>
        <button class="ac-chip" data-ac="comments">Comment history</button>
        <button class="ac-chip" data-ac="search">Search history</button>
        <button class="ac-chip" data-ac="account">Account history</button>
      </div><div id="acList"><p class="muted center" style="padding:16px">Loading…</p></div>`);
    const load = async (tab) => {
      const box = $("#acList"); if (!box) return;
      box.innerHTML = '<p class="muted center" style="padding:16px">Loading…</p>';
      if (tab === "watch") {
        const list = await store.myWatchHistory(me.id).catch(() => []);
        box.innerHTML = list.length ? list.map((v) => `<div class="ac-row">${v.thumbnail_path ? `<img class="ac-thumb" src="${esc(sessionUploads[v.id] || v.thumbnail_path)}" alt="">` : ""}<div class="grow"><div class="t" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(v.caption || "")}</div><div class="muted" style="font-size:12.5px">@${esc(v.username)} · Watched ${fmtWhen(v.watched_at)}</div></div></div>`).join("") : '<p class="muted center" style="padding:16px">Videos you watch will appear here.</p>';
      } else if (tab === "comments") {
        const list = await store.myComments(me.id).catch(() => []);
        box.innerHTML = list.length ? list.map((c) => `<div class="ac-row">${c.video_thumbnail ? `<img class="ac-thumb" src="${esc(c.video_thumbnail)}" alt="">` : ""}<div class="grow"><div class="cb" style="font-size:14px">${esc(c.body)}</div><div class="muted" style="font-size:12.5px">On @${esc(c.video_creator || "")}'s video · ${fmtWhenTime(c.created_at)}</div></div></div>`).join("") : '<p class="muted center" style="padding:16px">Comments you write will appear here.</p>';
      } else if (tab === "search") {
        const list = getSearchHist();
        box.innerHTML = (list.length ? list.map((x) => `<div class="ac-row"><span class="menu-ico">${icon("search")}</span><div class="grow"><div style="font-size:14.5px">${esc(x.q)}</div><div class="muted" style="font-size:12.5px">${fmtWhenTime(x.at)}</div></div></div>`).join("") : '<p class="muted center" style="padding:16px">Your searches will appear here.</p>')
          + (list.length ? '<button class="btn btn-ghost btn-block" id="acClearSearch" style="margin-top:12px">Clear search history</button>' : "");
        const clr = $("#acClearSearch");
        if (clr) clr.addEventListener("click", () => { try { localStorage.removeItem(searchHistKey()); } catch (e) {} load("search"); toast("Search history cleared."); });
      } else {
        const list = await store.myEvents(me.id).catch(() => []);
        box.innerHTML = list.length ? list.map((e) => `<div class="ac-row"><span class="ac-dot"></span><div class="grow"><div style="font-size:14.5px;font-weight:600">${esc(e.type)}</div>${e.detail ? `<div class="muted" style="font-size:12.5px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${esc(e.detail)}</div>` : ""}<div class="muted" style="font-size:12.5px">${fmtWhenTime(e.at || e.created_at)}</div></div></div>`).join("") : '<p class="muted center" style="padding:16px">Your account activity will appear here.</p>';
      }
    };
    $$("[data-ac]").forEach((b) => b.addEventListener("click", () => { $$("[data-ac]").forEach((x) => x.classList.toggle("active", x === b)); load(b.dataset.ac); }));
    load("watch");
  }

  async function accountSheet() {
    const a = await store.accountDetails(me.id).catch(() => null);
    if (!a) { toast("Account details are not available."); return; }
    openActionSheet(t("set_account"), `
      <div class="list-item" style="margin-bottom:10px">${avatarHtml(a, "")}<div class="grow"><div class="t">${esc(a.display_name || a.username)} ${a.verified ? icon("verified") : ""}</div><div class="muted" style="font-size:12.5px">@${esc(a.username)}</div></div></div>
      <div class="ac-row"><span class="menu-ico">${icon("mail")}</span><div class="grow"><div class="muted" style="font-size:12px">Email</div><div style="font-size:14.5px">${esc(a.email || "—")}</div></div></div>
      <div class="ac-row"><span class="menu-ico">${icon("calendar")}</span><div class="grow"><div class="muted" style="font-size:12px">Account created</div><div style="font-size:14.5px">${a.created_at ? fmtWhen(a.created_at) : "—"}</div></div></div>
      <div class="ac-row"><span class="menu-ico">${icon("shield")}</span><div class="grow"><div class="muted" style="font-size:12px">Account status</div><div style="font-size:14.5px">${a.is_suspended ? "Suspended" : "Active"}</div></div></div>
      <div class="ac-row"><span class="menu-ico">${icon("lock")}</span><div class="grow"><div class="muted" style="font-size:12px">Private account</div><div style="font-size:14.5px">${a.private_account ? "On" : "Off"}</div></div></div>
      <p class="muted" style="padding:10px 4px;font-size:12.5px">Your email is private — it is never shown on your profile or to other users.</p>
      <button class="btn btn-ghost btn-block" id="acctEdit">Edit profile</button>`);
    $("#acctEdit").addEventListener("click", () => editProfileSheet(a));
  }

  function profileShareSheet() {
    const link = "https://tokisla.app/@" + me.username;
    openActionSheet(t("set_share"), `
      <button class="menu-row" id="psCopy"><span class="menu-ico">${icon("link")}</span> Copy profile link</button>
      <button class="menu-row" id="psApps"><span class="menu-ico">${icon("share")}</span> Share via other apps</button>
      <p class="muted center" style="padding:8px;font-size:12.5px">${esc(link)}</p>`);
    $("#psCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); toast("Profile link copied."); } catch (e) { toast(link); } hideSheets(); });
    $("#psApps").addEventListener("click", async () => {
      hideSheets();
      if (navigator.share) { try { await navigator.share({ title: "Tokisla", text: "Follow @" + me.username + " on Tokisla", url: link }); } catch (e) {} }
      else { try { await navigator.clipboard.writeText(link); toast("Profile link copied."); } catch (e) { toast(link); } }
    });
  }

  async function verifySheet() {
    if (me.verified) {
      openActionSheet("Blue tick", `<div class="center" style="padding:10px 0 4px"><span class="verified" style="font-size:44px">${icon("badge")}</span>
        <h3 style="margin:8px 0 4px">Your blue tick is active</h3>
        <p class="muted" style="line-height:1.55">The blue tick shows next to your name across Tokisla. Your plan renews at Rs 300/month — we will remind you before it ends.</p></div>`);
      return;
    }
    const req = await store.myVerification(me.id).catch(() => null);
    if (req && req.status === "pending") {
      openActionSheet("Blue tick", `<div class="center" style="padding:10px 0 4px"><span class="verified" style="font-size:44px">${icon("badge")}</span>
        <h3 style="margin:8px 0 4px">Application under review</h3>
        <p class="muted" style="line-height:1.55">Name: ${esc(req.full_name || "")}<br>Category: ${esc(req.category || "Creator")}<br>Payment: ${esc(req.method || "JazzCash")} · TID ${esc(req.tid || req.payment_tid || "")}<br><br>Our team checks the payment and your profile. The tick appears as soon as you are approved.</p></div>`);
      return;
    }
    openActionSheet("Apply for blue tick", `
      <div class="studio-card center" style="margin-bottom:12px"><div class="muted" style="font-size:13px">Blue tick subscription</div>
        <div style="font-size:30px;font-weight:800;color:var(--emerald-dark)">Rs 300<span style="font-size:15px;font-weight:600">/month</span></div>
        <div class="muted" style="font-size:12.5px">Blue tick next to your name · more trust · priority in search</div></div>
      ${req && req.status === "rejected" ? '<p class="muted" style="padding:0 2px 8px">Your last application was not approved. You can apply again below.</p>' : ""}
      <div class="field"><label>Full name</label><input id="vfName" maxlength="80" placeholder="Your real name"></div>
      <div class="field"><label>Category</label><select id="vfCategory"><option>Creator</option><option>Religious scholar</option><option>Business</option><option>Organisation</option><option>Other</option></select></div>
      <div class="field"><label>Payment method</label><select id="vfMethod"><option>JazzCash</option><option>Easypaisa</option></select></div>
      <div class="field"><label>Transaction ID (TID)</label><input id="vfTid" maxlength="40" placeholder="TID from your payment"></div>
      <div class="field"><label>Note (optional)</label><textarea id="vfNote" rows="2" maxlength="300" placeholder="Anything we should know"></textarea></div>
      <p class="muted" style="font-size:12.5px;line-height:1.55;padding:2px">Send Rs 300 by JazzCash or Easypaisa to the Tokisla account number the admin shares with you, then enter the Transaction ID here. Your application is reviewed by our team.</p>
      <button class="btn btn-primary btn-block" id="vfSubmit">Pay Rs 300 &amp; apply</button>`);
    $("#vfSubmit").addEventListener("click", async () => {
      try {
        await store.applyForVerification(me.id, { full_name: $("#vfName").value, category: $("#vfCategory").value, method: $("#vfMethod").value, tid: $("#vfTid").value, note: $("#vfNote").value });
        toast("Application sent — under review.");
        verifySheet();
      } catch (e) { toast(e.message); }
    });
  }

  async function followListSheet(userId, kind) {
    const title = kind === "followers" ? t("stat_followers") : t("stat_following");
    if (!me || me.id !== userId) {
      const pr = await store.getAllowPrefs(userId).catch(() => null);
      if (pr && pr.view_follow_list === "onlyme") { openActionSheet(title, `<p class="muted center" style="padding:18px">${icon("lock")} This list is private.</p>`); return; }
    }
    openActionSheet(title, '<p class="muted center" style="padding:16px">Loading…</p>');
    const list = await store.followList(userId, kind).catch(() => []);
    openActionSheet(title, list.length
      ? list.map((u) => `<div class="list-item">${avatarHtml(u, "")}<div class="grow"><div class="t">${esc(u.display_name || u.username)} ${u.verified ? icon("verified") : ""}</div><div class="muted" style="font-size:12.5px">@${esc(u.username)}</div></div><button class="btn btn-ghost" data-open-user="${u.id}" style="height:38px">View</button></div>`).join("")
      : '<p class="muted center" style="padding:16px">Nobody here yet.</p>');
    $$("[data-open-user]").forEach((b) => b.addEventListener("click", () => { hideSheets(); openProfile(b.dataset.openUser); }));
  }

  /* ------------------------------------------------------------ sheets wiring */
  $("#sheetBackdrop").addEventListener("click", hideSheets);
  $$("[data-close-sheet]").forEach((b) => b.addEventListener("click", hideSheets));

  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAllVideos(); });

  boot();
})();
