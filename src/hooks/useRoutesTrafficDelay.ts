// Retard dû aux bouchons (TomTom) pour chaque itinéraire proposé, avant de partir.
import { useEffect, useState } from 'react'
import { getRemainingTrafficDelay, getRouteTraffic } from '../services/routeTraffic'
import type { RouteSummary } from '../types/geocoding'

export interface RoutesTrafficDelay {
  /** Retard (s) par itinéraire ; absent tant qu'il n'est pas connu. */
  delays: Map<RouteSummary, number>
  loading: boolean
}

export function useRoutesTrafficDelay(routes: RouteSummary[], enabled: boolean): RoutesTrafficDelay {
  const [delays, setDelays] = useState<Map<RouteSummary, number>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setDelays(new Map())
    if (!enabled || routes.length === 0) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void Promise.allSettled(
      routes.map(async (route) => {
        const traffic = await getRouteTraffic(route, 0, controller.signal)
        const delay = getRemainingTrafficDelay(traffic, 0)
        // Chaque itinéraire s'affiche dès que son trafic est connu.
        if (!controller.signal.aborted) setDelays((previous) => new Map(previous).set(route, delay))
      }),
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [routes, enabled])

  return { delays, loading }
}
