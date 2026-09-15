const CACHE = 'ventas-v1';
const ARCHIVOS = ['./index.html', './manifest.json', '../shared/api.js', '../shared/estilos.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Solo cachea el "shell" estático de la app. Las llamadas a la API del
// Worker siempre van directo a la red (nunca deben servirse desde caché).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar llamadas a la API
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
