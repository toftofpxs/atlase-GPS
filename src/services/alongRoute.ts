// Recherche de lieux sur l'itinéraire, devant la position (stations, recharge, parkings, aires).
// D'abord TomTom « Along Route Search » (rapide, trié par temps de détour), via /api/along-route
// (fonction serveur : api/along-route.ts sur Vercel) pour garder la clé côté serveur.
// En secours : OpenStreetMap via Overpass, comme les STOP.
import type { RouteSummary } from '../types/geocoding'
import { fetchOverpass, simplifyLine, type OverpassElement } from './routeControls'
import { getPointAtDistance, getRouteGeometry, getRouteProgress, type Point } from './routeGeometry'

export type AlongRouteCategory = 'fuel' | 'charging' | 'parking' | 'rest'

export interface AlongRoutePlace {
  id: string
  category: AlongRouteCategory
  name: string
  details: string
  coordinates: Point
  /** Distance restant à parcourir sur le trajet jusqu'au lieu. */
  distanceAhead: number
  /** Écart entre le lieu et le trajet. */
  distanceFromRoute: number
  /** Temps de détour pour y aller et revenir sur le trajet (TomTom), en secondes. */
  detourSeconds?: number
}

export const ALONG_ROUTE_CATEGORIES: { value: AlongRouteCategory; label: string }[] = [
  { value: 'fuel', label: 'Carburant' },
  { value: 'charging', label: 'Recharge' },
  { value: 'parking', label: 'Parking' },
  { value: 'rest', label: 'Aire de repos' },
]

const FILTERS: Record<AlongRouteCategory, string[]> = {
  fuel: ['nwr.near[amenity=fuel];'],
  charging: ['nwr.near[amenity=charging_station];'],
  parking: ['nwr.near[amenity=parking][access!~"^(private|no|customers)$"];'],
  rest: ['nwr.near[highway~"^(rest_area|services)$"];'],
}

/** Portion du trajet analysée devant la position. */
const SEARCH_AHEAD_METERS = 40_000
/** Distance max au trajet (une station est souvent un peu en retrait de la route). */
const SEARCH_RADIUS_METERS = 500
const SIMPLIFY_TOLERANCE_METERS = 40
const MAX_POLYLINE_POINTS = 350
const MAX_RESULTS = 10

/** Catégories TomTom (API poiCategories) : station-service, borne de recharge, parkings, aire de repos. */
const TOMTOM_CATEGORIES: Record<AlongRouteCategory, string> = {
  fuel: '7311',
  charging: '7309',
  parking: '7369,7313',
  rest: '7395',
}
/** Détour maximal accepté (aller-retour depuis le trajet). */
const MAX_DETOUR_SECONDS = 600

interface TomTomAlongRouteResponse {
  results?: {
    id?: string
    position?: { lat: number; lon: number }
    detourTime?: number
    poi?: { name?: string; brands?: { name?: string }[] }
    address?: { freeformAddress?: string; municipality?: string }
  }[]
}

export async function searchAlongRoute(
  route: RouteSummary,
  fromAlong: number,
  category: AlongRouteCategory,
  signal: AbortSignal,
): Promise<AlongRoutePlace[]> {
  const line = getLineAhead(route, fromAlong)
  if (!line) return []
  try {
    return await searchWithTomTom(route, fromAlong, category, line, signal)
  } catch (error) {
    if (signal.aborted) throw error
    // TomTom indisponible (quota, réseau…) : on tente OpenStreetMap.
    return searchWithOverpass(route, fromAlong, category, line, signal)
  }
}

/** Morceau du trajet devant la position, simplifié pour tenir dans une seule requête. */
function getLineAhead(route: RouteSummary, fromAlong: number): Point[] | null {
  const coordinates = route.coordinates as Point[]
  const { cumulative, total } = getRouteGeometry(coordinates)
  const end = Math.min(total, fromAlong + SEARCH_AHEAD_METERS)
  if (end - fromAlong < 50) return null

  const ahead: Point[] = [getPointAtDistance(coordinates, fromAlong)]
  for (let index = 0; index < coordinates.length; index += 1) {
    if (cumulative[index] > fromAlong && cumulative[index] < end) ahead.push(coordinates[index])
  }
  ahead.push(getPointAtDistance(coordinates, end))
  let line = simplifyLine(ahead, SIMPLIFY_TOLERANCE_METERS)
  if (line.length > MAX_POLYLINE_POINTS) {
    const step = Math.ceil(line.length / MAX_POLYLINE_POINTS)
    line = line.filter((_, index) => index % step === 0 || index === line.length - 1)
  }
  return line
}

async function searchWithTomTom(
  route: RouteSummary,
  fromAlong: number,
  category: AlongRouteCategory,
  line: Point[],
  signal: AbortSignal,
): Promise<AlongRoutePlace[]> {
  const params = new URLSearchParams({
    maxDetourTime: String(MAX_DETOUR_SECONDS),
    limit: '20',
    categorySet: TOMTOM_CATEGORIES[category],
    language: 'fr-FR',
  })
  const response = await fetch(`/api/along-route?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: { points: line.map(([lon, lat]) => ({ lat, lon })) } }),
    signal,
  })
  if (!response.ok) throw new Error(`Recherche TomTom : ${response.status}`)
  const data = (await response.json()) as TomTomAlongRouteResponse

  const coordinates = route.coordinates as Point[]
  const label = ALONG_ROUTE_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'Lieu'
  const places: AlongRoutePlace[] = []
  for (const result of data.results ?? []) {
    if (!result.position) continue
    const point: Point = [result.position.lon, result.position.lat]
    // Le champ « dist » de TomTom est la distance depuis le début du tracé envoyé : on recalcule.
    const progress = getRouteProgress(coordinates, point, fromAlong)
    const distanceAhead = progress.along - fromAlong
    if (distanceAhead < 50) continue
    const brand = result.poi?.brands?.[0]?.name
    const name = result.poi?.name ?? brand ?? label
    places.push({
      id: `tomtom-${result.id ?? `${point[0]},${point[1]}`}`,
      category,
      name,
      details: [result.address?.freeformAddress ?? result.address?.municipality, brand && brand !== name ? brand : null]
        .filter(Boolean)
        .join(' · ') || label,
      coordinates: point,
      distanceAhead,
      distanceFromRoute: progress.distance,
      detourSeconds: result.detourTime,
    })
  }
  places.sort((first, second) => first.distanceAhead - second.distanceAhead)
  return places.slice(0, MAX_RESULTS)
}

async function searchWithOverpass(
  route: RouteSummary,
  fromAlong: number,
  category: AlongRouteCategory,
  line: Point[],
  signal: AbortSignal,
): Promise<AlongRoutePlace[]> {
  const coordinates = route.coordinates as Point[]
  const polyline = line.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',')
  const query = [
    '[out:json][timeout:25];',
    `nwr(around:${SEARCH_RADIUS_METERS},${polyline})->.near;`,
    '(',
    ...FILTERS[category],
    ');',
    'out tags center qt 80;',
  ].join('')
  const data = await fetchOverpass(query, signal)

  const label = ALONG_ROUTE_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'Lieu'
  const places: AlongRoutePlace[] = []
  for (const element of data.elements ?? []) {
    const point = getElementPoint(element)
    if (!point) continue
    const progress = getRouteProgress(coordinates, point, fromAlong)
    const distanceAhead = progress.along - fromAlong
    if (distanceAhead < 50 || progress.distance > SEARCH_RADIUS_METERS + SIMPLIFY_TOLERANCE_METERS) continue
    places.push({
      id: `osm-${element.type ?? 'node'}-${element.id}`,
      category,
      name: element.tags?.name ?? element.tags?.brand ?? element.tags?.operator ?? label,
      details: [label, element.tags?.brand && element.tags.brand !== element.tags.name ? element.tags.brand : null]
        .filter(Boolean)
        .join(' · '),
      coordinates: point,
      distanceAhead,
      distanceFromRoute: progress.distance,
    })
  }

  // Les doublons (même station en point et en contour) sont proches : on garde le premier.
  places.sort((first, second) => first.distanceAhead - second.distanceAhead)
  const unique: AlongRoutePlace[] = []
  for (const place of places) {
    if (unique.some((kept) => Math.abs(kept.distanceAhead - place.distanceAhead) < 60 && kept.name === place.name)) continue
    unique.push(place)
    if (unique.length >= MAX_RESULTS) break
  }
  return unique
}

function getElementPoint(element: OverpassElement): Point | null {
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null
}
