// Géométrie du trajet : distances cumulées et projection d'une position sur le tracé.
// Les distances cumulées sont calculées une seule fois par tracé (cache WeakMap).

export type Point = [longitude: number, latitude: number]

export interface RouteProgress {
  /** Distance parcourue depuis le départ, en mètres, mesurée sur le tracé. */
  along: number
  /** Écart entre la position et le tracé, en mètres. */
  distance: number
  /** Index du tronçon [index, index + 1] le plus proche. */
  segmentIndex: number
}

interface RouteGeometry {
  /** cumulative[i] = distance du départ jusqu'au point i. */
  cumulative: Float64Array
  total: number
}

/** Fenêtre de recherche autour de la dernière position connue. */
const HINT_BEHIND_METERS = 300
const HINT_AHEAD_METERS = 3_000
/** Au-delà de cet écart, la recherche locale est jugée douteuse : on cherche sur tout le trajet. */
const HINT_MAX_DISTANCE_METERS = 60

const geometryCache = new WeakMap<Point[], RouteGeometry>()

export function getRouteGeometry(coordinates: Point[]): RouteGeometry {
  const cached = geometryCache.get(coordinates)
  if (cached) return cached

  const cumulative = new Float64Array(coordinates.length)
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + getPointDistanceMeters(coordinates[index - 1], coordinates[index])
  }
  const geometry = { cumulative, total: cumulative[coordinates.length - 1] ?? 0 }
  geometryCache.set(coordinates, geometry)
  return geometry
}

/**
 * Projette `point` sur le tracé (sur les tronçons, pas seulement sur les sommets :
 * sur autoroute, deux sommets peuvent être espacés de plusieurs centaines de mètres).
 * Avec `hintAlong` (dernière progression connue), on ne cherche qu'autour : c'est
 * beaucoup plus rapide et ça évite de « sauter » sur une autre partie d'un trajet en boucle.
 */
export function getRouteProgress(coordinates: Point[], point: Point, hintAlong?: number): RouteProgress {
  if (coordinates.length < 2) {
    return { along: 0, distance: coordinates[0] ? getPointDistanceMeters(coordinates[0], point) : Infinity, segmentIndex: 0 }
  }
  const { cumulative } = getRouteGeometry(coordinates)

  if (hintAlong !== undefined && Number.isFinite(hintAlong)) {
    const from = Math.max(0, findSegmentAt(cumulative, hintAlong - HINT_BEHIND_METERS))
    const to = Math.min(coordinates.length - 2, findSegmentAt(cumulative, hintAlong + HINT_AHEAD_METERS))
    const local = searchSegments(coordinates, cumulative, point, from, to)
    if (local.distance <= HINT_MAX_DISTANCE_METERS) return local
  }
  return searchSegments(coordinates, cumulative, point, 0, coordinates.length - 2)
}

/** Point du tracé situé à `along` mètres du départ. */
export function getPointAtDistance(coordinates: Point[], along: number): Point {
  const { cumulative, total } = getRouteGeometry(coordinates)
  if (coordinates.length < 2) return coordinates[0]
  const clamped = Math.max(0, Math.min(total, along))
  const index = Math.min(coordinates.length - 2, findSegmentAt(cumulative, clamped))
  const length = cumulative[index + 1] - cumulative[index]
  const fraction = length > 0 ? (clamped - cumulative[index]) / length : 0
  const start = coordinates[index]
  const end = coordinates[index + 1]
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]
}

/** Portion du tracé entre deux distances depuis le départ (en mètres), pour la dessiner. */
export function getRouteSlice(coordinates: Point[], from: number, to: number): Point[] {
  const { cumulative } = getRouteGeometry(coordinates)
  if (coordinates.length < 2 || to <= from) return []
  const slice: Point[] = [getPointAtDistance(coordinates, from)]
  const firstIndex = Math.min(coordinates.length - 1, findSegmentAt(cumulative, from) + 1)
  for (let index = firstIndex; index < coordinates.length && cumulative[index] < to; index += 1) {
    slice.push(coordinates[index])
  }
  slice.push(getPointAtDistance(coordinates, to))
  return slice
}

export function getPointDistanceMeters(first: Point, second: Point): number {
  const latitudeRadians = (first[1] * Math.PI) / 180
  return Math.hypot(
    (first[0] - second[0]) * 111_320 * Math.cos(latitudeRadians),
    (first[1] - second[1]) * 110_540,
  )
}

export function projectOnSegment(point: Point, start: Point, end: Point): { distance: number; fraction: number } {
  const latitudeRadians = (point[1] * Math.PI) / 180
  const metersPerLongitudeDegree = 111_320 * Math.cos(latitudeRadians)
  const metersPerLatitudeDegree = 110_540
  const pointX = (point[0] - start[0]) * metersPerLongitudeDegree
  const pointY = (point[1] - start[1]) * metersPerLatitudeDegree
  const segmentX = (end[0] - start[0]) * metersPerLongitudeDegree
  const segmentY = (end[1] - start[1]) * metersPerLatitudeDegree
  const lengthSquared = segmentX ** 2 + segmentY ** 2
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared))
  return {
    distance: Math.hypot(pointX - fraction * segmentX, pointY - fraction * segmentY),
    fraction,
  }
}

function searchSegments(
  coordinates: Point[],
  cumulative: Float64Array,
  point: Point,
  from: number,
  to: number,
): RouteProgress {
  let best: RouteProgress = { along: 0, distance: Number.POSITIVE_INFINITY, segmentIndex: from }
  for (let index = from; index <= to; index += 1) {
    const projection = projectOnSegment(point, coordinates[index], coordinates[index + 1])
    if (projection.distance < best.distance) {
      const length = cumulative[index + 1] - cumulative[index]
      best = { along: cumulative[index] + projection.fraction * length, distance: projection.distance, segmentIndex: index }
    }
  }
  return best
}

/** Index du tronçon qui contient la distance `along` (recherche dichotomique). */
function findSegmentAt(cumulative: Float64Array, along: number): number {
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (cumulative[middle] <= along) low = middle
    else high = middle - 1
  }
  return low
}
