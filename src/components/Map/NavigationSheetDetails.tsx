import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, Map as MapIcon, RefreshCw, Share2, TrafficCone, TriangleAlert } from 'lucide-react'
import { getStepPositions } from '../../services/navigation'
import { getRouteProgress, type Point } from '../../services/routeGeometry'
import { getRemainingTrafficDelay, getRouteTraffic } from '../../services/routeTraffic'
import { calculateRoute } from '../../services/routing'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { RouteSummary } from '../../types/geocoding'
import { haptic } from '../../services/haptics'
import { formatDistance, formatDuration, getManeuverIcon, getShortManeuver } from './maneuverFormat'

interface NavigationSheetDetailsProps {
  route: RouteSummary
  /** Progression sur le trajet (m). */
  along: number
  stepIndex: number
  /** Temps et distance restants du trajet actuel (trafic compris). */
  currentDuration: number
  currentDistance: number
  trafficEnabled: boolean
  /** Comparer les trajets bouchons compris (en voiture). */
  compareTraffic: boolean
  onToggleTraffic: () => void
  onShare: () => void
  onOverview: () => void
  onReport: () => void
  /** Appelé après un changement de trajet (pour replier la feuille). */
  onRouteChanged: () => void
}

interface RouteChoice {
  route: RouteSummary
  /** Durée trafic compris (s). */
  duration: number
  /** Retard dû au trafic inclus dans la durée (s). */
  trafficDelay: number
}

/** Nombre de prochaines étapes affichées. */
const MAX_STEPS = 12

/**
 * Contenu de la feuille de navigation dépliée : trajets disponibles depuis la position actuelle,
 * prochaines étapes et actions rapides.
 */
export function NavigationSheetDetails({
  route,
  along,
  stepIndex,
  currentDuration,
  currentDistance,
  trafficEnabled,
  compareTraffic,
  onToggleTraffic,
  onShare,
  onOverview,
  onReport,
  onRouteChanged,
}: NavigationSheetDetailsProps) {
  const applyReroute = useInterfaceStore((state) => state.applyReroute)
  const [choices, setChoices] = useState<RouteChoice[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'no-position'>('loading')
  const [refreshKey, setRefreshKey] = useState(0)

  // Trajets possibles depuis la position actuelle (calculés à l'ouverture et sur « Actualiser »).
  useEffect(() => {
    const { currentPosition, destination, waypoints, routeMode, tollPreference } = useInterfaceStore.getState()
    if (!currentPosition || !destination) {
      setStatus('no-position')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setChoices([])
    // Seulement les étapes intermédiaires pas encore atteintes.
    const remainingStops = waypoints.filter(
      (stop) => getRouteProgress(route.coordinates as Point[], stop.coordinates).along > along + 30,
    )
    const here = { id: 'current-position', name: 'Ma position', details: '', coordinates: currentPosition.coordinates }

    void calculateRoute(here, destination, routeMode, remainingStops, tollPreference, controller.signal)
      .then(async (routes) => {
        // Trafic sur chaque option, pour comparer avec le trajet actuel (dont le temps l'inclut déjà).
        const withTraffic = await Promise.all(
          routes.map(async (option) => {
            let trafficDelay = 0
            if (compareTraffic) {
              try {
                trafficDelay = getRemainingTrafficDelay(await getRouteTraffic(option, 0, controller.signal), 0)
              } catch {
                trafficDelay = 0
              }
            }
            return { route: option, duration: option.duration + trafficDelay, trafficDelay }
          }),
        )
        if (controller.signal.aborted) return
        // On écarte les options qui suivent le trajet actuel (même itinéraire recalculé).
        setChoices(
          withTraffic
            .filter((choice) => !followsRoute(choice.route, route, along))
            .sort((first, second) => first.duration - second.duration),
        )
        setStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    return () => controller.abort()
    // On ne recalcule pas à chaque mètre parcouru : seulement à l'ouverture, sur « Actualiser »
    // ou si le trajet change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, refreshKey, compareTraffic])

  const chooseRoute = useCallback(
    (choice: RouteChoice) => {
      haptic('confirm')
      applyReroute(choice.route)
      onRouteChanged()
    },
    [applyReroute, onRouteChanged],
  )

  const stepPositions = getStepPositions(route)
  const upcomingSteps = route.steps
    .map((step, index) => ({ step, index, distance: Math.max(0, (stepPositions[index] ?? along) - along) }))
    .slice(stepIndex, stepIndex + MAX_STEPS)

  return (
    <div className="nav-details">
      <section className="nav-details-section" aria-labelledby="nav-details-routes">
        <div className="nav-details-heading">
          <h2 id="nav-details-routes">Trajets disponibles</h2>
          <button
            type="button"
            className="nav-details-refresh"
            onClick={() => {
              haptic('tap')
              setRefreshKey((key) => key + 1)
            }}
            disabled={status === 'loading'}
            aria-label="Actualiser les trajets"
          >
            <RefreshCw size={16} className={status === 'loading' ? 'route-button-spinner' : undefined} />
          </button>
        </div>
        <ul className="nav-routes">
          <li>
            <div className="nav-route is-current" aria-current="true">
              <span className="nav-route-check" aria-hidden="true"><Check size={16} /></span>
              <span className="nav-route-copy">
                <strong>Trajet actuel</strong>
                <span>{formatDistance(currentDistance)}</span>
              </span>
              <span className="nav-route-time">{formatDuration(currentDuration)}</span>
            </div>
          </li>
          {choices.map((choice, index) => {
            const difference = Math.round((choice.duration - currentDuration) / 60)
            return (
              <li key={index}>
                <button type="button" className="nav-route" onClick={() => chooseRoute(choice)}>
                  <span className="nav-route-index" aria-hidden="true">{index + 2}</span>
                  <span className="nav-route-copy">
                    <strong>{difference < 0 ? `${-difference} min de moins` : difference > 0 ? `${difference} min de plus` : 'Même durée'}</strong>
                    <span>
                      {formatDistance(choice.route.distance)}
                      {choice.trafficDelay >= 120 ? ` · dont ${Math.round(choice.trafficDelay / 60)} min de bouchons` : ''}
                    </span>
                  </span>
                  <span className={`nav-route-time ${difference < 0 ? 'is-faster' : ''}`}>{formatDuration(choice.duration)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {status === 'loading' && (
          <p className="nav-details-message"><LoaderCircle size={16} className="route-button-spinner" /> Recherche d’autres trajets…</p>
        )}
        {status === 'ready' && choices.length === 0 && (
          <p className="nav-details-message">Pas d’autre trajet intéressant pour le moment.</p>
        )}
        {status === 'error' && <p className="nav-details-message is-error">Impossible de calculer d’autres trajets.</p>}
        {status === 'no-position' && <p className="nav-details-message">En attente de votre position GPS…</p>}
      </section>

      <section className="nav-details-section" aria-labelledby="nav-details-actions">
        <h2 id="nav-details-actions" className="nav-details-title">Raccourcis</h2>
        <div className="nav-actions">
          <button type="button" onClick={onShare}><Share2 size={20} /><span>Partager l’arrivée</span></button>
          <button type="button" onClick={onOverview}><MapIcon size={20} /><span>Aperçu</span></button>
          <button type="button" className={trafficEnabled ? 'is-active' : ''} aria-pressed={trafficEnabled} onClick={onToggleTraffic}>
            <TrafficCone size={20} /><span>Trafic</span>
          </button>
          <button type="button" onClick={onReport}><TriangleAlert size={20} /><span>Signaler</span></button>
        </div>
      </section>

      <section className="nav-details-section" aria-labelledby="nav-details-steps">
        <h2 id="nav-details-steps" className="nav-details-title">Prochaines étapes</h2>
        <ol className="nav-steps">
          {upcomingSteps.map(({ step, index, distance }) => {
            const Icon = getManeuverIcon(step)
            const instruction = getShortManeuver(step)
            return (
              <li key={index} className={index === stepIndex ? 'is-next' : undefined}>
                <span className="nav-step-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.4} /></span>
                <span className="nav-step-copy">
                  <strong>{step.name || instruction}</strong>
                  {step.name && <span>{instruction}</span>}
                </span>
                <span className="nav-step-distance">{formatDistance(distance)}</span>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

/** Vrai si `option` suit le trajet actuel (points à 25 %, 50 % et 75 % sur le tracé actuel). */
function followsRoute(option: RouteSummary, current: RouteSummary, along: number): boolean {
  const points = option.coordinates as Point[]
  if (points.length < 4) return false
  return [0.25, 0.5, 0.75].every((fraction) => {
    const point = points[Math.floor(points.length * fraction)]
    return getRouteProgress(current.coordinates as Point[], point, along).distance < 25
  })
}
