/* Offline support for the public land map. Keeps the app, the land records and any map tiles
 * the person has viewed or saved, so the map and the "Am I on public land?" check work with no
 * signal. Location never passes through here; the browser reads it on the device. */
var APP_CACHE = 'trpl-camping-app-v1';
var DATA_CACHE = 'trpl-camping-data-v1';
var TILE_CACHE = 'trpl-camping-tiles-v1';
var MAX_TILES = 4000;
var SHELL = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', '../camping.js', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css'];
var DATA = ['../data/lands.json', '../data/sites.json', '../data/roads.json', '../data/counties.json', '../data/meta.json', '../data/conditions.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([
    caches.open(APP_CACHE).then(function (c) { return c.addAll(SHELL); }),
    caches.open(DATA_CACHE).then(function (c) { return c.addAll(DATA); })
  ]).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  var keep = [APP_CACHE, DATA_CACHE, TILE_CACHE];
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('trpl-camping-') === 0 && keep.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheName) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(cacheName).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req, { ignoreSearch: false }); });
}

function trimTiles() {
  return caches.open(TILE_CACHE).then(function (c) {
    return c.keys().then(function (ks) {
      if (ks.length <= MAX_TILES) return;
      return Promise.all(ks.slice(0, ks.length - MAX_TILES).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'basemap.nationalmap.gov') {
    // Map tiles: cache first, then keep what was fetched.
    e.respondWith(caches.open(TILE_CACHE).then(function (c) {
      return c.match(req.url).then(function (hit) {
        return hit || fetch(req.url, { mode: 'cors' }).then(function (res) {
          if (res && res.ok) { c.put(req.url, res.clone()); trimTiles(); }
          return res;
        }).catch(function () { return hit || Response.error(); });
      });
    }));
    return;
  }
  if (url.origin === location.origin && url.pathname.indexOf('/data/') >= 0) { e.respondWith(networkFirst(req, DATA_CACHE)); return; }
  if (url.origin === location.origin) { e.respondWith(networkFirst(req, APP_CACHE)); return; }
  // Live conditions (state fire map, weather): try the network, fall back to the last answer.
  if (/arcgis\.com$|weather\.gov$|open-meteo\.com$/.test(url.hostname)) { e.respondWith(networkFirst(req, DATA_CACHE)); }
});
