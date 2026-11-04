// Trajet en cours, sauvegardé à part (clé dédiée) pour pouvoir reprendre la navigation
// si l'appli est fermée ou rechargée. Écrit seulement au démarrage, au recalcul et à l'arrêt :
// jamais à chaque point GPS (un trajet peut peser plusieurs centaines de Ko).
import type { Destination, RouteMode, RouteSummary, TollPreference } from '../types/geocoding'

const STORAGE_KEY = 'atlas-active-trip'
/** Au-delà, on ne propose plus de reprendre : le trajet est sans doute terminé. */
const MAX_AGE_MS = 3 * 60 * 60 * 1000

export interface ActiveTrip {
  version: 1
  savedAt: number
  origin: Destination | null
  destination: Destination
  waypoints: Destination[]
  routeMode: RouteMode
  tollPreference: TollPreference
  route: RouteSummary
}

export function saveActiveTrip(trip: Omit<ActiveTrip, 'version' | 'savedAt'>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...trip, version: 1, savedAt: Date.now() }))
  } catch {
    // Stockage plein ou bloqué : la reprise ne sera simplement pas proposée.
  }
}

export function clearActiveTrip(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire.
  }
}

export function loadActiveTrip(): ActiveTrip | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const trip = JSON.parse(raw) as ActiveTrip
    if (
      trip.version !== 1 ||
      !trip.destination ||
      !trip.route ||
      !Array.isArray(trip.route.coordinates) ||
      Date.now() - trip.savedAt > MAX_AGE_MS
    ) {
      clearActiveTrip()
      return null
    }
    return trip
  } catch {
    return null
  }
}
