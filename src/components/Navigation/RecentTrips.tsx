import { useState } from 'react'
import { Bike, Car, Clock3, Footprints, LoaderCircle, X } from 'lucide-react'
import { haptic } from '../../services/haptics'
import { getCurrentLocation } from '../../services/location'
import { useInterfaceStore, type RecentTrip } from '../../stores/interfaceStore'
import type { RouteMode } from '../../types/geocoding'

const MODE_ICONS: Record<RouteMode, typeof Car> = { driving: Car, walking: Footprints, cycling: Bike }
const MODE_LABELS: Record<RouteMode, string> = { driving: 'En voiture', walking: 'À pied', cycling: 'À vélo' }

/** Liste des trajets récents : un appui relance le trajet (l'itinéraire se calcule tout seul). */
export function RecentTrips() {
  const recentTrips = useInterfaceStore((state) => state.recentTrips)
  const restoreRecentTrip = useInterfaceStore((state) => state.restoreRecentTrip)
  const removeRecentTrip = useInterfaceStore((state) => state.removeRecentTrip)
  const clearRecentTrips = useInterfaceStore((state) => state.clearRecentTrips)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const relaunch = async (trip: RecentTrip) => {
    haptic('tap')
    if (trip.origin) {
      restoreRecentTrip(trip, trip.origin)
      return
    }
    // Départ « Ma position » : on se relocalise maintenant.
    setLoadingId(trip.id)
    try {
      restoreRecentTrip(trip, await getCurrentLocation(10_000))
    } catch {
      // Position indisponible : le trajet est repris sans départ, à choisir dans le panneau.
      restoreRecentTrip(trip, null)
    } finally {
      setLoadingId(null)
    }
  }

  if (recentTrips.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Clock3 size={20} /></div>
        <p>Vos trajets apparaîtront ici dès que vous lancerez une navigation.</p>
        <span className="empty-caption">Un appui suffira pour les relancer.</span>
      </div>
    )
  }

  const now = Date.now()
  return (
    <div className="recent-trips">
      <ul className="recent-trip-list">
        {recentTrips.map((trip) => {
          const Icon = MODE_ICONS[trip.routeMode]
          const stops = trip.waypoints.length
          return (
            <li key={trip.id} className="recent-trip">
              <button
                type="button"
                className="recent-trip-main"
                onClick={() => void relaunch(trip)}
                disabled={loadingId !== null}
                aria-label={`Relancer le trajet vers ${trip.destination.name}`}
              >
                <span className="recent-trip-icon" aria-hidden="true">
                  {loadingId === trip.id ? <LoaderCircle size={20} className="route-button-spinner" /> : <Icon size={20} />}
                </span>
                <span className="recent-trip-copy">
                  <strong>{trip.destination.name}</strong>
                  <span>
                    Depuis {trip.origin?.name ?? 'ma position'}
                    {stops > 0 ? ` · ${stops} étape${stops > 1 ? 's' : ''}` : ''}
                  </span>
                  <small>
                    {MODE_LABELS[trip.routeMode]} · {formatTripDate(trip.startedAt, now)}
                    {trip.count > 1 ? ` · ${trip.count} fois` : ''}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="recent-trip-remove"
                onClick={() => {
                  haptic('tap')
                  removeRecentTrip(trip.id)
                }}
                aria-label={`Retirer le trajet vers ${trip.destination.name}`}
              >
                <X size={18} />
              </button>
            </li>
          )
        })}
      </ul>
      {confirmClear ? (
        <div className="recent-trips-confirm" role="group" aria-label="Effacer l’historique">
          <span>Effacer tous les trajets récents ?</span>
          <button type="button" onClick={() => setConfirmClear(false)}>Annuler</button>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              haptic('confirm')
              clearRecentTrips()
              setConfirmClear(false)
            }}
          >
            Effacer
          </button>
        </div>
      ) : (
        <button type="button" className="recent-trips-clear" onClick={() => setConfirmClear(true)}>
          Effacer l’historique
        </button>
      )}
    </div>
  )
}

/** « à l'instant », « il y a 25 min », « il y a 3 h », « hier », « le 3 nov. ». */
function formatTripDate(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday - 86_400_000) return 'hier'
  return `le ${new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}
