import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { BatteryCharging, Coffee, Fuel, LoaderCircle, MapPinPlus, ParkingSquare, Search, X } from 'lucide-react'
import {
  ALONG_ROUTE_CATEGORIES,
  searchAlongRoute,
  type AlongRouteCategory,
  type AlongRoutePlace,
} from '../../services/alongRoute'
import { haptic } from '../../services/haptics'
import { getRouteProgress } from '../../services/routeGeometry'
import { calculateRoute } from '../../services/routing'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { Destination } from '../../types/geocoding'

const CATEGORY_ICONS: Record<AlongRouteCategory, typeof Fuel> = {
  fuel: Fuel,
  charging: BatteryCharging,
  parking: ParkingSquare,
  rest: Coffee,
}

interface AlongRouteSearchProps {
  map: MapLibreMap | null
  mapReady: boolean
  /** Progression actuelle sur le trajet (m). */
  along: number
  onOpenChange?: (open: boolean) => void
}

/** « Sur le trajet » : stations, recharge, parkings et aires devant soi, à ajouter comme arrêt. */
export function AlongRouteSearch({ map, mapReady, along, onOpenChange }: AlongRouteSearchProps) {
  const route = useInterfaceStore((state) => state.route)
  const destination = useInterfaceStore((state) => state.destination)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const routeMode = useInterfaceStore((state) => state.routeMode)
  const tollPreference = useInterfaceStore((state) => state.tollPreference)
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const applyDetour = useInterfaceStore((state) => state.applyDetour)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<AlongRouteCategory | null>(null)
  const [places, setPlaces] = useState<AlongRoutePlace[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addError, setAddError] = useState('')
  const markersRef = useRef<MapLibreMarker[]>([])
  const alongRef = useRef(along)
  alongRef.current = along

  const setPanelOpen = (value: boolean) => {
    setOpen(value)
    onOpenChange?.(value)
    if (!value) {
      setCategory(null)
      setPlaces([])
      setStatus('idle')
      setAddError('')
    }
  }

  // Recherche lancée au choix de la catégorie (depuis la position du moment).
  useEffect(() => {
    if (!open || !category || !route) return
    const controller = new AbortController()
    setStatus('loading')
    setPlaces([])
    void searchAlongRoute(route, alongRef.current, category, controller.signal)
      .then((results) => {
        if (controller.signal.aborted) return
        setPlaces(results)
        setStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    return () => controller.abort()
  }, [category, open, route])

  // Repères des résultats sur la carte, tant que le panneau est ouvert.
  useEffect(() => {
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
    if (!open || !map || !mapReady || places.length === 0) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed) return
      markersRef.current = places.map((place, index) => {
        const element = document.createElement('div')
        element.className = 'along-route-marker'
        element.textContent = String(index + 1)
        element.setAttribute('role', 'img')
        element.setAttribute('aria-label', `${place.name}, résultat ${index + 1}`)
        return new Marker({ element, anchor: 'center' }).setLngLat(place.coordinates).addTo(map)
      })
    })
    return () => {
      disposed = true
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
    }
  }, [map, mapReady, open, places])

  // Navigation terminée ou trajet remplacé : on ferme.
  useEffect(() => {
    if (!route) setPanelOpen(false)
  }, [route])

  if (!route || !destination) return null

  const addStop = async (place: AlongRoutePlace) => {
    if (!currentPosition || addingId) return
    haptic('tap')
    setAddingId(place.id)
    setAddError('')
    const fromAlong = alongRef.current
    const alongOf = (point: [number, number]) => getRouteProgress(route.coordinates, point, fromAlong).along
    const stop: Destination = {
      id: place.id,
      name: place.name,
      details: place.details,
      coordinates: place.coordinates,
    }
    // Étapes pas encore atteintes + le nouvel arrêt, dans l'ordre du trajet.
    const stops = [...waypoints.filter((waypoint) => alongOf(waypoint.coordinates) > fromAlong + 30), stop]
      .map((entry) => ({ entry, along: alongOf(entry.coordinates) }))
      .sort((first, second) => first.along - second.along)
      .map(({ entry }) => entry)
    try {
      const [newRoute] = await calculateRoute(
        { id: 'detour-origin', name: 'Ma position', details: 'Position GPS actuelle', coordinates: currentPosition.coordinates },
        destination,
        routeMode,
        stops,
        tollPreference,
      )
      if (!newRoute) throw new Error('no-route')
      haptic('confirm')
      applyDetour(stops, newRoute)
      setPanelOpen(false)
    } catch {
      setAddError('Impossible d’ajouter cet arrêt pour le moment. Réessayez.')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`route-report-toggle along-route-toggle ${open ? 'route-report-toggle-active' : ''}`}
        aria-label={open ? 'Fermer la recherche sur le trajet' : 'Chercher sur le trajet (carburant, recharge, parking, aire)'}
        aria-expanded={open}
        title="Sur le trajet"
        onClick={() => {
          haptic('tap')
          setPanelOpen(!open)
        }}
      >
        {open ? <X size={22} /> : <Search size={22} />}
      </button>

      {open && createPortal(
        <section className="along-route-panel" aria-label="Sur le trajet">
          <div className="along-route-header">
            <strong>Sur le trajet</strong>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
          <div className="along-route-categories" role="group" aria-label="Type de lieu">
            {ALONG_ROUTE_CATEGORIES.map(({ value, label }) => {
              const Icon = CATEGORY_ICONS[value]
              return (
                <button
                  key={value}
                  type="button"
                  className={category === value ? 'is-selected' : ''}
                  aria-pressed={category === value}
                  onClick={() => {
                    haptic('tap')
                    setCategory(value)
                  }}
                >
                  <Icon size={18} />
                  {label}
                </button>
              )
            })}
          </div>

          {status === 'idle' && <p className="along-route-message">Que cherchez-vous sur les 40 prochains km ?</p>}
          {status === 'loading' && (
            <p className="along-route-message" role="status">
              <LoaderCircle size={16} className="route-button-spinner" /> Recherche le long du trajet…
            </p>
          )}
          {status === 'error' && (
            <p className="along-route-message is-error" role="alert">
              Recherche indisponible pour le moment.
            </p>
          )}
          {status === 'ready' && places.length === 0 && (
            <p className="along-route-message">Rien trouvé sur les 40 prochains km.</p>
          )}
          {addError && <p className="along-route-message is-error" role="alert">{addError}</p>}

          {places.length > 0 && (
            <ol className="along-route-results">
              {places.map((place, index) => (
                <li key={place.id}>
                  <span className="along-route-index" aria-hidden="true">{index + 1}</span>
                  <span className="along-route-copy">
                    <strong>{place.name}</strong>
                    <span>
                      dans {formatDistance(place.distanceAhead)}
                      {place.distanceFromRoute > 150 ? ` · à ${formatDistance(place.distanceFromRoute)} de la route` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void addStop(place)}
                    disabled={addingId !== null}
                    aria-label={`Ajouter ${place.name} comme arrêt`}
                  >
                    {addingId === place.id ? <LoaderCircle size={18} className="route-button-spinner" /> : <MapPinPlus size={18} />}
                    <span>Arrêt</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <small className="along-route-source">Données OpenStreetMap, non exhaustives</small>
        </section>,
        // Hors de la carte : la colonne d'outils est transformée (translateY), ce qui casserait le positionnement fixe.
        document.body,
      )}
    </>
  )
}

function formatDistance(distance: number): string {
  if (distance < 1000) return `${Math.round(distance / 10) * 10} m`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(distance / 1000)} km`
}
