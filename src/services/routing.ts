import axios from 'axios'
import type { Destination, RouteMode, RouteSummary, RouteStep, TollPreference } from '../types/geocoding'

const VALHALLA_API_URL = 'https://valhalla1.openstreetmap.de/route'

interface ValhallaTrip {
  summary?: { length: number; time: number }
  legs?: {
    shape: string
    maneuvers: ValhallaManeuver[]
  }[]
}

interface ValhallaManeuver {
  type: number
  instruction: string
  time: number
  length: number
  begin_shape_index: number
  end_shape_index: number
  street_names?: string[]
}

interface ValhallaRouteResponse {
  trip?: ValhallaTrip
  alternates?: { trip: ValhallaTrip }[]
  error?: string
  status_message?: string
}

export async function calculateRoute(
  origin: Destination,
  destination: Destination,
  mode: RouteMode = 'driving',
  waypoints: Destination[] = [],
  tollPreference: TollPreference = 'with-tolls',
  signal?: AbortSignal,
): Promise<RouteSummary[]> {
  const isDriving = mode === 'driving'
  const response = await axios.get<ValhallaRouteResponse>(VALHALLA_API_URL, {
    params: {
      json: JSON.stringify({
        locations: [origin, ...waypoints, destination].map((place) => ({
          lat: place.coordinates[1],
          lon: place.coordinates[0],
        })),
        costing: isDriving ? 'auto' : mode === 'walking' ? 'pedestrian' : 'bicycle',
        ...(isDriving && {
          costing_options: {
            auto: { use_tolls: tollPreference === 'with-tolls' ? 1 : 0 },
          },
        }),
        units: 'kilometers',
        language: 'fr-FR',
        alternates: 2,
      }),
    },
    signal,
    timeout: 20000,
  })

  const trips = [
    ...(response.data.trip ? [response.data.trip] : []),
    ...(response.data.alternates ?? []).map((alternate) => alternate.trip),
  ]
  if (trips.length === 0) throw new Error(response.data.error || 'InvalidRouteResponse')

  return trips.map((trip) => parseValhallaTrip(trip, response.data.error))
}

function parseValhallaTrip(trip: ValhallaTrip, error?: string): RouteSummary {
  const legs = trip?.legs ?? []
  const coordinates: [number, number][] = []
  const steps: RouteStep[] = []
  legs.forEach((leg, legIndex) => {
    const legCoordinates = decodePolyline(leg.shape, 6)
    const maneuvers = leg.maneuvers
    if (
      legCoordinates.length < 2 ||
      maneuvers.some(
        (maneuver) =>
          !Number.isFinite(maneuver.time) ||
          !Number.isFinite(maneuver.length) ||
          !Number.isInteger(maneuver.begin_shape_index) ||
          maneuver.begin_shape_index < 0 ||
          maneuver.begin_shape_index >= legCoordinates.length,
      )
    ) {
      throw new Error(error || 'InvalidRouteResponse')
    }

    const sharesBoundary =
      coordinates.length > 0 &&
      coordinates[coordinates.length - 1][0] === legCoordinates[0][0] &&
      coordinates[coordinates.length - 1][1] === legCoordinates[0][1]
    coordinates.push(...legCoordinates.slice(sharesBoundary ? 1 : 0))

    steps.push(
      ...maneuvers
        .filter((maneuver) => ![1, 2, 3].includes(maneuver.type))
        .filter((maneuver) => legIndex === legs.length - 1 || ![4, 5, 6].includes(maneuver.type))
        .map((maneuver) => {
          const { type, modifier } = normalizeValhallaManeuver(maneuver.type)
          return {
            distance: maneuver.length * 1000,
            duration: maneuver.time,
            name: maneuver.street_names?.[0] ?? '',
            maneuver: {
              type,
              modifier,
              location: legCoordinates[maneuver.begin_shape_index],
            },
          }
        }),
    )
  })

  if (
    !trip?.summary ||
    !Number.isFinite(trip.summary.length) ||
    !Number.isFinite(trip.summary.time) ||
    coordinates.length < 2 ||
    legs.length === 0 ||
    coordinates.some(
      ([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude),
    )
  ) {
    throw new Error(error || 'InvalidRouteResponse')
  }

  if (steps.length === 0) {
    throw new Error('InvalidRouteResponse')
  }

  return {
    coordinates,
    distance: trip.summary.length * 1000,
    duration: trip.summary.time,
    steps,
  }
}

function decodePolyline(encoded: string, precision: number): [number, number][] {
  const coordinates: [number, number][] = []
  const factor = 10 ** precision
  let index = 0
  let latitude = 0
  let longitude = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded.length) throw new Error('InvalidRouteResponse')
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) throw new Error('InvalidRouteResponse')
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    latitude += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      if (index >= encoded.length) throw new Error('InvalidRouteResponse')
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) throw new Error('InvalidRouteResponse')
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    longitude += result & 1 ? ~(result >> 1) : result >> 1
    coordinates.push([longitude / factor, latitude / factor])
  }

  return coordinates
}

function normalizeValhallaManeuver(type: number): { type: string; modifier?: string } {
  switch (type) {
    case 4:
    case 5:
    case 6:
      return { type: 'arrive' }
    case 9:
      return { type: 'turn', modifier: 'slight right' }
    case 10:
      return { type: 'turn', modifier: 'right' }
    case 11:
      return { type: 'turn', modifier: 'sharp right' }
    case 12:
      return { type: 'turn', modifier: 'uturn' }
    case 13:
      return { type: 'turn', modifier: 'sharp left' }
    case 14:
      return { type: 'turn', modifier: 'left' }
    case 15:
      return { type: 'turn', modifier: 'slight left' }
    case 17:
    case 19:
    case 22:
      return { type: 'turn', modifier: 'right' }
    case 18:
    case 20:
    case 23:
      return { type: 'turn', modifier: 'left' }
    case 24:
      return { type: 'merge' }
    case 25:
      return { type: 'roundabout' }
    case 26:
      return { type: 'exit rotary' }
    case 8:
    case 16:
    case 21:
    default:
      return { type: 'continue' }
  }
}

export function getRoutingErrorMessage(error: unknown, mode: RouteMode = 'driving'): string {
  const modeName = getRouteModeLabel(mode).toLocaleLowerCase('fr-FR')
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'Le calcul de l’itinéraire prend trop de temps.'
    if (!error.response) return 'Impossible de contacter le service de calcul d’itinéraire. Vérifiez votre connexion.'
    if (error.response.status === 429) return 'Trop de demandes d’itinéraire rapprochées. Réessayez dans un instant.'
    return 'Le service de calcul d’itinéraire est momentanément indisponible. Réessayez.'
  }

  if (error instanceof Error) {
    if (error.message === 'NoRoute' || error.message === 'NoSuitableEdges') {
      return `Aucun itinéraire ${modeName} trouvé entre ces deux lieux.`
    }
    if (error.message === 'NoSegment') return 'Un des lieux est trop éloigné d’une voie accessible.'
    if (error.message === 'InvalidRouteResponse') {
      return 'Le service de calcul a renvoyé un itinéraire invalide.'
    }
  }

  return `Impossible de calculer cet itinéraire ${modeName}.`
}

export function getRouteModeLabel(mode: RouteMode): string {
  switch (mode) {
    case 'walking':
      return 'À pied'
    case 'cycling':
      return 'À vélo'
    default:
      return 'En voiture'
  }
}

export function getRouteProviderLabel(): string {
  return 'Valhalla · OpenStreetMap'
}
