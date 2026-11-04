// Mouvement affiché de la position, recalculé à chaque image (requestAnimationFrame).
//
// Le GPS ne donne qu'environ un point par seconde. Entre deux points :
// - on PRÉDIT la position à partir de la vitesse (sur le tracé, ou en ligne droite hors trajet),
//   ce qui supprime le retard d'environ une seconde d'une simple interpolation ;
// - sur le trajet, la position est COLLÉE AU TRACÉ (comme les GPS du commerce) ;
// - à chaque nouveau point, l'écart entre ce qui était affiché et la nouvelle prédiction
//   est résorbé en douceur (correction qui décroît), donc jamais de saut.

import { getPointAtDistance, getRouteGeometry, type Point } from './routeGeometry'

/** On n'extrapole pas au-delà : si le GPS se tait, la voiture s'arrête au lieu de partir seule. */
const MAX_PREDICTION_MS = 2_000
/** Temps de résorption de l'écart lors d'un nouveau point GPS. */
const CORRECTION_TAU_MS = 700
/** Au-delà de cet écart (premier point, saut GPS, changement de trajet), on se place directement. */
const SNAP_DISTANCE_METERS = 250
/** En dessous, le véhicule est considéré à l'arrêt : pas de prédiction, cap GPS ignoré. */
const MIN_MOVING_SPEED_MS = 1.5
/** Distance devant la position utilisée pour le cap du tracé. */
const ROUTE_BEARING_LOOKAHEAD_METERS = 20

const METERS_PER_LATITUDE_DEGREE = 110_540
const metersPerLongitudeDegree = (latitude: number) => 111_320 * Math.cos((latitude * Math.PI) / 180)

export interface MotionFixInput {
  coordinates: Point
  speed: number | null
  heading: number | null
  /** Trajet sur lequel coller la position, avec la progression mesurée pour ce point. */
  snap: { coordinates: Point[]; along: number } | null
  /** Cap à utiliser si ni le GPS ni le tracé n'en donnent un fiable. */
  fallbackHeading: number | null
}

interface MotionBase {
  time: number
  speed: number
  heading: number
  coordinates: Point
  snap: { coordinates: Point[]; along: number; total: number } | null
}

export interface MotionState extends MotionBase {
  /** Écart (en degrés) entre l'affichage précédent et cette prédiction, résorbé avec le temps. */
  correction: Point
  headingCorrection: number
}

export interface MotionFrame {
  coordinates: Point
  heading: number
  /** true quand plus rien ne bouge (arrêt et correction résorbée) : inutile de redessiner. */
  settled: boolean
}

export const getAngleDelta = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180

export function createMotionState(fix: MotionFixInput, now: number, previous: MotionState | null): MotionState {
  const displayed = previous ? getMotionFrame(previous, now) : null
  const speed = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= MIN_MOVING_SPEED_MS ? fix.speed : 0
  const snap = fix.snap
    ? { ...fix.snap, total: getRouteGeometry(fix.snap.coordinates).total }
    : null
  const gpsHeading = speed > 0 && fix.heading !== null && Number.isFinite(fix.heading) ? fix.heading : null

  const base: MotionBase = {
    time: now,
    speed,
    heading: 0,
    coordinates: fix.coordinates,
    snap,
  }
  const start = getBaseAt(base, now)
  // Sur le trajet, le cap suit le tracé. Hors trajet : cap GPS en mouvement, sinon on garde l'actuel.
  base.heading = snap ? start.heading : gpsHeading ?? fix.fallbackHeading ?? displayed?.heading ?? 0
  const startHeading = snap ? start.heading : base.heading

  const state: MotionState = { ...base, correction: [0, 0], headingCorrection: 0 }
  if (!displayed) return state

  const gapMeters = Math.hypot(
    (displayed.coordinates[0] - start.coordinates[0]) * metersPerLongitudeDegree(start.coordinates[1]),
    (displayed.coordinates[1] - start.coordinates[1]) * METERS_PER_LATITUDE_DEGREE,
  )
  if (gapMeters > SNAP_DISTANCE_METERS) return state

  state.correction = [
    displayed.coordinates[0] - start.coordinates[0],
    displayed.coordinates[1] - start.coordinates[1],
  ]
  state.headingCorrection = getAngleDelta(startHeading, displayed.heading)
  return state
}

export function getMotionFrame(state: MotionState, now: number): MotionFrame {
  const base = getBaseAt(state, now)
  const decay = Math.exp(-Math.max(0, now - state.time) / CORRECTION_TAU_MS)
  const residual = Math.max(
    Math.abs(state.correction[0]) * metersPerLongitudeDegree(base.coordinates[1]),
    Math.abs(state.correction[1]) * METERS_PER_LATITUDE_DEGREE,
  ) * decay
  const stopped = state.speed === 0 || now - state.time >= MAX_PREDICTION_MS
  return {
    coordinates: [
      base.coordinates[0] + state.correction[0] * decay,
      base.coordinates[1] + state.correction[1] * decay,
    ],
    heading: base.heading + state.headingCorrection * decay,
    settled: stopped && residual < 0.05 && Math.abs(state.headingCorrection * decay) < 0.1,
  }
}

/** Position prédite sans correction : avancée sur le tracé, ou en ligne droite hors trajet. */
function getBaseAt(base: MotionBase, now: number): { coordinates: Point; heading: number } {
  const elapsedSeconds = Math.min(Math.max(0, now - base.time), MAX_PREDICTION_MS) / 1000
  const travelled = base.speed * elapsedSeconds

  if (base.snap) {
    const along = Math.min(base.snap.along + travelled, base.snap.total)
    const lookFrom = Math.min(along, Math.max(0, base.snap.total - ROUTE_BEARING_LOOKAHEAD_METERS))
    const coordinates = getPointAtDistance(base.snap.coordinates, along)
    const ahead = getPointAtDistance(base.snap.coordinates, lookFrom + ROUTE_BEARING_LOOKAHEAD_METERS)
    const behind = lookFrom === along ? coordinates : getPointAtDistance(base.snap.coordinates, lookFrom)
    return { coordinates, heading: getBearing(behind, ahead) ?? base.heading }
  }

  const radians = (base.heading * Math.PI) / 180
  return {
    coordinates: [
      base.coordinates[0] + (Math.sin(radians) * travelled) / metersPerLongitudeDegree(base.coordinates[1]),
      base.coordinates[1] + (Math.cos(radians) * travelled) / METERS_PER_LATITUDE_DEGREE,
    ],
    heading: base.heading,
  }
}

function getBearing(from: Point, to: Point): number | null {
  const x = (to[0] - from[0]) * metersPerLongitudeDegree(from[1])
  const y = (to[1] - from[1]) * METERS_PER_LATITUDE_DEGREE
  if (Math.hypot(x, y) < 0.5) return null
  return (Math.atan2(x, y) * 180) / Math.PI
}

/**
 * Zoom de conduite : proche en ville, plus large sur voie rapide pour voir loin,
 * et rapproché à l'approche d'une manœuvre.
 */
export function getDrivingZoom(speedMs: number | null, distanceToManeuver: number | null): number {
  const kmh = Math.max(0, speedMs ?? 0) * 3.6
  const table: [number, number][] = [
    [0, 17.6],
    [30, 17.4],
    [50, 17],
    [80, 16.4],
    [110, 15.8],
    [130, 15.4],
  ]
  let zoom = table[table.length - 1][1]
  for (let index = 1; index < table.length; index += 1) {
    const [toKmh, toZoom] = table[index]
    if (kmh <= toKmh) {
      const [fromKmh, fromZoom] = table[index - 1]
      zoom = fromZoom + ((kmh - fromKmh) / (toKmh - fromKmh)) * (toZoom - fromZoom)
      break
    }
  }

  if (distanceToManeuver !== null && distanceToManeuver < 300) {
    // Jusqu'à 17,3 en arrivant sur la manœuvre, progressivement à partir de 300 m.
    const closeness = 1 - Math.max(0, distanceToManeuver - 60) / 240
    zoom = Math.max(zoom, zoom + (17.3 - zoom) * Math.min(1, closeness))
  }
  return zoom
}
