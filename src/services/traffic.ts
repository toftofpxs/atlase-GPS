// Trafic en temps réel HERE (API Traffic v7, endpoint /flow).
// Les requêtes passent par /api/traffic : proxy Vite en dev, fonction Netlify en prod.

export interface TrafficFeatureCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: { jamFactor: number; closed: boolean }
    geometry: { type: 'LineString'; coordinates: [number, number][] }
  }[]
}

interface HereFlowResponse {
  results?: {
    location?: { shape?: { links?: { points?: { lat: number; lng: number }[] }[] } }
    currentFlow?: { jamFactor?: number; traversability?: string }
  }[]
}

/** En dessous de ce zoom, la zone visible est trop grande : on n'affiche pas le trafic. */
export const TRAFFIC_MIN_ZOOM = 11
/** HERE refuse les zones de plus de 1° de côté. */
const MAX_BBOX_DEGREES = 0.99
/** Délai de rafraîchissement automatique. */
export const TRAFFIC_REFRESH_MS = 120_000
const CACHE_TTL_MS = 60_000

const cache = new Map<string, { time: number; data: TrafficFeatureCollection }>()

export async function getTrafficFlow(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  signal: AbortSignal,
): Promise<TrafficFeatureCollection> {
  const bbox = clampBbox(bounds)
  // Zoom faible : seulement les grands axes (classes 1 à 3), sinon trop de données.
  const functionalClasses = zoom < 13 ? '1,2,3' : '1,2,3,4,5'
  const key = `${bbox}|${functionalClasses}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data

  const params = new URLSearchParams({
    in: `bbox:${bbox}`,
    locationReferencing: 'shape',
    functionalClasses,
  })
  const response = await fetch(`/api/traffic/flow?${params}`, { signal })
  if (!response.ok) throw new Error(`HERE Traffic a répondu ${response.status}.`)
  const data = toGeoJson((await response.json()) as HereFlowResponse)

  cache.set(key, { time: Date.now(), data })
  if (cache.size > 10) cache.delete(cache.keys().next().value as string)
  return data
}

function toGeoJson(response: HereFlowResponse): TrafficFeatureCollection {
  const features: TrafficFeatureCollection['features'] = []
  for (const result of response.results ?? []) {
    const jamFactor = result.currentFlow?.jamFactor
    if (typeof jamFactor !== 'number') continue
    const closed = result.currentFlow?.traversability === 'closed'
    for (const link of result.location?.shape?.links ?? []) {
      const coordinates = (link.points ?? []).map((point): [number, number] => [point.lng, point.lat])
      if (coordinates.length < 2) continue
      features.push({
        type: 'Feature',
        properties: { jamFactor: closed ? 10 : jamFactor, closed },
        geometry: { type: 'LineString', coordinates },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Arrondit (pour le cache) et limite la zone à 1° autour de son centre. */
function clampBbox({ west, south, east, north }: { west: number; south: number; east: number; north: number }): string {
  const centerLng = (west + east) / 2
  const centerLat = (south + north) / 2
  const halfWidth = Math.min(east - west, MAX_BBOX_DEGREES) / 2
  const halfHeight = Math.min(north - south, MAX_BBOX_DEGREES) / 2
  const round = (value: number) => value.toFixed(3)
  return [
    round(centerLng - halfWidth),
    round(Math.max(-90, centerLat - halfHeight)),
    round(centerLng + halfWidth),
    round(Math.min(90, centerLat + halfHeight)),
  ].join(',')
}
