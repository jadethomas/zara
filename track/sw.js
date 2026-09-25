/* Service worker for /track — the app shell must open with no internet.
 * Bump VERSION whenever any shell file changes, or installed phones keep
 * running the old app. (_headers serves this file no-cache so the browser
 * re-checks it on every load; the shell files are what get versioned.) */
const VERSION = "v4";
const CACHE = `zara-track-${VERSION}`;
const SHELL = [
  "/track/",
  "/track/app.css",
  "/track/app.js",
  "/track/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/favicon.svg",
];

self.addEventListener("install", (e) => {
  // cache:"reload" forces install fetches past the browser HTTP cache —
  // without it a version bump can precache the very files it meant to replace.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never touch the API: sync logic owns those requests and must see real
  // network state (including Access redirects) — a cached API response would
  // lie about what synced.
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Opening the app: network first so updates and Access re-auth happen when
  // online, cached shell when not.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/track/")));
    return;
  }

  // Shell assets: cache first. VERSION controls freshness.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
