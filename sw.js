/**
 * GeoFoto Lahan — Service Worker
 * Menyimpan tampilan aplikasi di HP agar tetap bisa dibuka di lapangan tanpa sinyal.
 *  - File aplikasi sendiri  : network-first (selalu versi terbaru bila online)
 *  - Pustaka CDN & font     : cache-first
 *  - Apps Script & tile peta: tidak disentuh (langsung ke internet)
 * Naikkan VERSI_CACHE setiap kali mengubah daftar file di bawah.
 */
const VERSI_CACHE = 'geofoto-v3.1.0';

const FILE_APLIKASI = [
  './',
  'index.html',
  'css/style.css',
  'js/config.js',
  'js/api.js',
  'js/app.js',
  'manifest.json',
  'img/icon-192.png',
  'img/icon-512.png'
];

const FILE_CDN = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
];

const HOST_CACHE_FIRST = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSI_CACHE);
    // Satu per satu: bila satu file gagal, yang lain tetap tersimpan
    await Promise.all(FILE_APLIKASI.concat(FILE_CDN).map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const semua = await caches.keys();
    await Promise.all(semua.filter(k => k !== VERSI_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST ke Apps Script: biarkan
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (HOST_CACHE_FIRST.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
  // Selain itu (script.google.com, tile peta, dll.) langsung ke internet
});

async function networkFirst(req) {
  const cache = await caches.open(VERSI_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const tersimpan = await cache.match(req, { ignoreSearch: true });
    if (tersimpan) return tersimpan;
    if (req.mode === 'navigate') {
      const halaman = await cache.match('index.html');
      if (halaman) return halaman;
    }
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSI_CACHE);
  const tersimpan = await cache.match(req);
  if (tersimpan) return tersimpan;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
