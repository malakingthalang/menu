/**
 * MALA KING Service Worker
 * Cache-first for static assets, network-first for images and menu
 * Menu is fetched live from Cloudflare Tunnel, with offline fallback
 */

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `mala-static-${CACHE_VERSION}`;
const IMAGE_CACHE  = `mala-images-${CACHE_VERSION}`;
const DATA_CACHE   = `mala-data-${CACHE_VERSION}`;

// Your Cloudflare Tunnel URL for the live menu
const MENU_URL = 'https://malakingthalang.github.io/menu/menu.min.json';

// Static assets to pre-cache on install
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.min.js',
    './config.min.js',
    './css/style.css',
    './malakingtext.webp',
    './fonts/padauk.css',
    './fonts/padauk-myanmar-400-normal.woff2',
    './fonts/padauk-myanmar-700-normal.woff2',
    './fonts/padauk-latin-400-normal.woff2',
    './fonts/padauk-latin-700-normal.woff2'
];

// Install: pre-cache static assets and warm the menu cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => caches.open(DATA_CACHE))
            .then(cache => cache.add(MENU_URL).catch(() => null)) // do not fail install if offline
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    const keep = [STATIC_CACHE, IMAGE_CACHE, DATA_CACHE];
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => !keep.includes(key)).map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Menu JSON from Cloudflare — network-first, cache fallback
    if (url.href === MENU_URL) {
        event.respondWith(
            fetch(request, { cache: 'no-store' })
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(DATA_CACHE).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Skip other cross-origin requests (fonts, CDN)
    if (url.origin !== location.origin) return;

    // Image requests: network-first with cache fallback
    if (url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
        event.respondWith(
            caches.open(IMAGE_CACHE).then(cache =>
                cache.match(request).then(cached => {
                    const fetchPromise = fetch(request).then(response => {
                        if (response.ok) {
                            cache.put(request, response.clone());
                        }
                        return response;
                    }).catch(() => cached);

                    return cached || fetchPromise;
                })
            )
        );
        return;
    }

    // Static assets: cache-first with network fallback
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                if (url.pathname.match(/\.(js|css|html|webp|json)$/i)) {
                    const clone = response.clone();
                    caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
                }

                return response;
            }).catch(() => {
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return new Response('Offline', { status: 503 });
            });
        })
    );
});