"""PWA Web Manifest and Offline App-Shell Service Worker for PocketWMS."""
import json

MANIFEST_JSON = json.dumps(
    {
        "name": "PocketWMS - KhoThôngMinh",
        "short_name": "PocketWMS",
        "description": "Quản lý Kho Di động & Lưu tạm Offline tự động đồng bộ",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#F8FAFC",
        "theme_color": "#0F766E",
        "icons": [
            {
                "src": "/favicon.ico",
                "sizes": "48x48",
                "type": "image/x-icon",
            }
        ],
    },
    ensure_ascii=False,
    indent=2,
)

SERVICE_WORKER_JS = r"""const CACHE_NAME = "pocketwms-shell-v1.0.2";
const CORE_ASSETS = ["/", "/web/", "/favicon.ico", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(CORE_ASSETS).catch(() => undefined);
        try {
          const res = await fetch("/", { cache: "no-store" });
          if (res && res.ok) {
            await cache.put("/", res.clone());
            const html = await res.text();
            const matches = html.match(/\/(?:_expo|assets)\/[^"'\s)]+/g) || [];
            await Promise.all(
              [...new Set(matches)].map((assetUrl) =>
                cache.add(assetUrl).catch(() => undefined)
              )
            );
          }
        } catch {
          // Ignore precache errors on install
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("pocketwms-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("/")))
    );
    return;
  }

  if (
    url.pathname.startsWith("/_expo/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        });
      })
    );
  }
});
"""
