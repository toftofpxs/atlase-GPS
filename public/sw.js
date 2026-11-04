// Service worker d'Atlas : rend l'appli installable et la fait fonctionner sans réseau.
// - Pages : réseau d'abord (toujours la dernière version), copie en cache si hors ligne.
// - Fichiers de build (/assets/, noms avec hash) : mis en cache dès l'installation, puis cache d'abord.
// - Carte OpenFreeMap : tuiles, polices et icônes en cache (cache d'abord, ce sont des fichiers versionnés) ;
//   styles et description des tuiles en réseau d'abord. Les tuiles du trajet sont préchargées au départ.
// - Tout le reste (itinéraires, trafic, recherche…) passe directement au réseau.

const VERSION = 'atlas-v2'
const PAGES_CACHE = `${VERSION}-pages`
const ASSETS_CACHE = `${VERSION}-assets`
// Les caches de carte ne dépendent pas de la version de l'appli : ils survivent aux mises à jour.
const TILES_CACHE = 'atlas-map-tiles'
const MAP_CACHE = 'atlas-map-static'
const KEPT_CACHES = [TILES_CACHE, MAP_CACHE]
const MAX_ASSETS = 60
const MAX_TILES = 4_000
const MAX_MAP_STATIC = 300
const PREFETCH_CONCURRENCY = 4
const MAP_HOST = 'tiles.openfreemap.org'
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(PAGES_CACHE).then((cache) => cache.addAll(PRECACHE)),
      precacheBuildAssets(),
    ]).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION) && !KEPT_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.hostname === MAP_HOST) {
    if (isTile(url)) event.respondWith(cacheFirst(request, TILES_CACHE, MAX_TILES))
    else if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/')) {
      event.respondWith(cacheFirst(request, MAP_CACHE, MAX_MAP_STATIC))
    } else event.respondWith(networkFirstMap(request))
    return
  }

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE, MAX_ASSETS))
  } else {
    event.respondWith(staleWhileRevalidate(request))
  }
})

// Préchargement des tuiles le long du trajet, demandé par la page au départ de la navigation.
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'prefetch-tiles' || !Array.isArray(data.urls)) return
  const urls = data.urls.filter((value) => typeof value === 'string' && new URL(value).hostname === MAP_HOST)
  event.waitUntil(prefetchTiles(urls))
})

function isTile(url) {
  return /\/\d+\/\d+\/\d+\.(pbf|mvt|png|webp)$/.test(url.pathname)
}

async function precacheBuildAssets() {
  try {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' })
    if (!response.ok) return
    const files = await response.json()
    const cache = await caches.open(ASSETS_CACHE)
    await cache.addAll(files)
  } catch {
    // Sans la liste, les fichiers seront mis en cache au fil de l'utilisation.
  }
}

async function prefetchTiles(urls) {
  const cache = await caches.open(TILES_CACHE)
  let index = 0
  const worker = async () => {
    while (index < urls.length) {
      const url = urls[index++]
      try {
        if (await cache.match(url)) continue
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (response.ok) await cache.put(url, response)
      } catch {
        // Hors ligne ou serveur indisponible : on passe à la suivante.
      }
    }
  }
  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker))
  await trimCache(cache, MAX_TILES)
}

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

/** Style de carte et description des tuiles : réseau d'abord (nouvelles versions), copie hors ligne. */
async function networkFirstMap(request) {
  const cache = await caches.open(MAP_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (await cache.match(request)) ?? Response.error()
  }
}

let putsSinceTrim = 0

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    // Nettoyage de temps en temps seulement : lister un gros cache coûte cher.
    putsSinceTrim += 1
    if (putsSinceTrim >= 50) {
      putsSinceTrim = 0
      void trimCache(cache, limit)
    }
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

/** Garde les entrées les plus récentes (les caches sont listés dans l'ordre d'ajout). */
async function trimCache(cache, limit) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)))
}
