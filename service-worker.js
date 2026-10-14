const CACHE_NAME = 'control-gastos-v6';
const APP_SHELL = [
    './',
    './index.html',
    './app.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key.startsWith('control-gastos-') && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                }
                return response;
            })
            .catch(async () => {
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) return cachedResponse;
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                throw new Error(`No hay respuesta disponible sin conexión para ${event.request.url}`);
            })
    );
});
