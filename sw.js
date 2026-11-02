/* Tokisla service worker — caches the app shell so the PWA opens fast and
   works on flaky connections. Video files and API calls are never cached. */
const CACHE = "tokisla-shell-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./store.js", "./app.js",
  "./manifest.webmanifest", "./assets/branding/icon-192.png", "./assets/branding/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.endsWith(".mp4") || url.hostname.includes("supabase")) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
