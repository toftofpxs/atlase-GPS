import { useEffect, useRef, useState } from 'react'
import type {
  ErrorEvent,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from 'maplibre-gl'
import {
  AlertTriangle,
  ArrowUp,
  Car,
  Clock3,
  CornerUpLeft,
  CornerUpRight,
  LocateFixed,
  LoaderCircle,
  Plus,
  RotateCcw,
  Shield,
  StopCircle,
  X,
} from 'lucide-react'
import { getMapStyleUrl, MAP_WORKER_URL } from '../../services/mapConfig'
import { getSpeedLimit } from '../../services/speedLimit'
import {
  formatManeuver,
  getManeuverDirection,
  getNavigationGuidance,
  getRemainingRouteMetrics,
  getRouteBearing,
} from '../../services/navigation'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { FavoriteShortcut } from '../../stores/interfaceStore'

type MapStatus = 'loading' | 'ready' | 'error'
type RouteReportType = 'traffic' | 'police' | 'obstacle' | 'danger'
type SpeedLimitStatus = 'idle' | 'loading' | 'available' | 'unavailable'

interface RouteReport {
  id: string
  type: RouteReportType
  coordinates: [number, number]
}

export function MapCanvas() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<MapLibreMarker[]>([])
  const waypointMarkerRefs = useRef<MapLibreMarker[]>([])
  const favoriteMarkerRefs = useRef<Map<string, MapLibreMarker>>(new Map())
  const currentPositionMarkerRef = useRef<MapLibreMarker | null>(null)
  const routeReportMarkerRefs = useRef(new Map<string, MapLibreMarker>())
  const speedLimitRequestRef = useRef<AbortController | null>(null)
  const speedLimitTimeoutRef = useRef<number | null>(null)
  const lastSpeedLimitLookupRef = useRef<{ coordinates: [number, number]; time: number } | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mapViewportMobile, setMapViewportMobile] = useState(false)
  const [followingPosition, setFollowingPosition] = useState(true)
  const [routeReports, setRouteReports] = useState<RouteReport[]>([])
  const [reportMode, setReportMode] = useState<RouteReportType | null>(null)
  const [reportMenuOpen, setReportMenuOpen] = useState(false)
  const [reportError, setReportError] = useState('')
  const [speedLimit, setSpeedLimit] = useState<number | null>(null)
  const [speedLimitStatus, setSpeedLimitStatus] = useState<SpeedLimitStatus>('idle')
  const origin = useInterfaceStore((state) => state.origin)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const destination = useInterfaceStore((state) => state.destination)
  const route = useInterfaceStore((state) => state.route)
  const routeOptions = useInterfaceStore((state) => state.routeOptions)
  const selectedRouteIndex = useInterfaceStore((state) => state.selectedRouteIndex)
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const movementIcon = useInterfaceStore((state) => state.movementIcon)
  const resolvedTheme = useInterfaceStore((state) => state.resolvedTheme)
  const navigationStepIndex = useInterfaceStore((state) => state.navigationStepIndex)
  const navigationError = useInterfaceStore((state) => state.navigationError)
  const favorites = useInterfaceStore((state) => state.favorites)
  const stopNavigation = useInterfaceStore((state) => state.stopNavigation)
  const isDarkMapStyle = resolvedTheme === 'dark'
  const resolvedThemeRef = useRef(resolvedTheme)
  resolvedThemeRef.current = resolvedTheme
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
          style: getMapStyleUrl(resolvedThemeRef.current),
          center: [2.3522, 48.8566],
          zoom: 12,
          minZoom: 2,
          maxZoom: 19,
          doubleClickZoom: false,
          attributionControl: {
            compact: false,
            customAttribution:
              '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
          },
        })
        map = instance
        mapRef.current = instance

        const handleLoad = () => setStatus('ready')
        const handleStyleLoad = () => setStatus('ready')
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
        instance.on('style.load', handleStyleLoad)
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
      favoriteMarkerRefs.current.forEach((marker) => marker.remove())
      favoriteMarkerRefs.current.clear()
      currentPositionMarkerRef.current?.remove()
      currentPositionMarkerRef.current = null
      routeReportMarkerRefs.current.forEach((marker) => marker.remove())
      routeReportMarkerRefs.current.clear()
      mapRef.current = null
      map?.remove()
    }
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    setStatus('loading')
    map.setStyle(getMapStyleUrl(resolvedTheme))
  }, [resolvedTheme])

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

    favoriteMarkerRefs.current.forEach((marker) => marker.remove())
    favoriteMarkerRefs.current.clear()
    if (favorites.length === 0) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return

      for (const favorite of favorites) {
        const markerElement = document.createElement('div')
        markerElement.className = `saved-place-marker saved-place-marker-${favorite.shortcut ?? 'favorite'}`
        markerElement.setAttribute('role', 'img')
        markerElement.setAttribute(
          'aria-label',
          `${favorite.shortcut ? `${getFavoriteShortcutLabel(favorite.shortcut)} : ` : 'Favori : '}${favorite.name}`,
        )
        const markerIcon = document.createElement('span')
        markerIcon.className = 'saved-place-marker-icon'
        markerIcon.setAttribute('aria-hidden', 'true')
        markerIcon.textContent = getFavoriteMarkerSymbol(favorite.shortcut)
        const markerLabel = document.createElement('span')
        markerLabel.className = 'saved-place-marker-label'
        markerLabel.textContent = favorite.name
        markerElement.append(markerIcon)
        markerElement.append(markerLabel)
        const marker = new Marker({ element: markerElement, anchor: 'bottom' })
          .setLngLat(favorite.coordinates)
          .addTo(map)
        favoriteMarkerRefs.current.set(favorite.id, marker)
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : 'Les lieux enregistrés ne peuvent pas être affichés.')
        setStatus('error')
      }
    })

    return () => {
      disposed = true
      favoriteMarkerRefs.current.forEach((marker) => marker.remove())
      favoriteMarkerRefs.current.clear()
    }
  }, [favorites, status])

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

      let marker = currentPositionMarkerRef.current
      const createMarker = marker === null
      if (!marker) {
        const markerElement = document.createElement('div')
        markerElement.setAttribute('role', 'img')
        markerElement.setAttribute('aria-label', 'Votre position GPS actuelle')
        marker = new Marker({ element: markerElement, anchor: 'center' })
        currentPositionMarkerRef.current = marker
      }

      const markerElement = marker.getElement()
      markerElement.className = `current-position-marker current-position-marker-${movementIcon}`
      if (movementIcon !== 'car' && !markerElement.querySelector('.position-marker-shape')) {
        const shape = document.createElement('span')
        shape.className = 'position-marker-shape'
        shape.setAttribute('aria-hidden', 'true')
        markerElement.append(shape)
      }
      if (movementIcon === 'car' && !markerElement.querySelector('.car-body')) {
        for (const className of [
          'car-shadow',
          'car-wheel car-wheel-front-left',
          'car-wheel car-wheel-front-right',
          'car-wheel car-wheel-rear-left',
          'car-wheel car-wheel-rear-right',
          'car-body',
          'car-glass car-glass-front',
          'car-glass car-glass-rear',
          'car-light car-light-front-left',
          'car-light car-light-front-right',
          'car-light car-light-rear-left',
          'car-light car-light-rear-right',
        ]) {
          const part = document.createElement('span')
          part.className = className
          part.setAttribute('aria-hidden', 'true')
          markerElement.append(part)
        }
      }
      markerElement.setAttribute(
        'aria-label',
        movementIcon === 'car'
          ? 'Votre position actuelle, représentée par une voiture'
          : movementIcon === 'arrow'
            ? 'Votre position actuelle, représentée par une flèche'
            : 'Votre position GPS actuelle',
      )
      marker
        .setLngLat(currentPosition.coordinates)
        .setRotationAlignment('map')
        .setRotation(movementIcon === 'dot' ? 0 : currentPosition.heading ?? 0)
      if (createMarker) marker.addTo(map)
    }).catch((error: unknown) => {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : 'Votre position GPS ne peut pas être affichée.')
        setStatus('error')
      }
    })

    return () => {
      disposed = true
    }
  }, [currentPosition, movementIcon, status])

  useEffect(() => {
    if (!navigationActive || !currentPosition) return

    const now = Date.now()
    const lastLookup = lastSpeedLimitLookupRef.current
    const movedDistance = lastLookup
      ? getCoordinatesDistance(lastLookup.coordinates, currentPosition.coordinates)
      : Number.POSITIVE_INFINITY
    if (
      speedLimitRequestRef.current ||
      (lastLookup && now - lastLookup.time < 20_000) ||
      (lastLookup && movedDistance < 100 && now - lastLookup.time < 60_000)
    ) {
      return
    }

    const controller = new AbortController()
    speedLimitRequestRef.current = controller
    lastSpeedLimitLookupRef.current = { coordinates: currentPosition.coordinates, time: now }
    setSpeedLimitStatus('loading')
    const timeout = window.setTimeout(() => {
      if (speedLimitRequestRef.current !== controller) return
      setSpeedLimit(null)
      setSpeedLimitStatus('unavailable')
      controller.abort()
    }, 15_000)
    speedLimitTimeoutRef.current = timeout

    void getSpeedLimit(currentPosition.coordinates, controller.signal)
      .then((limit) => {
        if (controller.signal.aborted) return
        setSpeedLimit(limit)
        setSpeedLimitStatus(limit === null ? 'unavailable' : 'available')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setSpeedLimit(null)
        setSpeedLimitStatus('unavailable')
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (speedLimitTimeoutRef.current === timeout) speedLimitTimeoutRef.current = null
        if (speedLimitRequestRef.current === controller) speedLimitRequestRef.current = null
      })
  }, [currentPosition, navigationActive])

  useEffect(() => {
    if (navigationActive) return

    if (speedLimitTimeoutRef.current !== null) {
      window.clearTimeout(speedLimitTimeoutRef.current)
      speedLimitTimeoutRef.current = null
    }
    speedLimitRequestRef.current?.abort()
    speedLimitRequestRef.current = null
    lastSpeedLimitLookupRef.current = null
    setSpeedLimit(null)
    setSpeedLimitStatus('idle')
    setReportMode(null)
    setReportMenuOpen(false)
    setRouteReports([])
    setReportError('')
    routeReportMarkerRefs.current.forEach((marker) => marker.remove())
    routeReportMarkerRefs.current.clear()
  }, [navigationActive])

  useEffect(() => () => {
    if (speedLimitTimeoutRef.current !== null) window.clearTimeout(speedLimitTimeoutRef.current)
    speedLimitRequestRef.current?.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map || !navigationActive || !reportMode) return

    const addReportAtClick = (event: MapMouseEvent) => {
      setRouteReports((reports) => [
        ...reports,
        {
          id: `${Date.now()}-${reports.length}`,
          type: reportMode,
          coordinates: [event.lngLat.lng, event.lngLat.lat],
        },
      ])
      setReportMode(null)
      setReportMenuOpen(false)
      setReportError('')
    }

    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', addReportAtClick)

    return () => {
      map.off('click', addReportAtClick)
      map.getCanvas().style.cursor = ''
    }
  }, [navigationActive, reportMode, status])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map || !navigationActive) return

    const reportIds = new Set(routeReports.map((report) => report.id))
    for (const [id, marker] of routeReportMarkerRefs.current) {
      if (!reportIds.has(id)) {
        marker.remove()
        routeReportMarkerRefs.current.delete(id)
      }
    }

    const missingReports = routeReports.filter((report) => !routeReportMarkerRefs.current.has(report.id))
    if (missingReports.length === 0) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return

      for (const report of missingReports) {
        if (routeReportMarkerRefs.current.has(report.id)) continue
        const element = document.createElement('div')
        element.className = `route-report-marker route-report-marker-${report.type}`
        element.setAttribute('role', 'img')
        element.setAttribute('aria-label', getRouteReportLabel(report.type))
        element.textContent = getRouteReportSymbol(report.type)
        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat(report.coordinates)
          .addTo(map)
        routeReportMarkerRefs.current.set(report.id, marker)
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setReportError(error instanceof Error ? error.message : 'Le signalement ne peut pas être affiché.')
      }
    })

    return () => {
      disposed = true
    }
  }, [navigationActive, routeReports, status])

  const wasNavigationActiveRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    if (!navigationActive) {
      setFollowingPosition(true)
      return
    }

    const stopFollowing = () => setFollowingPosition(false)
    map.on('dragstart', stopFollowing)
    return () => {
      map.off('dragstart', stopFollowing)
    }
  }, [navigationActive, status])

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
    if (!currentPosition || !followingPosition) return

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
  }, [currentPosition, followingPosition, mapViewportMobile, navigationActive, route, status])

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
  }, [isDarkMapStyle, mapViewportMobile, route, routeOptions, selectedRouteIndex, status])

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

          <section className="map-live-speeds" aria-label="Vitesses">
            <div
              className="map-speed-limit"
              title={
                speedLimitStatus === 'loading'
                  ? 'Recherche de la limitation dans OpenStreetMap'
                  : speedLimitStatus === 'unavailable'
                    ? 'Limitation non renseignée ou indisponible dans OpenStreetMap'
                    : 'Limitation de vitesse issue d’OpenStreetMap'
              }
              aria-label={`Limitation de vitesse : ${speedLimit ?? 'inconnue'} km/h`}
            >
              <strong>{speedLimit ?? '—'}</strong>
              <span>km/h</span>
            </div>
            <div
              className="map-current-speed"
              aria-label={`Vitesse actuelle : ${currentPosition?.speed === null || currentPosition?.speed === undefined ? 'indisponible' : `${Math.round(currentPosition.speed * 3.6)} km/h`}`}
            >
              <strong>
                {currentPosition?.speed === null || currentPosition?.speed === undefined
                  ? '—'
                  : Math.round(currentPosition.speed * 3.6)}
              </strong>
              <span>km/h</span>
            </div>
          </section>

          <div className="route-report-tools">
            <button
              type="button"
              className={`route-report-toggle ${reportMenuOpen ? 'route-report-toggle-active' : ''}`}
              aria-label={reportMenuOpen ? 'Fermer les signalements' : 'Ajouter un signalement sur la route'}
              aria-expanded={reportMenuOpen}
              title="Ajouter un signalement"
              onClick={() => {
                setReportMode(null)
                setReportMenuOpen((isOpen) => !isOpen)
              }}
            >
              {reportMenuOpen ? <X size={22} /> : <Plus size={24} />}
            </button>
            {reportMenuOpen && (
              <div className="route-report-menu" aria-label="Type de signalement">
                {([
                  { type: 'traffic', label: 'Bouchon', Icon: Car },
                  { type: 'police', label: 'Police', Icon: Shield },
                  { type: 'obstacle', label: 'Objet sur la route', Icon: AlertTriangle },
                  { type: 'danger', label: 'Danger', Icon: AlertTriangle },
                ] as const).map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setReportMode(type)
                      setReportMenuOpen(false)
                    }}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {reportMode && (
            <div className="route-report-prompt" role="status">
              Touchez la carte pour placer : {getRouteReportLabel(reportMode).toLocaleLowerCase('fr-FR')}
              <button type="button" onClick={() => setReportMode(null)} aria-label="Annuler le signalement">
                <X size={16} />
              </button>
            </div>
          )}
          {reportError && <p className="route-report-error" role="alert">{reportError}</p>}

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
          {currentPosition && !followingPosition && (
            <button
              type="button"
              className="map-recenter-button"
              onClick={() => setFollowingPosition(true)}
              aria-label="Recentrer la carte sur ma position"
              title="Recentrer sur ma position"
            >
              <LocateFixed size={21} />
              <span>Recentrer</span>
            </button>
          )}
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

function getCoordinatesDistance(first: [number, number], second: [number, number]): number {
  const radians = Math.PI / 180
  const latitudeDelta = (second[1] - first[1]) * radians
  const longitudeDelta = (second[0] - first[0]) * radians
  const latitude1 = first[1] * radians
  const latitude2 = second[1] * radians
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function getRouteReportLabel(type: RouteReportType): string {
  switch (type) {
    case 'traffic':
      return 'Bouchon'
    case 'police':
      return 'Police'
    case 'obstacle':
      return 'Objet sur la route'
    case 'danger':
      return 'Danger'
  }
}

function getRouteReportSymbol(type: RouteReportType): string {
  switch (type) {
    case 'traffic':
      return '🚗'
    case 'police':
      return '👮'
    case 'obstacle':
      return '⚠'
    case 'danger':
      return '!'
  }
}

function getFavoriteShortcutLabel(shortcut: FavoriteShortcut): string {
  switch (shortcut) {
    case 'home':
      return 'Maison'
    case 'work':
      return 'Travail'
    case 'school':
      return 'École'
  }
}

function getFavoriteMarkerSymbol(shortcut: FavoriteShortcut | undefined): string {
  switch (shortcut) {
    case 'home':
      return '🏠'
    case 'work':
      return '💼'
    case 'school':
      return '🏫'
    default:
      return '★'
  }
}
