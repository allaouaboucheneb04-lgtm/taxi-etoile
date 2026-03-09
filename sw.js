const CACHE_NAME = 'taxi-etoile-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/tarifs.html',
  '/services.html',
  '/a-propos.html',
  '/contact.html',
  '/faq.html',
  '/galerie.html',
  '/chauffeurs.html',
  '/politique-confidentialite.html',
  '/conditions.html',
  '/style.css',
  '/main.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// =====================
// INSTALLATION
// =====================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Mise en cache des assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// =====================
// ACTIVATION
// =====================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Suppression cache ancienne version', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// =====================
// FETCH - CACHE FIRST
// =====================
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(cacheRes => {
        return cacheRes || fetch(event.request)
          .then(fetchRes => {
            return caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, fetchRes.clone());
                return fetchRes;
              });
          })
          .catch(() => {
            // fallback pour les pages HTML
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
      })
  );
});
