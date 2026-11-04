// Accès partagé au service Valhalla (le même serveur que le calcul d'itinéraire).
import type { Point } from './routeGeometry'

const VALHALLA_TRACE_URL = 'https://valhalla1.openstreetmap.de/trace_attributes'
const VALHALLA_TRACE_ROUTE_URL = 'https://valhalla1.openstreetmap.de/trace_route'
/** Garde chaque requête trace_attributes loin des limites du serveur. */
export const VALHALLA_MAX_POINTS = 2_500
const REQUEST_TIMEOUT_MS = 15_000

type ShapeMatch = 'edge_walk' | 'map_snap'
const DEFAULT_SHAPE_MATCHES: readonly ShapeMatch[] = ['edge_walk', 'map_snap']

export interface ValhallaTraceEdge {
  begin_shape_index?: number
  end_shape_index?: number
  speed_limit?: number
  /** Noms de la route (attribut edge.names). */
  names?: string[]
  traffic_signal?: boolean
  end_node?: { traffic_signal?: boolean }
}

export interface ValhallaTraceResponse {
  shape?: string
  edges?: ValhallaTraceEdge[]
}

export interface OsrmLane {
  indications?: string[]
  valid?: boolean
  active?: boolean
  valid_indication?: string
}

export interface ValhallaTraceRouteOsrmResponse {
  matchings?: {
    legs?: { steps?: { intersections?: { location: Point; lanes?: OsrmLane[] }[] }[] }[]
  }[]
}

/**
 * Attributs des routes empruntées par `line` (feux, limitations de vitesse…).
 */
export function fetchTraceAttributes(
  line: Point[],
  attributes: string[],
  signal: AbortSignal,
  /** Points GPS bruts : map_snap directement (edge_walk n'accepte qu'un tracé exact). */
  shapeMatches: readonly ShapeMatch[] = DEFAULT_SHAPE_MATCHES,
): Promise<ValhallaTraceResponse> {
  return postTrace<ValhallaTraceResponse>(VALHALLA_TRACE_URL, line, { filters: { attributes, action: 'include' } }, signal, shapeMatches)
}

/**
 * Le trajet `line` recalculé au format OSRM : c'est le seul format où Valhalla
 * donne les voies (flèches au sol) à chaque intersection.
 */
export function fetchTraceRouteOsrm(line: Point[], signal: AbortSignal): Promise<ValhallaTraceRouteOsrmResponse> {
  return postTrace<ValhallaTraceRouteOsrmResponse>(VALHALLA_TRACE_ROUTE_URL, line, { format: 'osrm', language: 'fr-FR' }, signal)
}

/**
 * edge_walk est rapide et exact pour un tracé produit par Valhalla ;
 * map_snap est la solution de repli, plus tolérante.
 */
async function postTrace<T>(
  url: string,
  line: Point[],
  options: Record<string, unknown>,
  signal: AbortSignal,
  shapeMatches: readonly ShapeMatch[] = DEFAULT_SHAPE_MATCHES,
): Promise<T> {
  let lastError: Error = new Error(`Valhalla ${url} failed.`)
  for (const shapeMatch of shapeMatches) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = window.setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encoded_polyline: encodePolyline6(line),
          costing: 'auto',
          shape_match: shapeMatch,
          ...options,
        }),
        signal: controller.signal,
      })
      if (response.ok) return (await response.json()) as T
      lastError = new Error(`Valhalla ${url} answered ${response.status}.`)
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error instanceof Error ? error : new Error(String(error))
    } finally {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }
  throw lastError
}

/** Découpe un tracé en morceaux qui partagent leur point de jonction. Renvoie l'index de départ de chaque morceau. */
export function chunkLine(points: Point[], size: number): { start: number; points: Point[] }[] {
  const chunks: { start: number; points: Point[] }[] = []
  for (let start = 0; start < points.length - 1; start += size - 1) {
    chunks.push({ start, points: points.slice(start, start + size) })
  }
  return chunks
}

export function encodePolyline6(points: Point[]): string {
  let output = ''
  let previousLatitude = 0
  let previousLongitude = 0
  const encodeValue = (value: number) => {
    let current = value < 0 ? ~(value << 1) : value << 1
    while (current >= 0x20) {
      output += String.fromCharCode((0x20 | (current & 0x1f)) + 63)
      current >>= 5
    }
    output += String.fromCharCode(current + 63)
  }
  for (const [longitude, latitude] of points) {
    const lat = Math.round(latitude * 1e6)
    const lon = Math.round(longitude * 1e6)
    encodeValue(lat - previousLatitude)
    encodeValue(lon - previousLongitude)
    previousLatitude = lat
    previousLongitude = lon
  }
  return output
}

export function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = []
  let index = 0
  let latitude = 0
  let longitude = 0
  const decodeValue = () => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    latitude += decodeValue()
    longitude += decodeValue()
    points.push([longitude / 1e6, latitude / 1e6])
  }
  return points
}
