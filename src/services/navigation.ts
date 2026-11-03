import type { RouteStep, RouteSummary } from '../types/geocoding'

const EARTH_RADIUS_METERS = 6_371_000

export interface NavigationGuidance {
  stepIndex: number
  distanceToStep: number
  distanceFromRoute: number
}

export interface RemainingRouteMetrics {
  distance: number
  duration: number
}

export type ManeuverDirection = 'straight' | 'left' | 'right' | 'uturn' | 'roundabout'

export function getRemainingRouteMetrics(
  route: RouteSummary,
  guidance: NavigationGuidance | null,
): RemainingRouteMetrics {
  if (!guidance) return { distance: route.distance, duration: route.duration }

  const currentStep = route.steps[guidance.stepIndex]
  if (!currentStep) return { distance: 0, duration: 0 }

  const laterSteps = route.steps.slice(guidance.stepIndex + 1)
  const currentStepProgress =
    currentStep.distance > 0
      ? Math.min(guidance.distanceToStep / currentStep.distance, 1)
      : 0

  return {
    distance: guidance.distanceToStep + laterSteps.reduce((total, step) => total + step.distance, 0),
    duration:
      currentStep.duration * currentStepProgress +
      laterSteps.reduce((total, step) => total + step.duration, 0),
  }
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

export function getRouteBearing(
  route: RouteSummary,
  position: [longitude: number, latitude: number],
): number | null {
  const nearestIndex = findNearestCoordinateIndex(route.coordinates, position)

  for (let index = nearestIndex + 1; index < route.coordinates.length; index += 1) {
    if (distanceBetween(route.coordinates[nearestIndex], route.coordinates[index]) > 5) {
      return calculateBearing(route.coordinates[nearestIndex], route.coordinates[index])
    }
  }

  for (let index = nearestIndex - 1; index >= 0; index -= 1) {
    if (distanceBetween(route.coordinates[index], route.coordinates[nearestIndex]) > 5) {
      return calculateBearing(route.coordinates[index], route.coordinates[nearestIndex])
    }
  }

  return null
}

export function getNavigationGuidance(
  route: RouteSummary,
  position: [longitude: number, latitude: number],
  currentStepIndex: number,
): NavigationGuidance {
  const nearestPosition = findNearestCoordinate(route.coordinates, position)
  const positionIndex = nearestPosition.index
  let stepIndex = Math.min(currentStepIndex, Math.max(route.steps.length - 1, 0))

  while (
    stepIndex < route.steps.length - 1 &&
    positionIndex >= findNearestCoordinateIndex(route.coordinates, route.steps[stepIndex].maneuver.location)
  ) {
    stepIndex += 1
  }

  const maneuverIndex = findNearestCoordinateIndex(
    route.coordinates,
    route.steps[stepIndex].maneuver.location,
  )
  const startIndex = Math.min(positionIndex, maneuverIndex)
  const endIndex = Math.max(positionIndex, maneuverIndex)
  let distanceToStep = 0

  for (let index = startIndex; index < endIndex; index += 1) {
    distanceToStep += distanceBetween(route.coordinates[index], route.coordinates[index + 1])
  }

  return { stepIndex, distanceToStep, distanceFromRoute: nearestPosition.distance }
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

function findNearestCoordinateIndex(
  coordinates: [longitude: number, latitude: number][],
  position: [longitude: number, latitude: number],
): number {
  return findNearestCoordinate(coordinates, position).index
}

function findNearestCoordinate(
  coordinates: [longitude: number, latitude: number][],
  position: [longitude: number, latitude: number],
): { index: number; distance: number } {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = distanceBetween(coordinates[index], position)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  return { index: nearestIndex, distance: nearestDistance }
}

function distanceBetween(
  first: [longitude: number, latitude: number],
  second: [longitude: number, latitude: number],
): number {
  const latitudeDifference = toRadians(second[1] - first[1])
  const longitudeDifference = toRadians(second[0] - first[0])
  const firstLatitude = toRadians(first[1])
  const secondLatitude = toRadians(second[1])
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDifference / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function calculateBearing(
  from: [longitude: number, latitude: number],
  to: [longitude: number, latitude: number],
): number {
  const fromLatitude = toRadians(from[1])
  const toLatitude = toRadians(to[1])
  const longitudeDifference = toRadians(to[0] - from[0])
  const y = Math.sin(longitudeDifference) * Math.cos(toLatitude)
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDifference)

  return (Math.atan2(y, x) * 180) / Math.PI
}
