// Guidage de voies : quelles voies prendre aux intersections et échangeurs.
// Chargé une seule fois au démarrage de la navigation (Valhalla trace_route, format OSRM).
import type { RouteSummary } from '../types/geocoding'
import { getRouteProgress, type Point } from './routeGeometry'
import { chunkLine, fetchTraceRouteOsrm, VALHALLA_MAX_POINTS } from './valhalla'

export interface Lane {
  /** Flèches au sol : straight, left, right, slight right, sharp left, uturn, none… */
  indications: string[]
  /** La voie permet de suivre le trajet. */
  valid: boolean
  /** Flèche de cette voie qui correspond au trajet. */
  validIndication?: string
}

export interface LaneGuide {
  /** Position de l'intersection, en mètres depuis le départ. */
  along: number
  lanes: Lane[]
}

/** Au-delà, l'intersection renvoyée ne correspond pas à notre tracé. */
const MATCH_DISTANCE_METERS = 20
/** Distance à partir de laquelle on montre les voies de la prochaine intersection. */
export const LANES_SHOW_AHEAD_METERS = 800

const cache = new WeakMap<RouteSummary, LaneGuide[]>()

export async function getRouteLanes(route: RouteSummary, signal: AbortSignal): Promise<LaneGuide[]> {
  const cached = cache.get(route)
  if (cached) return cached

  const coordinates = route.coordinates as Point[]
  const guides: LaneGuide[] = []
  let hint: number | undefined

  for (const chunk of chunkLine(coordinates, VALHALLA_MAX_POINTS)) {
    const data = await fetchTraceRouteOsrm(chunk.points, signal)
    for (const matching of data.matchings ?? []) {
      for (const leg of matching.legs ?? []) {
        for (const step of leg.steps ?? []) {
          for (const intersection of step.intersections ?? []) {
            const lanes = (intersection.lanes ?? []).map((lane) => ({
              indications: lane.indications?.length ? lane.indications : ['none'],
              valid: Boolean(lane.valid),
              validIndication: lane.valid_indication,
            }))
            // Rien à montrer s'il n'y a qu'une voie ou si toutes conviennent.
            if (lanes.length < 2 || lanes.every((lane) => lane.valid)) continue
            const progress = getRouteProgress(coordinates, intersection.location, hint)
            if (progress.distance > MATCH_DISTANCE_METERS) continue
            hint = progress.along
            guides.push({ along: progress.along, lanes })
          }
        }
      }
    }
  }

  guides.sort((first, second) => first.along - second.along)
  cache.set(route, guides)
  return guides
}

/** Prochaine intersection avec des voies, si elle est à moins de LANES_SHOW_AHEAD_METERS. */
export function getUpcomingLanes(
  guides: LaneGuide[],
  along: number,
): { guide: LaneGuide; distance: number } | null {
  const guide = guides.find((candidate) => candidate.along >= along - 5)
  if (!guide) return null
  const distance = Math.max(0, guide.along - along)
  return distance <= LANES_SHOW_AHEAD_METERS ? { guide, distance } : null
}
