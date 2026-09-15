const CACHE = 'ventas-v12';
const ARCHIVOS = ['./index.html', './manifest.json', '../shared/api.js', '../shared/estilos.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Solo borra cachés viejas de ESTA app (prefijo "ventas-"). Antes se
  // borraba cualquier caché que no fuera la actual, incluida la de Cocina
  // ("cocina-vX"), porque caches.keys() devuelve TODAS las cachés del mismo
  // origen, no solo las de esta app.
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k.startsWith('ventas-')).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// "Network-first": siempre intenta traer la versión más nueva del shell
// estático de la app. Solo usa la copia en caché si no hay conexión (para
// que la app siga abriendo sin internet). Así, cada vez que se publica una
// actualización, el dispositivo la ve de inmediato en vez de quedarse con
// una versión vieja guardada.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar llamadas a la API
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
