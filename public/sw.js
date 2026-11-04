// Service worker d'Atlas : rend l'appli installable et permet de la rouvrir sans réseau.
// - Pages : réseau d'abord (toujours la dernière version), copie en cache si hors ligne.
// - Fichiers de build (/assets/, noms avec hash) : cache d'abord, ils ne changent jamais.
// - Tout le reste (tuiles de carte, itinéraires, API trafic…) passe directement au réseau.

const VERSION = 'atlas-v1'
const PAGES_CACHE = `${VERSION}-pages`
const ASSETS_CACHE = `${VERSION}-assets`
const MAX_ASSETS = 60
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(staleWhileRevalidate(request))
  }
})

async function networkFirst(request) {
  const cache = await caches.open(PAGES_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put('/', response.clone())
    return response
  } catch {
    return (await cache.match('/')) ?? Response.error()
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    void trimCache(cache)
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(PAGES_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone())
      return response
    })
    .catch(() => cached ?? Response.error())
  return cached ?? network
}

/** Les anciens fichiers de build s'accumulent à chaque mise à jour : on garde les plus récents. */
async function trimCache(cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)))
}
