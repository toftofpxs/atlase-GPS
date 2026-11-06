// Trafic SUR le trajet : quelles portions sont ralenties, et combien de temps ça ajoute.
// On télécharge les tuiles de trafic TomTom qui couvrent le trajet (même relais que la couche
// de la carte), puis on cherche pour chaque point du trajet le tronçon de route correspondant,
// dans le bon sens de circulation.
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { RouteSummary } from '../types/geocoding'
import { getRouteSecondsBetween } from './navigation'
import { getPointAtDistance, getRouteGeometry, type Point } from './routeGeometry'
import { TRAFFIC_REFRESH_MS, TRAFFIC_SOURCE_LAYER } from './traffic'

export type TrafficKind = 'slow' | 'heavy' | 'closed'

export interface RouteTrafficSpan {
  /** Début et fin, en mètres depuis le départ du trajet. */
  start: number
  end: number
  kind: TrafficKind
}

export interface RouteTraffic {
  /** Portions ralenties (le reste est fluide ou sans donnée). */
  spans: RouteTrafficSpan[]
  /** Points d'échantillonnage et retard cumulé à partir de chacun (pour le temps restant). */
  sampleAlong: number[]
  delayFromSample: number[]
}

/** Zoom des tuiles : ~13 km de côté en France, avec les grands axes et les routes principales. */
const TILE_ZOOM = 11
/** Longueur de trajet analysée devant la position. */
export const ROUTE_TRAFFIC_AHEAD_METERS = 100_000
/** Rafraîchissement du trafic sur le trajet. */
export const ROUTE_TRAFFIC_REFRESH_MS = 5 * 60_000
/** Pas d'échantillonnage le long du trajet. */
const SAMPLE_METERS = 20
/** Distance maximale entre le trajet et un tronçon de trafic pour les associer. */
const MATCH_METERS = 18
/** Écart d'angle maximal entre le sens du trajet et celui du tronçon. */
const MAX_HEADING_DIFFERENCE = 50
/** Seuils de traffic_level (vitesse actuelle / vitesse fluide) : mêmes couleurs que la carte. */
const HEAVY_BELOW = 0.4
const SLOW_BELOW = 0.75
/**
 * Plancher du niveau pris en compte pour le retard : TomTom descend parfois sous 0,1 aux feux
 * rouges, ce qui gonflerait le retard. 0,25 = au pire 4 fois le temps normal sur la portion.
 */
const MIN_LEVEL_FOR_DELAY = 0.25
const FETCH_CONCURRENCY = 4
const GRID_DEGREES = 0.002

interface TrafficSegment {
  start: Point
  end: Point
  level: number
  closed: boolean
  oneWay: boolean
}

export async function getRouteTraffic(
  route: RouteSummary,
  fromAlong: number,
  signal: AbortSignal,
): Promise<RouteTraffic> {
  const coordinates = route.coordinates as Point[]
  const { total } = getRouteGeometry(coordinates)
  const from = Math.max(0, Math.min(fromAlong, total))
  const to = Math.min(total, from + ROUTE_TRAFFIC_AHEAD_METERS)

  // 1. Tuiles qui couvrent le trajet.
  const tiles = new Map<string, [number, number]>()
  for (let along = from; along <= to; along += 200) {
    const [x, y] = getTile(getPointAtDistance(coordinates, along), TILE_ZOOM)
    tiles.set(`${x}/${y}`, [x, y])
  }

  // 2. Téléchargement et décodage des tronçons de trafic.
  const segments: TrafficSegment[] = []
  const queue = [...tiles.values()]
  const version = Math.floor(Date.now() / TRAFFIC_REFRESH_MS)
  const worker = async () => {
    while (queue.length > 0) {
      const [x, y] = queue.shift() as [number, number]
      const response = await fetch(`/api/traffic?z=${TILE_ZOOM}&x=${x}&y=${y}&v=${version}`, { signal })
      if (!response.ok) throw new Error(`Tuile trafic ${x}/${y} : ${response.status}`)
      segments.push(...decodeTile(new Uint8Array(await response.arrayBuffer()), x, y))
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker))

  // 3. Index spatial grossier pour retrouver vite les tronçons proches d'un point.
  const grid = new Map<string, TrafficSegment[]>()
  for (const segment of segments) {
    const minX = Math.floor(Math.min(segment.start[0], segment.end[0]) / GRID_DEGREES)
    const maxX = Math.floor(Math.max(segment.start[0], segment.end[0]) / GRID_DEGREES)
    const minY = Math.floor(Math.min(segment.start[1], segment.end[1]) / GRID_DEGREES)
    const maxY = Math.floor(Math.max(segment.start[1], segment.end[1]) / GRID_DEGREES)
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gy = minY; gy <= maxY; gy += 1) {
        const key = `${gx}:${gy}`
        const cell = grid.get(key)
        if (cell) cell.push(segment)
        else grid.set(key, [segment])
      }
    }
  }

  // 4. Échantillonnage du trajet : niveau de trafic et retard à chaque point.
  const spans: RouteTrafficSpan[] = []
  const sampleAlong: number[] = []
  const delays: number[] = []
  for (let along = from; along < to; along += SAMPLE_METERS) {
    const point = getPointAtDistance(coordinates, along)
    const ahead = getPointAtDistance(coordinates, Math.min(total, along + 10))
    const heading = getHeading(point, ahead)
    const match = findSegment(grid, point, heading)
    const end = Math.min(to, along + SAMPLE_METERS)

    let delay = 0
    if (match && !match.closed && match.level < 1) {
      const baseSeconds = getRouteSecondsBetween(route, along, end)
      delay = baseSeconds * (1 / Math.max(match.level, MIN_LEVEL_FOR_DELAY) - 1)
    }
    sampleAlong.push(along)
    delays.push(delay)

    const kind: TrafficKind | null = !match
      ? null
      : match.closed
        ? 'closed'
        : match.level < HEAVY_BELOW
          ? 'heavy'
          : match.level < SLOW_BELOW
            ? 'slow'
            : null
    const previous = spans[spans.length - 1]
    if (kind && previous && previous.kind === kind && previous.end >= along - 0.01) previous.end = end
    else if (kind) spans.push({ start: along, end, kind })
  }

  // Retard cumulé à partir de chaque échantillon (somme de la fin vers le début).
  const delayFromSample = new Array<number>(delays.length + 1).fill(0)
  for (let index = delays.length - 1; index >= 0; index -= 1) {
    delayFromSample[index] = delayFromSample[index + 1] + delays[index]
  }
  return { spans, sampleAlong, delayFromSample }
}

/** Retard dû au trafic sur le reste du trajet, en secondes. */
export function getRemainingTrafficDelay(traffic: RouteTraffic | null, along: number): number {
  if (!traffic || traffic.sampleAlong.length === 0) return 0
  // Premier échantillon devant la position (recherche dichotomique).
  let low = 0
  let high = traffic.sampleAlong.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (traffic.sampleAlong[middle] < along) low = middle + 1
    else high = middle
  }
  return traffic.delayFromSample[low] ?? 0
}

function findSegment(grid: Map<string, TrafficSegment[]>, point: Point, heading: number): TrafficSegment | null {
  const gx = Math.floor(point[0] / GRID_DEGREES)
  const gy = Math.floor(point[1] / GRID_DEGREES)
  let best: TrafficSegment | null = null
  let bestDistance = MATCH_METERS
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const segment of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
        // Tronçon d'un seul sens : il doit aller dans le même sens que le trajet.
        // Tronçon « full » (route à sens unique) : il suffit qu'il soit parallèle.
        const difference = getAngleDifference(heading, getHeading(segment.start, segment.end))
        const aligned = segment.oneWay
          ? difference <= MAX_HEADING_DIFFERENCE
          : difference <= MAX_HEADING_DIFFERENCE || difference >= 180 - MAX_HEADING_DIFFERENCE
        if (!aligned) continue
        const distance = getSegmentDistance(point, segment.start, segment.end)
        if (distance < bestDistance) {
          bestDistance = distance
          best = segment
        }
      }
    }
  }
  return best
}

function decodeTile(data: Uint8Array, tileX: number, tileY: number): TrafficSegment[] {
  const layer = new VectorTile(new PbfReader(data)).layers[TRAFFIC_SOURCE_LAYER]
  if (!layer) return []
  const scale = 2 ** TILE_ZOOM
  const segments: TrafficSegment[] = []
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index)
    const properties = feature.properties
    const level = Number(properties.traffic_level)
    const closed = Boolean(properties.road_closure)
    if (!closed && !Number.isFinite(level)) continue
    const oneWay = properties.traffic_road_coverage === 'one_side'
    for (const line of feature.loadGeometry()) {
      const points = line.map((p): Point => {
        const x = (tileX + p.x / layer.extent) / scale
        const y = (tileY + p.y / layer.extent) / scale
        return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI]
      })
      for (let i = 1; i < points.length; i += 1) {
        segments.push({ start: points[i - 1], end: points[i], level: closed ? 0 : level, closed, oneWay })
      }
    }
  }
  return segments
}

function getTile([longitude, latitude]: Point, zoom: number): [number, number] {
  const scale = 2 ** zoom
  const radians = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180
  const x = Math.floor(((longitude + 180) / 360) * scale)
  const y = Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale)
  return [Math.min(Math.max(x, 0), scale - 1), Math.min(Math.max(y, 0), scale - 1)]
}

/** Cap en degrés (0 = nord), calculé sur un plan local (suffisant à cette échelle). */
function getHeading(from: Point, to: Point): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180)
  const dy = to[1] - from[1]
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

function getAngleDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360
  return difference > 180 ? 360 - difference : difference
}

function getSegmentDistance(point: Point, start: Point, end: Point): number {
  const metersPerLongitude = 111_320 * Math.cos((point[1] * Math.PI) / 180)
  const px = (point[0] - start[0]) * metersPerLongitude
  const py = (point[1] - start[1]) * 110_540
  const sx = (end[0] - start[0]) * metersPerLongitude
  const sy = (end[1] - start[1]) * 110_540
  const lengthSquared = sx ** 2 + sy ** 2
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * sx + py * sy) / lengthSquared))
  return Math.hypot(px - t * sx, py - t * sy)
}
