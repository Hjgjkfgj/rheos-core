// Rhéos — Service Worker de l'espace collaborateur (PWA).
// Stratégie : cache lecture seule. App shell en cache-first ; lectures /me en
// network-first avec repli cache (offline) ; écritures (POST/PUT/DELETE) jamais
// mises en cache (elles échouent hors ligne, par sécurité).
const CACHE = "rheos-espace-v1";
const SHELL = ["/espace", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  // Ne jamais intercepter/mettre en cache les écritures ni l'authentification.
  if (request.method !== "GET" || url.pathname.startsWith("/api/v1/auth")) return;

  // Lectures des données personnelles : network-first, repli cache.
  if (url.pathname.startsWith("/api/v1/me")) {
    e.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // App shell + statiques : cache-first.
  if (url.pathname === "/espace" || url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg") {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
