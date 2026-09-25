const CACHE_PREFIX = 'sherpa-onnx-wasm-asr';
const CACHE_VERSION = 'v2';
const PRECACHE = `${CACHE_PREFIX}-precache-${CACHE_VERSION}`;
const RUNTIME = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  './index.html',
  './app-asr.js',
  './sherpa-onnx-asr.js',
  './sherpa-onnx-vad.js',
  './offline-worker.js',
  './assets/tokens.txt',
  './assets/paraformer-tokens.txt',
  './assets/second-pass-tokens.txt',
  './assets/punct-ct-transformer-tokens.json',
];

const RUNTIME_CACHE_PATTERN =
    /\.(?:js|json|wasm|data|onnx|txt|css|html?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
      caches.open(PRECACHE)
          .then((cache) => cache.addAll(APP_SHELL))
          .catch((err) => {
            console.warn('[SW] Failed to precache shell', err);
          })
          .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
      caches.keys()
          .then((keys) => Promise.all(
                    keys.filter(
                            (key) => key.startsWith(CACHE_PREFIX) &&
                                key !== PRECACHE && key !== RUNTIME)
                        .map((key) => caches.delete(key))))
          .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (RUNTIME_CACHE_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const copy = response.clone();
    const cache = await caches.open(PRECACHE);
    await cache.put('./index.html', copy);
    return response;
  } catch (err) {
    const cached = await caches.match('./index.html');
    if (cached) {
      return cached;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  if (cached) {
    updateRuntimeCache(cache, request, cached.clone());
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

function updateRuntimeCache(cache, request, cachedResponse) {
  let etag = null;
  if (cachedResponse) {
    etag = cachedResponse.headers.get('ETag');
  }

  const headers = new Headers(request.headers || {});
  if (etag) {
    headers.set('If-None-Match', etag);
  }
  const refreshRequest = new Request(request, {headers, cache: 'no-store'});

  fetch(refreshRequest)
      .then((response) => {
        if (!response) {
          return;
        }
        if (response.status === 304) {
          return;
        }
        if (response.ok) {
          cache.put(request, response.clone());
        }
      })
      .catch(() => {
        // Ignore refresh errors (offline).
      });
}
