import type { RouteSummary } from '../types/geocoding'

export type RouteControlType = 'stop' | 'traffic-light'

export interface RouteControl {
  id: string
  type: RouteControlType
  coordinates: [longitude: number, latitude: number]
}

interface OverpassElement {
  id: number
  lat: number
  lon: number
  tags?: {
    highway?: string
    traffic_sign?: string
    traffic_signals?: string
  }
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'
const SEARCH_RADIUS_METERS = 55
const ROUTE_MATCH_DISTANCE_METERS = 35
const MAX_SAMPLES = 450
const SAMPLES_PER_REQUEST = 150

export async function getRouteControls(
  route: RouteSummary,
  signal: AbortSignal,
): Promise<RouteControl[]> {
  const samples = sampleRoute(route.coordinates)
  const controls = new Map<string, RouteControl>()

  for (let index = 0; index < samples.length; index += SAMPLES_PER_REQUEST) {
    const batch = samples.slice(index, index + SAMPLES_PER_REQUEST)
    const selectors = batch.flatMap(([longitude, latitude]) => {
      const point = `around:${SEARCH_RADIUS_METERS},${latitude},${longitude}`
      return [
        `node(${point})[highway~"^(traffic_signals|stop)$"];`,
        `node(${point})[traffic_sign~"(^|:)(stop|stop_sign|AB4|R1-1|206)$",i];`,
      ]
    })
    const query = `[out:json][timeout:20];(${selectors.join('')});out body;`
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal,
    })

    if (!response.ok) {
      throw new Error(`OpenStreetMap route-control lookup failed (${response.status}).`)
    }

    const data = (await response.json()) as OverpassResponse
    for (const element of data.elements ?? []) {
      if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon)) continue
      const coordinates: [number, number] = [element.lon, element.lat]
      if (getRouteDistanceMeters(coordinates, route.coordinates) > ROUTE_MATCH_DISTANCE_METERS) continue

      const type =
        element.tags?.highway === 'traffic_signals' || element.tags?.traffic_signals
          ? 'traffic-light'
          : 'stop'
      controls.set(String(element.id), { id: String(element.id), type, coordinates })
    }
  }

  return [...controls.values()]
}

function sampleRoute(coordinates: [number, number][]): [number, number][] {
  if (coordinates.length < 2) return coordinates
  const routeLength = coordinates.slice(1).reduce(
    (total, point, index) => total + getPointDistanceMeters(coordinates[index], point),
    0,
  )
  const spacing = Math.max(100, routeLength / MAX_SAMPLES)
  const samples: [number, number][] = [coordinates[0]]
  let distanceToNextSample = spacing
  let distanceSinceSample = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1]
    const end = coordinates[index]
    const segmentLength = getPointDistanceMeters(start, end)
    if (segmentLength === 0) continue

    while (distanceSinceSample + segmentLength >= distanceToNextSample) {
      const fraction = (distanceToNextSample - distanceSinceSample) / segmentLength
      samples.push([
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ])
      distanceToNextSample += spacing
    }
    distanceSinceSample += segmentLength
  }

  const last = coordinates[coordinates.length - 1]
  if (getPointDistanceMeters(samples[samples.length - 1], last) > SEARCH_RADIUS_METERS / 2) {
    samples.push(last)
  }
  return samples
}

function getRouteDistanceMeters(
  point: [number, number],
  route: [number, number][],
): number {
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < route.length; index += 1) {
    minimumDistance = Math.min(minimumDistance, getSegmentDistanceMeters(point, route[index - 1], route[index]))
  }
  return minimumDistance
}

function getSegmentDistanceMeters(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const latitudeRadians = (point[1] * Math.PI) / 180
  const metersPerLongitudeDegree = 111_320 * Math.cos(latitudeRadians)
  const metersPerLatitudeDegree = 110_540
  const pointX = (point[0] - start[0]) * metersPerLongitudeDegree
  const pointY = (point[1] - start[1]) * metersPerLatitudeDegree
  const segmentX = (end[0] - start[0]) * metersPerLongitudeDegree
  const segmentY = (end[1] - start[1]) * metersPerLatitudeDegree
  const lengthSquared = segmentX ** 2 + segmentY ** 2
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared))
  return Math.hypot(pointX - projection * segmentX, pointY - projection * segmentY)
}

function getPointDistanceMeters(first: [number, number], second: [number, number]): number {
  const latitudeRadians = (first[1] * Math.PI) / 180
  return Math.hypot(
    (first[0] - second[0]) * 111_320 * Math.cos(latitudeRadians),
    (first[1] - second[1]) * 110_540,
  )
}
