import type { RouteSummary } from '../types/geocoding'
import { getPointDistanceMeters, getRouteProgress, projectOnSegment, type Point } from './routeGeometry'
import { chunkLine, decodePolyline6, fetchTraceAttributes, VALHALLA_MAX_POINTS } from './valhalla'

export type RouteControlType = 'stop' | 'traffic-light'

export interface RouteControl {
  id: string
  type: RouteControlType
  coordinates: [longitude: number, latitude: number]
  /** Distance (m) depuis le début du trajet, pour savoir ce qui est devant l'utilisateur. */
  distanceAlongRoute: number
}

export interface RouteControlsResult {
  controls: RouteControl[]
  /** False quand la recherche des feux (Valhalla) a échoué. */
  lightsAvailable: boolean
  /** False quand la recherche des STOP (Overpass) a échoué. */
  stopsAvailable: boolean
}

export interface OverpassElement {
  id: number
  type?: 'node' | 'way' | 'relation'
  lat: number
  lon: number
  /** Centre des chemins et relations (requêtes « out center »). */
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements?: OverpassElement[]
  remark?: string
}

const OVERPASS_API_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
/** Distance autour du trajet dans laquelle on cherche les STOP. */
const SEARCH_RADIUS_METERS = 22
/** Tolérance Douglas-Peucker pour raccourcir le tracé envoyé à Overpass. */
const SIMPLIFY_TOLERANCE_METERS = 6
/** Nombre max de points du tracé par requête Overpass. */
const MAX_POINTS_PER_REQUEST = 400
/** Les éléments du même type plus proches que ça sont fusionnés (1 repère par carrefour). */
const CLUSTER_DISTANCE_METERS = 30
/** Délai max par serveur. */
const REQUEST_TIMEOUT_MS = 15_000
/** Délai avant d'interroger aussi un serveur Overpass de secours. */
const HEDGE_DELAY_MS = 3_500
const CACHE_LIMIT = 20

/** Longueur du morceau de trajet analysé devant l'utilisateur. */
export const CONTROLS_WINDOW_METERS = 3_000
/** On relance une recherche à chaque fois que l'utilisateur a avancé de cette distance. */
export const CONTROLS_REFETCH_STEP_METERS = 1_000
/** Nombre de feux et de STOP affichés (les prochains). */
export const UPCOMING_CONTROLS_PER_TYPE = 2

const cache = new Map<string, RouteControlsResult>()

/** Les N prochains feux et STOP devant l'utilisateur, triés du plus proche au plus loin. */
export function getUpcomingControls(
  controls: RouteControl[],
  progressMeters: number,
  perType = UPCOMING_CONTROLS_PER_TYPE,
): RouteControl[] {
  // Petite marge pour ne pas faire disparaître un feu au moment où on passe dessous.
  const ahead = controls
    .filter((control) => control.distanceAlongRoute >= progressMeters - 10)
    .sort((first, second) => first.distanceAlongRoute - second.distanceAlongRoute)
  return [
    ...ahead.filter((control) => control.type === 'traffic-light').slice(0, perType),
    ...ahead.filter((control) => control.type === 'stop').slice(0, perType),
  ].sort((first, second) => first.distanceAlongRoute - second.distanceAlongRoute)
}

/**
 * Cherche les feux et STOP uniquement sur le morceau de trajet
 * [fromMeters, fromMeters + CONTROLS_WINDOW_METERS], pour ne pas surcharger les serveurs.
 */
export async function getRouteControls(
  route: RouteSummary,
  fromMeters: number,
  signal: AbortSignal,
  /** Appelé dès que les feux sont connus, sans attendre les STOP. */
  onLights?: (controls: RouteControl[]) => void,
): Promise<RouteControlsResult> {
  const coordinates = sliceRoute(route.coordinates as Point[], fromMeters, fromMeters + CONTROLS_WINDOW_METERS)
  if (coordinates.length < 2) return { controls: [], lightsAvailable: true, stopsAvailable: true }

  const cacheKey = getCacheKey(coordinates)
  const cached = cache.get(cacheKey)
  if (cached) return cached

  // Place chaque élément sur le trajet complet (distance depuis le départ).
  const locate = (controls: RouteControl[]) =>
    clusterControls(controls).map((control) => ({
      ...control,
      distanceAlongRoute: fromMeters + getRouteProgress(coordinates, control.coordinates).along,
    }))

  const [lights, stops] = await Promise.allSettled([
    getTrafficLights(coordinates, signal).then((lights) => {
      if (!signal.aborted) onLights?.(locate(lights))
      return lights
    }),
    getStopSigns(coordinates, signal),
  ])
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (lights.status === 'rejected' && stops.status === 'rejected') throw lights.reason

  const result: RouteControlsResult = {
    controls: locate([
      ...(lights.status === 'fulfilled' ? lights.value : []),
      ...(stops.status === 'fulfilled' ? stops.value : []),
    ]),
    lightsAvailable: lights.status === 'fulfilled',
    stopsAvailable: stops.status === 'fulfilled',
  }
  // On ne met en cache que les réponses complètes, pour que « Réessayer » complète le reste.
  if (result.lightsAvailable && result.stopsAvailable) {
    cache.set(cacheKey, result)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  }
  return result
}

/**
 * Feux : Valhalla (`trace_attributes`) indique chaque tronçon du trajet qui se
 * termine sur un feu tricolore. Le feu est placé au bout du tronçon.
 */
async function getTrafficLights(coordinates: Point[], signal: AbortSignal): Promise<RouteControl[]> {
  const lights: RouteControl[] = []
  for (const chunk of chunkLine(coordinates, VALHALLA_MAX_POINTS)) {
    const data = await fetchTraceAttributes(
      chunk.points,
      ['edge.traffic_signal', 'node.traffic_signal', 'edge.end_shape_index', 'shape'],
      signal,
    )
    const shape = data.shape ? decodePolyline6(data.shape) : chunk.points
    for (const edge of data.edges ?? []) {
      if (!edge.traffic_signal && !edge.end_node?.traffic_signal) continue
      const point = shape[edge.end_shape_index ?? -1]
      if (!point) continue
      lights.push({
        id: `light-${point[0].toFixed(6)},${point[1].toFixed(6)}`,
        type: 'traffic-light',
        coordinates: point,
        distanceAlongRoute: 0,
      })
    }
  }
  return lights
}

/** Valhalla ne fournit pas les STOP : ils viennent toujours d'Overpass. */
async function getStopSigns(coordinates: Point[], signal: AbortSignal): Promise<RouteControl[]> {
  const simplified = simplifyLine(coordinates, SIMPLIFY_TOLERANCE_METERS)
  const stops: RouteControl[] = []
  for (const chunk of chunkLine(simplified, MAX_POINTS_PER_REQUEST)) {
    const data = await fetchOverpass(buildStopQuery(chunk.points), signal)
    for (const element of data.elements ?? []) {
      if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon)) continue
      if (!isStopSign(element.tags)) continue
      const point: Point = [element.lon, element.lat]
      // Le tracé simplifié peut s'écarter de quelques mètres du vrai trajet.
      if (getRouteDistanceMeters(point, coordinates) > SEARCH_RADIUS_METERS + SIMPLIFY_TOLERANCE_METERS) continue
      stops.push({ id: `stop-${element.id}`, type: 'stop', coordinates: point, distanceAlongRoute: 0 })
    }
  }
  return stops
}

function buildStopQuery(line: Point[]): string {
  // `around` avec plusieurs coordonnées cherche le long de la polyligne :
  // une seule recherche spatiale couvre tout le morceau.
  const polyline = line.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(',')
  return [
    '[out:json][timeout:25];',
    `node(around:${SEARCH_RADIUS_METERS},${polyline})->.near;`,
    '(',
    'node.near[highway=stop];',
    'node.near[traffic_sign~"stop|AB4|R1-1",i];',
    ');',
    'out body qt;',
  ].join('')
}

function isStopSign(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false
  if (tags.highway === 'stop') return true
  return Boolean(tags.traffic_sign && /(^|[;:,])\s*(stop|stop_sign|AB4|R1-1)\b/i.test(tags.traffic_sign))
}

/**
 * Interroge les serveurs Overpass en décalé : le premier tout de suite, puis
 * un serveur de secours toutes les HEDGE_DELAY_MS (ou dès qu'un serveur
 * échoue). La première réponse valide gagne, les autres sont annulées.
 */
export function fetchOverpass(query: string, signal: AbortSignal): Promise<OverpassResponse> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = []
    const timers: number[] = []
    let nextIndex = 0
    let pending = 0
    let settled = false
    let lastError: Error = new Error('No OpenStreetMap route-control service is available.')

    const cleanup = () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      controllers.forEach((controller) => controller.abort())
      signal.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))

    const launchNext = () => {
      if (settled || nextIndex >= OVERPASS_API_URLS.length) {
        if (!settled && pending === 0) finish(() => reject(lastError))
        return
      }
      const endpoint = OVERPASS_API_URLS[nextIndex++]
      const controller = new AbortController()
      controllers.push(controller)
      pending += 1
      timers.push(window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS))
      timers.push(window.setTimeout(launchNext, HEDGE_DELAY_MS))

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Overpass ${endpoint} answered ${response.status}.`)
          const data = (await response.json()) as OverpassResponse
          // Overpass signale ses dépassements de temps dans `remark` avec un HTTP 200.
          if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
            throw new Error(`Overpass ${endpoint}: ${data.remark}`)
          }
          finish(() => resolve(data))
        })
        .catch((error: unknown) => {
          lastError = error instanceof Error ? error : new Error(String(error))
        })
        .finally(() => {
          pending -= 1
          // Inutile d'attendre le délai si un serveur a déjà échoué.
          if (!settled) launchNext()
        })
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    launchNext()
  })
}

function clusterControls(controls: RouteControl[]): RouteControl[] {
  const clusters: { control: RouteControl; members: Point[] }[] = []
  for (const control of controls) {
    const cluster = clusters.find(
      (candidate) =>
        candidate.control.type === control.type &&
        getPointDistanceMeters(candidate.control.coordinates, control.coordinates) < CLUSTER_DISTANCE_METERS,
    )
    if (cluster) {
      cluster.members.push(control.coordinates)
      const count = cluster.members.length
      cluster.control.coordinates = [
        cluster.members.reduce((sum, point) => sum + point[0], 0) / count,
        cluster.members.reduce((sum, point) => sum + point[1], 0) / count,
      ]
    } else {
      clusters.push({ control: { ...control }, members: [control.coordinates] })
    }
  }
  return clusters.map((cluster) => cluster.control)
}

export function simplifyLine(points: Point[], toleranceMeters: number): Point[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    let maxDistance = 0
    let maxIndex = -1
    for (let index = start + 1; index < end; index += 1) {
      const distance = getSegmentDistanceMeters(points[index], points[start], points[end])
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = index
      }
    }
    if (maxIndex !== -1 && maxDistance > toleranceMeters) {
      keep[maxIndex] = 1
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

function getCacheKey(points: Point[]): string {
  const first = points[0]
  const last = points[points.length - 1]
  const middle = points[Math.floor(points.length / 2)]
  return [first, middle, last].map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join('|') + `|${points.length}`
}

function getRouteDistanceMeters(point: Point, route: Point[]): number {
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < route.length; index += 1) {
    minimumDistance = Math.min(minimumDistance, getSegmentDistanceMeters(point, route[index - 1], route[index]))
    if (minimumDistance === 0) break
  }
  return minimumDistance
}

/** Extrait le morceau du trajet entre deux distances depuis le départ (en mètres). */
function sliceRoute(coordinates: Point[], fromMeters: number, toMeters: number): Point[] {
  const slice: Point[] = []
  let cumulative = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1]
    const end = coordinates[index]
    const segmentLength = getPointDistanceMeters(start, end)
    const segmentEnd = cumulative + segmentLength
    if (segmentEnd >= fromMeters && cumulative <= toMeters && segmentLength > 0) {
      const interpolate = (meters: number): Point => {
        const fraction = Math.max(0, Math.min(1, (meters - cumulative) / segmentLength))
        return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]
      }
      if (slice.length === 0) slice.push(interpolate(fromMeters))
      slice.push(segmentEnd > toMeters ? interpolate(toMeters) : end)
    }
    if (segmentEnd > toMeters) break
    cumulative = segmentEnd
  }
  return slice
}

function getSegmentDistanceMeters(point: Point, start: Point, end: Point): number {
  return projectOnSegment(point, start, end).distance
}
