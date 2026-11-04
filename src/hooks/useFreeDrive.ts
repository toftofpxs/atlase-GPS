// Conduite libre (sans itinéraire) : suit la position GPS et cherche la limitation de vitesse
// de la route empruntée, en recalant les derniers points GPS sur la carte (Valhalla map_snap).
import { useEffect, useState } from 'react'
import { getLocationErrorMessage, watchCurrentLocation } from '../services/location'
import { getPointDistanceMeters, type Point } from '../services/routeGeometry'
import { fetchTraceAttributes } from '../services/valhalla'
import { useInterfaceStore } from '../stores/interfaceStore'

/** Délai minimum entre deux recherches de limitation. */
const LOOKUP_INTERVAL_MS = 8_000
/** Points GPS gardés pour le recalage (les plus récents). */
const TRAIL_MAX_POINTS = 12
const TRAIL_MAX_AGE_MS = 45_000
/** Il faut avoir un peu roulé pour savoir sur quelle route on est. */
const MIN_TRAIL_METERS = 40
/** Points trop imprécis ignorés pour le recalage. */
const MAX_ACCURACY_METERS = 40

export type FreeDriveLimitStatus = 'idle' | 'loading' | 'available' | 'unavailable'

export function useFreeDrive(active: boolean) {
  const setCurrentPosition = useInterfaceStore((state) => state.setCurrentPosition)
  const setNavigationError = useInterfaceStore((state) => state.setNavigationError)
  const [speedLimit, setSpeedLimit] = useState<number | null>(null)
  const [limitStatus, setLimitStatus] = useState<FreeDriveLimitStatus>('idle')
  const [roadName, setRoadName] = useState<string | null>(null)

  useEffect(() => {
    if (!active) {
      setSpeedLimit(null)
      setLimitStatus('idle')
      setRoadName(null)
      return
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      // Le message reste affiché dans la barre de conduite libre, qui permet d'arrêter.
      setNavigationError(
        getLocationErrorMessage(new Error(window.isSecureContext ? 'unsupported' : 'secure-context-required')),
      )
      return
    }

    setNavigationError(null)
    setLimitStatus('loading')
    const trail: { point: Point; time: number }[] = []
    let request: AbortController | null = null
    let lastLookup = 0

    const watchId = watchCurrentLocation(
      (position) => {
        setCurrentPosition(position)
        if (position.accuracy > MAX_ACCURACY_METERS) return

        const now = Date.now()
        trail.push({ point: position.coordinates, time: now })
        while (trail.length > TRAIL_MAX_POINTS || (trail.length > 0 && now - trail[0].time > TRAIL_MAX_AGE_MS)) {
          trail.shift()
        }
        if (request || now - lastLookup < LOOKUP_INTERVAL_MS || trail.length < 2) return
        // À l'arrêt, on garde la dernière limitation connue.
        if (getPointDistanceMeters(trail[0].point, trail[trail.length - 1].point) < MIN_TRAIL_METERS) return

        lastLookup = now
        const current = new AbortController()
        request = current
        void fetchTraceAttributes(
          trail.map((entry) => entry.point),
          ['edge.speed_limit', 'edge.names'],
          current.signal,
          ['map_snap'],
        )
          .then((data) => {
            if (current.signal.aborted) return
            const edges = data.edges ?? []
            const lastEdge = edges[edges.length - 1]
            const limit = lastEdge?.speed_limit
            setRoadName(lastEdge?.names?.[0] ?? null)
            const valid = typeof limit === 'number' && limit > 0 && limit < 200 ? limit : null
            setSpeedLimit(valid)
            setLimitStatus(valid === null ? 'unavailable' : 'available')
          })
          .catch(() => {
            if (!current.signal.aborted) setLimitStatus((status) => (status === 'available' ? status : 'unavailable'))
          })
          .finally(() => {
            if (request === current) request = null
          })
      },
      (error) => {
        setNavigationError(
          getLocationErrorMessage(new Error(error.code === error.PERMISSION_DENIED ? 'permission-denied' : 'unavailable')),
        )
      },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
      request?.abort()
    }
  }, [active, setCurrentPosition, setNavigationError])

  return { speedLimit, limitStatus, roadName }
}
