// Limitations de vitesse de tout le trajet, chargées une seule fois via Valhalla
// (remplace les appels Overpass répétés pendant la navigation).
import type { RouteSummary } from '../types/geocoding'
import { getRouteGeometry, type Point } from './routeGeometry'
import { chunkLine, decodePolyline6, fetchTraceAttributes, VALHALLA_MAX_POINTS } from './valhalla'

export interface SpeedLimitSpan {
  /** Début et fin du tronçon, en mètres depuis le départ. */
  start: number
  end: number
  /** km/h, ou null si la limitation n'est pas connue. */
  limit: number | null
}

const cache = new WeakMap<RouteSummary, SpeedLimitSpan[]>()

export async function getRouteSpeedLimits(route: RouteSummary, signal: AbortSignal): Promise<SpeedLimitSpan[]> {
  const cached = cache.get(route)
  if (cached) return cached

  const coordinates = route.coordinates as Point[]
  const { cumulative } = getRouteGeometry(coordinates)
  const spans: SpeedLimitSpan[] = []

  for (const chunk of chunkLine(coordinates, VALHALLA_MAX_POINTS)) {
    const data = await fetchTraceAttributes(
      chunk.points,
      ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'],
      signal,
    )
    const shape = data.shape ? decodePolyline6(data.shape) : chunk.points
    const shapeDistances = getRouteGeometry(shape).cumulative
    const offset = cumulative[chunk.start]
    for (const edge of data.edges ?? []) {
      const begin = shapeDistances[edge.begin_shape_index ?? -1]
      const end = shapeDistances[edge.end_shape_index ?? -1]
      if (begin === undefined || end === undefined || end <= begin) continue
      const limit = typeof edge.speed_limit === 'number' && edge.speed_limit > 0 && edge.speed_limit < 200
        ? edge.speed_limit
        : null
      spans.push({ start: offset + begin, end: offset + end, limit })
    }
  }

  spans.sort((first, second) => first.start - second.start)
  cache.set(route, spans)
  return spans
}

/** Limitation à `along` mètres du départ (recherche dichotomique). */
export function getSpeedLimitAt(spans: SpeedLimitSpan[], along: number): number | null {
  let low = 0
  let high = spans.length - 1
  let found: SpeedLimitSpan | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    if (spans[middle].start <= along) {
      found = spans[middle]
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found && along <= found.end + 5 ? found.limit : null
}
