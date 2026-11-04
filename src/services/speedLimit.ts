type Coordinates = [longitude: number, latitude: number]

interface OverpassWay {
  tags?: { maxspeed?: string }
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements?: OverpassWay[]
}

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

export async function getSpeedLimit(
  coordinates: Coordinates,
  signal: AbortSignal,
): Promise<number | null> {
  const [longitude, latitude] = coordinates
  const query = [
    '[out:json][timeout:12];',
    `way(around:35,${latitude},${longitude})[highway][maxspeed];`,
    'out tags geom;',
  ].join('')
  const response = await fetch(OVERPASS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: query }),
    signal,
  })

  if (!response.ok) throw new Error(`OpenStreetMap speed lookup failed (${response.status}).`)

  const data = (await response.json()) as OverpassResponse
  const nearestWay = (data.elements ?? [])
    .map((way) => ({
      distance: getWayDistanceMeters(coordinates, way.geometry ?? []),
      speedLimit: parseSpeedLimit(way.tags?.maxspeed),
    }))
    .filter((way): way is { distance: number; speedLimit: number } =>
      Number.isFinite(way.distance) && way.speedLimit !== null,
    )
    .sort((first, second) => first.distance - second.distance)[0]

  return nearestWay?.speedLimit ?? null
}

function parseSpeedLimit(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(km\/h|kph|mph)?$/i)
  if (!match) return null

  const speed = Number(match[1])
  if (!Number.isFinite(speed) || speed <= 0) return null
  return Math.round(match[2]?.toLowerCase() === 'mph' ? speed * 1.60934 : speed)
}

function getWayDistanceMeters(
  coordinates: Coordinates,
  geometry: { lat: number; lon: number }[],
): number {
  if (geometry.length === 0) return Number.POSITIVE_INFINITY
  if (geometry.length === 1) {
    return getPointDistanceMeters(coordinates, [geometry[0].lon, geometry[0].lat])
  }

  let minimumDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < geometry.length; index += 1) {
    minimumDistance = Math.min(
      minimumDistance,
      getSegmentDistanceMeters(coordinates, geometry[index - 1], geometry[index]),
    )
  }
  return minimumDistance
}

function getSegmentDistanceMeters(
  point: Coordinates,
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): number {
  const latitudeRadians = (point[1] * Math.PI) / 180
  const metersPerLongitudeDegree = 111_320 * Math.cos(latitudeRadians)
  const metersPerLatitudeDegree = 110_540
  const pointX = (point[0] - start.lon) * metersPerLongitudeDegree
  const pointY = (point[1] - start.lat) * metersPerLatitudeDegree
  const segmentX = (end.lon - start.lon) * metersPerLongitudeDegree
  const segmentY = (end.lat - start.lat) * metersPerLatitudeDegree
  const lengthSquared = segmentX ** 2 + segmentY ** 2
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared))
  return Math.hypot(pointX - projection * segmentX, pointY - projection * segmentY)
}

function getPointDistanceMeters(first: Coordinates, second: Coordinates): number {
  const latitudeRadians = (first[1] * Math.PI) / 180
  return Math.hypot(
    (first[0] - second[0]) * 111_320 * Math.cos(latitudeRadians),
    (first[1] - second[1]) * 110_540,
  )
}
