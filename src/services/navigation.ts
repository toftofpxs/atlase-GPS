import type { RouteStep, RouteSummary } from '../types/geocoding'
import { getPointAtDistance, getRouteGeometry, getRouteProgress, type Point } from './routeGeometry'

export interface NavigationGuidance {
  stepIndex: number
  /** Distance jusqu'à la prochaine manœuvre, mesurée sur le tracé. */
  distanceToStep: number
  /** Écart entre la position et le tracé (projection sur les tronçons). */
  distanceFromRoute: number
  /** Distance parcourue depuis le départ, en mètres. */
  along: number
}

export interface RemainingRouteMetrics {
  distance: number
  duration: number
}

export type ManeuverDirection = 'straight' | 'left' | 'right' | 'uturn' | 'roundabout'

/** Une manœuvre est considérée comme passée quand on est à moins de cette distance. */
const MANEUVER_PASSED_METERS = 5

/** Hors itinéraire : à plus de 75 m du tracé (ou plus si le GPS est imprécis). */
export function isOffRoute(guidance: NavigationGuidance | null, accuracy: number): boolean {
  return Boolean(guidance && guidance.distanceFromRoute > Math.max(75, accuracy * 1.5))
}

interface RouteTimeline {
  /** Distance depuis le départ de chaque manœuvre. */
  stepAlong: number[]
  /** Morceaux du trajet avec leur durée, pour estimer le temps restant. */
  spans: { start: number; end: number; duration: number }[]
}

const timelineCache = new WeakMap<RouteSummary, RouteTimeline>()

/** Calculé une seule fois par trajet. */
function getRouteTimeline(route: RouteSummary): RouteTimeline {
  const cached = timelineCache.get(route)
  if (cached) return cached

  const { cumulative, total } = getRouteGeometry(route.coordinates as Point[])
  const stepAlong = route.steps.map((step) => cumulative[step.maneuver.shapeIndex] ?? total)
  const spans = route.steps.map((step, index) => ({
    start: stepAlong[index],
    end: stepAlong[index + 1] ?? total,
    duration: step.duration,
  }))
  // Les manœuvres de départ sont retirées des étapes : leur durée est attribuée au début du trajet.
  const stepsDuration = route.steps.reduce((sum, step) => sum + step.duration, 0)
  spans.unshift({ start: 0, end: stepAlong[0] ?? total, duration: Math.max(0, route.duration - stepsDuration) })

  const timeline = { stepAlong, spans }
  timelineCache.set(route, timeline)
  return timeline
}

/**
 * Position sur le trajet et prochaine manœuvre.
 * `hintAlong` (progression précédente) limite la recherche autour de la dernière position.
 */
export function getNavigationGuidance(
  route: RouteSummary,
  position: Point,
  currentStepIndex: number,
  hintAlong?: number,
): NavigationGuidance {
  const progress = getRouteProgress(route.coordinates as Point[], position, hintAlong)
  const { stepAlong } = getRouteTimeline(route)
  let stepIndex = Math.min(currentStepIndex, Math.max(route.steps.length - 1, 0))

  while (stepIndex < route.steps.length - 1 && stepAlong[stepIndex] <= progress.along + MANEUVER_PASSED_METERS) {
    stepIndex += 1
  }

  return {
    stepIndex,
    distanceToStep: Math.max(0, (stepAlong[stepIndex] ?? progress.along) - progress.along),
    distanceFromRoute: progress.distance,
    along: progress.along,
  }
}

export function getRemainingRouteMetrics(
  route: RouteSummary,
  guidance: NavigationGuidance | null,
): RemainingRouteMetrics {
  if (!guidance) return { distance: route.distance, duration: route.duration }

  const { total } = getRouteGeometry(route.coordinates as Point[])
  const { spans } = getRouteTimeline(route)
  const along = guidance.along
  let duration = 0
  for (const span of spans) {
    if (span.end <= along) continue
    const length = span.end - span.start
    duration += span.start >= along || length <= 0
      ? span.duration
      : (span.duration * (span.end - along)) / length
  }

  // La longueur du tracé diffère légèrement de celle annoncée par Valhalla : on garde son échelle.
  const remainingRatio = total > 0 ? Math.max(0, total - along) / total : 0
  return { distance: route.distance * remainingRatio, duration }
}

export function getManeuverDirection(step?: RouteStep): ManeuverDirection {
  if (!step) return 'straight'
  if (step.maneuver.type === 'roundabout' || step.maneuver.type === 'rotary') return 'roundabout'

  switch (step.maneuver.modifier) {
    case 'uturn':
      return 'uturn'
    case 'right':
    case 'slight right':
    case 'sharp right':
      return 'right'
    case 'left':
    case 'slight left':
    case 'sharp left':
      return 'left'
    default:
      return 'straight'
  }
}

/** Cap du trajet à l'endroit où se trouve l'utilisateur (vers un point 20 m plus loin). */
export function getRouteBearing(route: RouteSummary, along: number): number | null {
  const coordinates = route.coordinates as Point[]
  const { total } = getRouteGeometry(coordinates)
  if (total < 5) return null
  const from = Math.min(along, total - 5)
  return calculateBearing(getPointAtDistance(coordinates, from), getPointAtDistance(coordinates, from + 20))
}

export function formatManeuver(step: RouteStep): string {
  const modifier = formatModifier(step.maneuver.modifier)
  const road = step.name ? ` sur ${step.name}` : ''

  switch (step.maneuver.type) {
    case 'arrive':
      return 'Vous êtes arrivé à destination.'
    case 'turn':
      if (step.maneuver.modifier === 'uturn') return `Faites demi-tour${road}.`
      return modifier ? `Tournez ${modifier}${road}.` : `Continuez tout droit${road}.`
    case 'new name':
    case 'continue':
      return modifier && modifier !== 'tout droit'
        ? `Continuez ${modifier}${road}.`
        : `Continuez${road || ' tout droit'}.`
    case 'merge':
      return `Rejoignez${road || ' la voie principale'}.`
    case 'on ramp':
      return `Prenez la bretelle d’accès${road}.`
    case 'off ramp':
      return `Prenez la sortie${road}.`
    case 'fork':
      return modifier ? `À la bifurcation, prenez ${modifier}${road}.` : `À la bifurcation${road}.`
    case 'end of road':
      return modifier ? `Au bout de la route, tournez ${modifier}${road}.` : `Au bout de la route${road}.`
    case 'roundabout':
    case 'rotary':
      return step.maneuver.exit
        ? `Au rond-point, prenez la ${formatOrdinal(step.maneuver.exit)} sortie${road}.`
        : `Au rond-point, prenez la sortie indiquée${road}.`
    case 'roundabout turn':
      return `Continuez dans le rond-point${road}.`
    case 'exit rotary':
      return `Sortez du rond-point${road}.`
    default:
      return `Continuez${road || ' tout droit'}.`
  }
}

function formatModifier(modifier?: string): string {
  switch (modifier) {
    case 'uturn':
      return 'faites demi-tour'
    case 'sharp right':
      return 'fortement à droite'
    case 'right':
      return 'à droite'
    case 'slight right':
      return 'légèrement à droite'
    case 'straight':
      return 'tout droit'
    case 'slight left':
      return 'légèrement à gauche'
    case 'left':
      return 'à gauche'
    case 'sharp left':
      return 'fortement à gauche'
    default:
      return ''
  }
}

function formatOrdinal(value: number): string {
  return value === 1 ? '1re' : `${value}e`
}


function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function calculateBearing(from: Point, to: Point): number {
  const fromLatitude = toRadians(from[1])
  const toLatitude = toRadians(to[1])
  const longitudeDifference = toRadians(to[0] - from[0])
  const y = Math.sin(longitudeDifference) * Math.cos(toLatitude)
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDifference)

  return (Math.atan2(y, x) * 180) / Math.PI
}
