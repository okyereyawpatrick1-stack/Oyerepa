const CACHE_NAME = "oyp-v3";
const ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/store.js",
  "/js/config.local.js",
  "/js/africastalking.js",
  "/js/bmsafrica.js",
  "/js/hellio.js",
  "/js/arkesel.js",
  "/js/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.jpeg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var clone = resp.clone();
      caches.open(CACHE_NAME).then(function (c) { c.put(e.request, clone); });
      return resp;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});