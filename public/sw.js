/* Café Reza — minimal service worker (installability + static cache).
   Only same-origin GET requests are cached. Firestore / Auth calls are
   cross-origin, so they always go to the network and are never cached.
   The menu works offline: the app shell is cached at install, product
   images are cached on first load (cache-first below), and the last
   good catalog is saved to localStorage by the app (see useCatalog).
   Orders and checkout are never cached — they need the network. */
const CACHE = "cafe-reza-v2";
const SHELL = ["/", "/index.html", "/img/logo.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // SPA navigations: network first, fall back to the cached shell.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  // Product/menu images: cache-first — the menu must render when the
  // network is slow or gone. A cached image is served at once and
  // refreshed in the background when the network answers.
  if (url.pathname.startsWith("/img/")) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
  // Static assets: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
