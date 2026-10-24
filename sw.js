// Service worker : rend le site utilisable hors connexion.
// Changer VERSION à chaque mise à jour importante pour renouveler le cache de base.
const VERSION = "v1";
const CORE = "core-" + VERSION;
const LIBS = "libs-v1";
const TILES = "tiles-v1";
const MAX_TILES = 3000;

const CORE_FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-180.png"];
const LIB_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore-compat.js",
];

// Vue d'ensemble du Vietnam (zooms 5 à 8, environ 70 tuiles) pour avoir une carte même sans réseau
function overviewTiles() {
  const urls = [];
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
  for (let z = 5; z <= 8; z++) {
    for (let x = lon2x(102, z); x <= lon2x(110, z); x++) {
      for (let y = lat2y(23.5, z); y <= lat2y(8.4, z); y++) urls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
    }
  }
  return urls;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await (await caches.open(CORE)).addAll(CORE_FILES);
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map((u) => libs.add(new Request(u, { mode: "no-cors" })).catch(() => {})));
    const tiles = await caches.open(TILES);
    await Promise.all(overviewTiles().map(async (u) => {
      if (await tiles.match(u)) return;
      try { const r = await fetch(u, { mode: "cors" }); if (r.ok) await tiles.put(u, r); } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [CORE, LIBS, TILES];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

// Réseau d'abord (contenu à jour), cache en secours
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
  }
}

// Cache d'abord (bibliothèques, polices, tuiles), réseau sinon
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") {
      await cache.put(req, res.clone());
      if (cacheName === TILES && Math.random() < 0.05) trimTiles();
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firestore gère lui-même son cache hors connexion
  if (url.hostname.endsWith("googleapis.com") && url.hostname !== "fonts.googleapis.com") return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, CORE));
  } else if (url.hostname === "tile.openstreetmap.org" || url.hostname === "server.arcgisonline.com") {
    event.respondWith(cacheFirst(req, TILES));
  } else if (["cdnjs.cloudflare.com", "www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    event.respondWith(cacheFirst(req, LIBS));
  }
});
