import { useEffect, useRef, useState } from 'react'
import type { ErrorEvent, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import {
  ArrowUp,
  Clock3,
  CornerUpLeft,
  CornerUpRight,
  LoaderCircle,
  RotateCcw,
  StopCircle,
} from 'lucide-react'
import { MAP_STYLE_URL, MAP_WORKER_URL } from '../../services/mapConfig'
import {
  formatManeuver,
  getManeuverDirection,
  getNavigationGuidance,
  getRemainingRouteMetrics,
  getRouteBearing,
} from '../../services/navigation'
import { useInterfaceStore } from '../../stores/interfaceStore'

type MapStatus = 'loading' | 'ready' | 'error'

export function MapCanvas() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<MapLibreMarker[]>([])
  const waypointMarkerRefs = useRef<MapLibreMarker[]>([])
  const currentPositionMarkerRef = useRef<MapLibreMarker | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mapViewportMobile, setMapViewportMobile] = useState(false)
  const origin = useInterfaceStore((state) => state.origin)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const destination = useInterfaceStore((state) => state.destination)
  const route = useInterfaceStore((state) => state.route)
  const routeOptions = useInterfaceStore((state) => state.routeOptions)
  const selectedRouteIndex = useInterfaceStore((state) => state.selectedRouteIndex)
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const navigationStepIndex = useInterfaceStore((state) => state.navigationStepIndex)
  const navigationError = useInterfaceStore((state) => state.navigationError)
  const stopNavigation = useInterfaceStore((state) => state.stopNavigation)
  const isDarkMapStyle = MAP_STYLE_URL.endsWith('/fiord')

  const guidance =
    route && currentPosition
      ? getNavigationGuidance(route, currentPosition.coordinates, navigationStepIndex)
      : null
  const remaining = route ? getRemainingRouteMetrics(route, guidance) : null
  const currentStep = route?.steps[guidance?.stepIndex ?? navigationStepIndex]
  const direction = getManeuverDirection(currentStep)
  const DirectionIcon = getDirectionIcon(direction)
  const isOffRoute =
    currentPosition &&
    guidance &&
    guidance.distanceFromRoute > Math.max(75, currentPosition.accuracy * 1.5)

  useEffect(() => {
    if (!mapContainerRef.current) return

    setStatus('loading')
    setErrorMessage('')

    let map: MapLibreMap | null = null
    let disposed = false

    const initializeMap = async () => {
      try {
        const { Map: MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } =
          await import('maplibre-gl')
        if (disposed || !mapContainerRef.current) return

        setWorkerUrl(MAP_WORKER_URL)
        const instance = new MapLibreMap({
          container: mapContainerRef.current,
          style: MAP_STYLE_URL,
          center: [2.3522, 48.8566],
          zoom: 12,
          minZoom: 2,
          maxZoom: 19,
          doubleClickZoom: false,
          attributionControl: {
            compact: true,
            customAttribution:
              '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
          },
        })
        map = instance
        mapRef.current = instance

        const handleLoad = () => setStatus('ready')
        const handleError = (event: ErrorEvent) => {
          if (!instance.isStyleLoaded()) {
            setErrorMessage(event.error.message)
            setStatus('error')
          }
        }

        instance.addControl(new NavigationControl({ showCompass: true, showZoom: true }), 'top-right')
        instance.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
        const controlLabels = [
          ['.maplibregl-ctrl-zoom-in', 'Zoom avant'],
          ['.maplibregl-ctrl-zoom-out', 'Zoom arrière'],
          ['.maplibregl-ctrl-compass', 'Réinitialiser l’orientation de la carte'],
        ] as const
        for (const [selector, label] of controlLabels) {
          const button = instance.getContainer().querySelector<HTMLButtonElement>(selector)
          if (button) {
            button.setAttribute('aria-label', label)
            button.title = label
          }
        }
        instance.on('load', handleLoad)
        instance.on('error', handleError)
      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : 'Une erreur inattendue est survenue.')
          setStatus('error')
        }
      }
    }

    void initializeMap()

    return () => {
      disposed = true
      markerRef.current.forEach((marker) => marker.remove())
      markerRef.current = []
      waypointMarkerRefs.current.forEach((marker) => marker.remove())
      waypointMarkerRefs.current = []
      currentPositionMarkerRef.current?.remove()
      currentPositionMarkerRef.current = null
      mapRef.current = null
      map?.remove()
    }
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    const container = mapContainerRef.current
    if (status !== 'ready' || !map || !container) return

    const updateMapSize = () => {
      map.resize()
      const isMobile = container.clientWidth < 760
      setMapViewportMobile((current) => current === isMobile ? current : isMobile)
    }
    const observer = new ResizeObserver(updateMapSize)
    observer.observe(container)
    updateMapSize()

    return () => observer.disconnect()
  }, [status])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    markerRef.current.forEach((marker) => marker.remove())
    markerRef.current = []
    waypointMarkerRefs.current.forEach((marker) => marker.remove())
    waypointMarkerRefs.current = []
    const points = [
      ...(origin ? [{ place: origin, type: 'origin' as const }] : []),
      ...(destination ? [{ place: destination, type: 'destination' as const }] : []),
    ]
    if (points.length === 0) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return

      markerRef.current = points.map(({ place, type }) => {
        const markerElement = document.createElement('div')
        markerElement.className = `destination-marker ${type === 'origin' ? 'origin-marker' : ''}`
        markerElement.setAttribute('role', 'img')
        markerElement.setAttribute(
          'aria-label',
          `${type === 'origin' ? 'Départ' : 'Destination'} : ${place.name}`,
        )

        return new Marker({ element: markerElement, anchor: 'bottom' })
          .setLngLat(place.coordinates)
          .addTo(map)
      })

      waypointMarkerRefs.current = waypoints.map((waypoint, index) => {
        const markerElement = document.createElement('div')
        markerElement.className = 'destination-marker waypoint-marker'
        markerElement.setAttribute('role', 'img')
        markerElement.setAttribute('aria-label', `Étape ${index + 1} : ${waypoint.name}`)

        return new Marker({ element: markerElement, anchor: 'bottom' })
          .setLngLat(waypoint.coordinates)
          .addTo(map)
      })

      const focusedPlace = destination ?? origin
      if (focusedPlace) {
        map.flyTo({
          center: focusedPlace.coordinates,
          zoom: 14,
          speed: 1.2,
          essential: true,
        })
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : 'Le marqueur ne peut pas être affiché.')
        setStatus('error')
      }
    })

    return () => {
      disposed = true
      markerRef.current.forEach((marker) => marker.remove())
      markerRef.current = []
      waypointMarkerRefs.current.forEach((marker) => marker.remove())
      waypointMarkerRefs.current = []
    }
  }, [origin, waypoints, destination, status])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    if (!currentPosition) {
      currentPositionMarkerRef.current?.remove()
      currentPositionMarkerRef.current = null
      return
    }

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return

      if (!currentPositionMarkerRef.current) {
        const markerElement = document.createElement('div')
        markerElement.className = 'current-position-marker'
        markerElement.setAttribute('role', 'img')
        markerElement.setAttribute('aria-label', 'Votre position GPS actuelle')
        currentPositionMarkerRef.current = new Marker({ element: markerElement, anchor: 'center' })
          .setLngLat(currentPosition.coordinates)
          .addTo(map)
      } else {
        currentPositionMarkerRef.current.setLngLat(currentPosition.coordinates)
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : 'Votre position GPS ne peut pas être affichée.')
        setStatus('error')
      }
    })

    return () => {
      disposed = true
    }
  }, [currentPosition, status])

  const wasNavigationActiveRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    if (!navigationActive) {
      if (wasNavigationActiveRef.current) {
        map.easeTo({ pitch: 0, bearing: 0, offset: [0, 0], duration: 700, essential: true })
      }
      wasNavigationActiveRef.current = false
      return
    }

    wasNavigationActiveRef.current = true
    if (!currentPosition) return

    const routeBearing = route ? getRouteBearing(route, currentPosition.coordinates) : null
    const bearing = currentPosition.heading ?? routeBearing ?? map.getBearing()
    map.easeTo({
      center: currentPosition.coordinates,
      zoom: 17,
      pitch: mapViewportMobile ? 55 : 58,
      bearing,
      offset: [0, Math.round(map.getContainer().clientHeight * (mapViewportMobile ? 0.12 : 0.16))],
      duration: 700,
      essential: true,
    })
  }, [currentPosition, mapViewportMobile, navigationActive, route, status])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    const sourceId = 'osrm-route'
    const casingLayerId = 'osrm-route-casing'
    const routeLayerId = 'osrm-route-line'

    if (!route) {
      if (map.getLayer(routeLayerId)) map.removeLayer(routeLayerId)
      if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
      return
    }

    const routeData = {
      type: 'FeatureCollection' as const,
      features: (routeOptions.length > 0 ? routeOptions : [route]).map((option, index) => ({
        type: 'Feature' as const,
        properties: { selected: index === selectedRouteIndex },
        geometry: {
          type: 'LineString' as const,
          coordinates: option.coordinates,
        },
      })),
    }

    try {
      const source = map.getSource(sourceId)
      if (source && 'setData' in source && typeof source.setData === 'function') {
        source.setData(routeData)
      } else if (!source) {
        map.addSource(sourceId, { type: 'geojson', data: routeData })
      } else {
        throw new Error('Une source cartographique incompatible utilise déjà cet identifiant.')
      }

      const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
      if (!map.getLayer(casingLayerId)) {
        map.addLayer(
          {
            id: casingLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': isDarkMapStyle ? '#1c222b' : '#fafaf8',
              'line-width': ['case', ['get', 'selected'], 10, 7],
              'line-opacity': 1,
            },
          },
          firstSymbolLayer,
        )
      }

      if (!map.getLayer(routeLayerId)) {
        map.addLayer(
          {
            id: routeLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['get', 'selected'], isDarkMapStyle ? '#8ab4f8' : '#1a73e8', '#9da3aa'],
              'line-width': ['case', ['get', 'selected'], 7, 5],
              'line-opacity': ['case', ['get', 'selected'], 1, 0.8],
            },
          },
          firstSymbolLayer,
        )
      }

      void import('maplibre-gl').then(({ LngLatBounds }) => {
        if (mapRef.current !== map) return
        const allCoordinates = (routeOptions.length > 0 ? routeOptions : [route])
          .flatMap((option) => option.coordinates)
        const bounds = allCoordinates.reduce(
          (routeBounds, coordinate) => routeBounds.extend(coordinate),
          new LngLatBounds(allCoordinates[0], allCoordinates[0]),
        )
        map.fitBounds(bounds, {
          padding: mapViewportMobile
            ? {
                top: 60,
                right: 45,
                bottom: Math.round(map.getContainer().clientHeight * 0.56),
                left: 45,
              }
            : { top: 90, right: 90, bottom: 90, left: 90 },
          maxZoom: 16,
          duration: 900,
        })
      }).catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Impossible d’afficher le trajet sur la carte.')
        setStatus('error')
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Impossible d’afficher le trajet sur la carte.')
      setStatus('error')
    }
  }, [mapViewportMobile, route, routeOptions, selectedRouteIndex, status])

  return (
    <section
      className={`map-canvas ${navigationActive ? 'map-navigation-active' : ''}`}
      aria-label={navigationActive ? 'Carte de navigation en perspective' : 'Carte interactive'}
    >
      <div className="map-host" ref={mapContainerRef} />
      {navigationActive && route && (
        <>
          <section className="map-navigation-instruction" aria-label="Prochaine direction">
            {navigationError ? (
              <p className="map-navigation-message map-navigation-error" role="alert">
                {navigationError}
              </p>
            ) : !currentPosition ? (
              <p className="map-navigation-message" role="status">
                <LoaderCircle size={16} className="route-button-spinner" />
                Recherche de votre position GPS…
              </p>
            ) : isOffRoute && guidance ? (
              <p className="map-navigation-message map-navigation-error" role="status">
                Vous êtes à {formatDistance(guidance.distanceFromRoute)} de l’itinéraire.
              </p>
            ) : guidance && currentStep ? (
              <>
                <span className="map-navigation-turn-icon"><DirectionIcon size={21} strokeWidth={2.6} /></span>
                <span className="map-navigation-turn-copy">
                  <strong>{formatDistance(guidance.distanceToStep)}</strong>
                  <span>
                    {currentStep.maneuver.type === 'arrive' && guidance.distanceToStep > 30
                      ? `Continuez jusqu’à ${destination?.name ?? 'destination'}.`
                      : formatManeuver(currentStep)}
                  </span>
                </span>
              </>
            ) : null}
          </section>

          <section className="map-navigation-dashboard" aria-label="Résumé de navigation">
            <div className="map-navigation-metric">
              <span>Arrivée estimée</span>
              <strong>{remaining ? formatArrivalTime(remaining.duration) : '—'}</strong>
            </div>
            <div className="map-navigation-metric">
              <span><Clock3 size={11} />Durée · distance</span>
              <strong>{remaining ? `${formatDuration(remaining.duration)} · ${formatDistance(remaining.distance)}` : '—'}</strong>
            </div>
            <div className="map-navigation-direction" aria-label={`Direction : ${getDirectionLabel(direction)}`}>
              <DirectionIcon size={25} strokeWidth={2.6} />
            </div>
            <button type="button" onClick={stopNavigation} aria-label="Arrêter la navigation" title="Arrêter">
              <StopCircle size={18} />
            </button>
          </section>
        </>
      )}
      <div className="map-provider-badge">
        <span className="preview-dot" />
        OPENFREEMAP <span>·</span> OPENSTREETMAP
      </div>

      {status === 'loading' && (
        <div className="map-loading" role="status" aria-live="polite">
          <span className="map-loader" />
          Chargement de la carte…
        </div>
      )}

      {status === 'error' && (
        <div className="map-error" role="alert">
          <strong>La carte n’a pas pu être chargée.</strong>
          <p>Vérifiez votre connexion, puis réessayez.</p>
          {errorMessage && <span className="map-error-detail">{errorMessage}</span>}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Réessayer
          </button>
        </div>
      )}
    </section>
  )
}

function getDirectionIcon(direction: ReturnType<typeof getManeuverDirection>) {
  switch (direction) {
    case 'left':
      return CornerUpLeft
    case 'right':
      return CornerUpRight
    case 'uturn':
    case 'roundabout':
      return RotateCcw
    default:
      return ArrowUp
  }
}

function getDirectionLabel(direction: ReturnType<typeof getManeuverDirection>): string {
  switch (direction) {
    case 'left':
      return 'à gauche'
    case 'right':
      return 'à droite'
    case 'uturn':
      return 'demi-tour'
    case 'roundabout':
      return 'rond-point'
    default:
      return 'tout droit'
  }
}

function formatDistance(distance: number): string {
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(distance / 1000)} km`
}

function formatDuration(duration: number): string {
  const minutes = Math.ceil(duration / 60)
  if (minutes < 1) return 'Arrivée'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`
}

function formatArrivalTime(duration: number): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(Date.now() + duration * 1000),
  )
}
