import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  CONTROLS_REFETCH_STEP_METERS,
  getRouteControls,
  getUpcomingControls,
  type RouteControl,
} from '../../services/routeControls'
import { getRouteSpeedLimits, getSpeedLimitAt, type SpeedLimitSpan } from '../../services/routeSpeedLimits'
import { getRouteLanes, getUpcomingLanes, type LaneGuide } from '../../services/routeLanes'
import { playAlertBeep } from '../../services/alertSound'
import { LaneGuidance } from './LaneGuidance'

/** Tolérance avant l'alerte de survitesse : 5 km/h, ou 5 % au-delà de 100 km/h. */
const getOverspeedTolerance = (limit: number) => Math.max(5, limit * 0.05)
/** Délai minimum entre deux bips de survitesse. */
const OVERSPEED_BEEP_COOLDOWN_MS = 30_000
import {
  formatManeuver,
  getManeuverDirection,
  getRemainingRouteMetrics,
  getRouteBearing,
  isOffRoute,
} from '../../services/navigation'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { FavoriteShortcut } from '../../stores/interfaceStore'
import { getTrafficFlow, TRAFFIC_MIN_ZOOM, TRAFFIC_REFRESH_MS } from '../../services/traffic'

const TRAFFIC_SOURCE_ID = 'here-traffic'
const TRAFFIC_LAYER_ID = 'here-traffic-line'
const TRAFFIC_STORAGE_KEY = 'gps:traffic-enabled'

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
  const routeControlMarkerRefs = useRef<Map<string, MapLibreMarker>>(new Map())
  const currentPositionMarkerRef = useRef<MapLibreMarker | null>(null)
  const routeReportMarkerRefs = useRef(new Map<string, MapLibreMarker>())
  const [status, setStatus] = useState<MapStatus>('loading')
  const [trafficEnabled, setTrafficEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(TRAFFIC_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [trafficStatus, setTrafficStatus] = useState<'idle' | 'loading' | 'ready' | 'zoom' | 'error'>('idle')
  const trafficButtonRef = useRef<HTMLButtonElement | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mapViewportMobile, setMapViewportMobile] = useState(false)
  const [followingPosition, setFollowingPosition] = useState(true)
  const [routeReports, setRouteReports] = useState<RouteReport[]>([])
  const [reportMode, setReportMode] = useState<RouteReportType | null>(null)
  const [reportMenuOpen, setReportMenuOpen] = useState(false)
  const [reportError, setReportError] = useState('')
  const [routeSpeedLimits, setRouteSpeedLimits] = useState<SpeedLimitSpan[] | null>(null)
  const [speedLimitsStatus, setSpeedLimitsStatus] = useState<SpeedLimitStatus>('idle')
  const [laneGuides, setLaneGuides] = useState<LaneGuide[]>([])
  const lastOverspeedBeepRef = useRef(0)
  const [routeControls, setRouteControls] = useState<RouteControl[]>([])
  const [routeControlsStatus, setRouteControlsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [routeControlsRetry, setRouteControlsRetry] = useState(0)
  const [routeControlsPartial, setRouteControlsPartial] = useState<null | 'stops' | 'lights'>(null)
  const origin = useInterfaceStore((state) => state.origin)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const destination = useInterfaceStore((state) => state.destination)
  const route = useInterfaceStore((state) => state.route)
  const routeOptions = useInterfaceStore((state) => state.routeOptions)
  const selectedRouteIndex = useInterfaceStore((state) => state.selectedRouteIndex)
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const navigationRerouting = useInterfaceStore((state) => state.navigationRerouting)
  // Lu par l'effet du tracé sans le relancer : pas de recadrage sur tout le trajet en pleine navigation.
  const navigationActiveRef = useRef(navigationActive)
  navigationActiveRef.current = navigationActive
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const movementIcon = useInterfaceStore((state) => state.movementIcon)
  const resolvedTheme = useInterfaceStore((state) => state.resolvedTheme)
  const navigationStepIndex = useInterfaceStore((state) => state.navigationStepIndex)
  // Calculé une seule fois par position GPS (dans RoutePanel), pas à chaque rendu.
  const guidance = useInterfaceStore((state) => state.navigationGuidance)
  const navigationError = useInterfaceStore((state) => state.navigationError)
  const favorites = useInterfaceStore((state) => state.favorites)
  const stopNavigation = useInterfaceStore((state) => state.stopNavigation)
  const isDarkMapStyle = resolvedTheme === 'dark'
  const resolvedThemeRef = useRef(resolvedTheme)
  resolvedThemeRef.current = resolvedTheme
  const remaining = useMemo(() => (route ? getRemainingRouteMetrics(route, guidance) : null), [route, guidance])
  const currentStep = route?.steps[guidance?.stepIndex ?? navigationStepIndex]
  const direction = getManeuverDirection(currentStep)
  const DirectionIcon = getDirectionIcon(direction)
  const offRoute = currentPosition ? isOffRoute(guidance, currentPosition.accuracy) : false

  // Distance parcourue sur le trajet. Si l'utilisateur est loin du trajet
  // (aperçu avant le départ, écart GPS), on garde la dernière valeur connue.
  const routeProgressRef = useRef<{ route: typeof route; along: number }>({ route: null, along: 0 })
  const previousProgress = routeProgressRef.current.route === route ? routeProgressRef.current.along : 0
  const routeProgress = guidance && guidance.distanceFromRoute <= 100 ? guidance.along : previousProgress
  routeProgressRef.current = { route, along: routeProgress }
  const speedLimit =
    routeSpeedLimits && guidance && !offRoute ? getSpeedLimitAt(routeSpeedLimits, guidance.along) : null
  const speedLimitStatus: SpeedLimitStatus =
    speedLimitsStatus === 'available' && speedLimit === null ? 'unavailable' : speedLimitsStatus
  const currentSpeedKmh =
    currentPosition?.speed === null || currentPosition?.speed === undefined ? null : currentPosition.speed * 3.6
  const overspeed =
    speedLimit !== null && currentSpeedKmh !== null && currentSpeedKmh > speedLimit + getOverspeedTolerance(speedLimit)
  const upcomingLanes =
    guidance && !offRoute && !navigationRerouting ? getUpcomingLanes(laneGuides, guidance.along) : null
  // Ne change que tous les CONTROLS_REFETCH_STEP_METERS : c'est ce qui déclenche une nouvelle recherche.
  const controlsFetchFrom =
    Math.floor(routeProgress / CONTROLS_REFETCH_STEP_METERS) * CONTROLS_REFETCH_STEP_METERS
  const upcomingControls = useMemo(
    () => getUpcomingControls(routeControls, routeProgress),
    [routeControls, routeProgress],
  )
  const nextLight = upcomingControls.find((control) => control.type === 'traffic-light')
  const nextStop = upcomingControls.find((control) => control.type === 'stop')

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
        instance.addControl(
          {
            onAdd: () => {
              const container = document.createElement('div')
              container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-traffic-control'
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'map-traffic-toggle'
              button.title = 'Trafic en temps réel'
              button.setAttribute('aria-label', 'Afficher le trafic en temps réel')
              button.innerHTML =
                '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7" r="1.8" fill="#d93025"/><circle cx="12" cy="12" r="1.8" fill="#f29900"/><circle cx="12" cy="17" r="1.8" fill="#1e8e3e"/></svg>'
              button.addEventListener('click', () => setTrafficEnabled((enabled) => !enabled))
              trafficButtonRef.current = button
              container.append(button)
              return container
            },
            onRemove: () => {
              trafficButtonRef.current = null
            },
          },
          'top-right',
        )
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
      routeControlMarkerRefs.current.forEach((marker) => marker.remove())
      routeControlMarkerRefs.current.clear()
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

  // Trafic HERE : bouton, préférence mémorisée, couche colorée selon l'embouteillage.
  useEffect(() => {
    const button = trafficButtonRef.current
    if (button) {
      button.setAttribute('aria-pressed', String(trafficEnabled))
      button.classList.toggle('is-active', trafficEnabled)
    }
    try {
      window.localStorage.setItem(TRAFFIC_STORAGE_KEY, trafficEnabled ? '1' : '0')
    } catch {
      // Stockage indisponible (navigation privée) : la préférence n'est simplement pas mémorisée.
    }
  }, [trafficEnabled, status])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    const removeTrafficLayer = () => {
      if (map.getLayer(TRAFFIC_LAYER_ID)) map.removeLayer(TRAFFIC_LAYER_ID)
      if (map.getSource(TRAFFIC_SOURCE_ID)) map.removeSource(TRAFFIC_SOURCE_ID)
    }
    if (!trafficEnabled) {
      removeTrafficLayer()
      setTrafficStatus('idle')
      return
    }

    let controller: AbortController | null = null
    let debounce: number | undefined
    // Zone déjà chargée : tant que l'écran reste dedans, pas de nouvelle requête.
    let loaded: { west: number; south: number; east: number; north: number; detailed: boolean; time: number } | null = null

    const refresh = (force: boolean) => {
      const zoom = map.getZoom()
      if (zoom < TRAFFIC_MIN_ZOOM) {
        if (map.getLayer(TRAFFIC_LAYER_ID)) map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'none')
        setTrafficStatus('zoom')
        return
      }
      if (map.getLayer(TRAFFIC_LAYER_ID)) map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', 'visible')

      const view = map.getBounds()
      const detailed = zoom >= 13
      const stillCovered =
        loaded &&
        loaded.detailed === detailed &&
        Date.now() - loaded.time < TRAFFIC_REFRESH_MS &&
        view.getWest() >= loaded.west &&
        view.getEast() <= loaded.east &&
        view.getSouth() >= loaded.south &&
        view.getNorth() <= loaded.north
      if (!force && stillCovered) {
        setTrafficStatus('ready')
        return
      }

      // On charge 50 % de marge autour de l'écran pour absorber les déplacements.
      const padLng = (view.getEast() - view.getWest()) * 0.5
      const padLat = (view.getNorth() - view.getSouth()) * 0.5
      const area = {
        west: view.getWest() - padLng,
        south: view.getSouth() - padLat,
        east: view.getEast() + padLng,
        north: view.getNorth() + padLat,
      }

      controller?.abort()
      const request = new AbortController()
      controller = request
      setTrafficStatus((current) => (current === 'ready' ? current : 'loading'))
      void getTrafficFlow(area, zoom, request.signal)
        .then((data) => {
          if (request.signal.aborted || mapRef.current !== map) return
          loaded = { ...area, detailed, time: Date.now() }
          const source = map.getSource(TRAFFIC_SOURCE_ID)
          if (source && 'setData' in source && typeof source.setData === 'function') {
            source.setData(data)
          } else if (!source) {
            map.addSource(TRAFFIC_SOURCE_ID, { type: 'geojson', data })
          }
          if (!map.getLayer(TRAFFIC_LAYER_ID)) {
            const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
            map.addLayer(
              {
                id: TRAFFIC_LAYER_ID,
                type: 'line',
                source: TRAFFIC_SOURCE_ID,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  // jamFactor HERE : 0 = fluide … 10 = route fermée.
                  'line-color': [
                    'step', ['get', 'jamFactor'],
                    '#1e8e3e',
                    4, '#f29900',
                    8, '#d93025',
                    10, '#7f1d1d',
                  ],
                  'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4, 18, 7],
                  'line-opacity': 0.85,
                },
              },
              firstSymbolLayer,
            )
          }
          setTrafficStatus('ready')
        })
        .catch(() => {
          if (!request.signal.aborted) setTrafficStatus('error')
        })
    }

    const handleMoveEnd = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => refresh(false), 600)
    }
    map.on('moveend', handleMoveEnd)
    const interval = window.setInterval(() => refresh(true), TRAFFIC_REFRESH_MS)
    refresh(true)

    return () => {
      map.off('moveend', handleMoveEnd)
      window.clearTimeout(debounce)
      window.clearInterval(interval)
      controller?.abort()
    }
  }, [trafficEnabled, status])

  // Nouveau trajet : on repart de zéro.
  useEffect(() => {
    setRouteControls([])
    setRouteControlsPartial(null)
  }, [route])

  // Recherche sur les ~3 km devant l'utilisateur, relancée seulement tous les 1 km parcourus.
  useEffect(() => {
    if (status !== 'ready' || !route) {
      setRouteControlsStatus('idle')
      return
    }

    const controller = new AbortController()
    let timedOut = false
    setRouteControlsStatus('loading')
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 40_000)
    // Tant que la nouvelle réponse n'est pas complète, on garde les éléments déjà connus de l'autre type.
    const keepPrevious = (type: RouteControl['type'], fresh: RouteControl[]) =>
      setRouteControls((previous) => [...fresh, ...previous.filter((control) => control.type === type)])
    void getRouteControls(route, controlsFetchFrom, controller.signal, (lights) => keepPrevious('stop', lights))
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.stopsAvailable) keepPrevious('stop', result.controls)
        else if (!result.lightsAvailable) keepPrevious('traffic-light', result.controls)
        else setRouteControls(result.controls)
        setRouteControlsPartial(!result.stopsAvailable ? 'stops' : !result.lightsAvailable ? 'lights' : null)
        setRouteControlsStatus('ready')
      })
      .catch(() => {
        if (timedOut || !controller.signal.aborted) setRouteControlsStatus('error')
      })
      .finally(() => window.clearTimeout(timeout))

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [route, controlsFetchFrom, routeControlsRetry, status])

  // Affiche seulement les prochains feux et STOP ; les repères sont ajoutés/retirés un par un.
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    const wantedIds = new Set(upcomingControls.map((control) => control.id))
    routeControlMarkerRefs.current.forEach((marker, id) => {
      if (wantedIds.has(id)) return
      marker.remove()
      routeControlMarkerRefs.current.delete(id)
    })
    const missing = upcomingControls.filter((control) => !routeControlMarkerRefs.current.has(control.id))
    if (missing.length === 0) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return

      for (const control of missing) {
        if (routeControlMarkerRefs.current.has(control.id)) continue
        const element = document.createElement('div')
        element.className = `route-control-marker route-control-marker-${control.type}`
        element.setAttribute('role', 'img')
        element.setAttribute(
          'aria-label',
          control.type === 'stop' ? 'Panneau STOP sur le trajet' : 'Feu rouge sur le trajet',
        )
        if (control.type === 'stop') {
          element.textContent = 'STOP'
        } else {
          for (const color of ['red', 'amber', 'green']) {
            const light = document.createElement('span')
            light.className = `route-control-light route-control-light-${color}`
            light.setAttribute('aria-hidden', 'true')
            element.append(light)
          }
        }
        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat(control.coordinates)
          .addTo(map)
        routeControlMarkerRefs.current.set(control.id, marker)
      }
    }).catch(() => {
      if (!disposed) setRouteControlsStatus('error')
    })

    return () => {
      disposed = true
    }
  }, [upcomingControls, status])

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

  // Limitations de vitesse : une seule requête Valhalla pour tout le trajet, au démarrage de la navigation.
  useEffect(() => {
    if (!navigationActive || !route) {
      setRouteSpeedLimits(null)
      setSpeedLimitsStatus('idle')
      return
    }

    const controller = new AbortController()
    setSpeedLimitsStatus('loading')
    void getRouteSpeedLimits(route, controller.signal)
      .then((spans) => {
        if (controller.signal.aborted) return
        setRouteSpeedLimits(spans)
        setSpeedLimitsStatus('available')
      })
      .catch(() => {
        if (!controller.signal.aborted) setSpeedLimitsStatus('unavailable')
      })

    return () => controller.abort()
  }, [navigationActive, route])

  // Voies à prendre : une seule requête Valhalla pour tout le trajet, au démarrage de la navigation.
  useEffect(() => {
    setLaneGuides([])
    if (!navigationActive || !route) return

    const controller = new AbortController()
    void getRouteLanes(route, controller.signal)
      .then((guides) => {
        if (!controller.signal.aborted) setLaneGuides(guides)
      })
      .catch(() => {
        // Sans voies, la navigation fonctionne normalement.
      })
    return () => controller.abort()
  }, [navigationActive, route])

  // Survitesse : un bip au début de chaque dépassement (au plus un toutes les 30 s).
  useEffect(() => {
    if (!overspeed) return
    const now = Date.now()
    if (now - lastOverspeedBeepRef.current < OVERSPEED_BEEP_COOLDOWN_MS) return
    lastOverspeedBeepRef.current = now
    playAlertBeep()
  }, [overspeed])

  useEffect(() => {
    if (navigationActive) return

    setReportMode(null)
    setReportMenuOpen(false)
    setRouteReports([])
    setReportError('')
    routeReportMarkerRefs.current.forEach((marker) => marker.remove())
    routeReportMarkerRefs.current.clear()
  }, [navigationActive])

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

    const routeBearing = route && guidance ? getRouteBearing(route, guidance.along) : null
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
        if (mapRef.current !== map || navigationActiveRef.current) return
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
      className={`map-canvas ${navigationActive ? 'map-navigation-active' : ''} ${upcomingLanes ? 'has-lanes' : ''}`}
      aria-label={navigationActive ? 'Carte de navigation en perspective' : 'Carte interactive'}
    >
      <div className="map-host" ref={mapContainerRef} />
      {trafficEnabled && (trafficStatus === 'loading' || trafficStatus === 'zoom' || trafficStatus === 'error') && (
        <div className={`map-traffic-status ${trafficStatus === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">
          {trafficStatus === 'loading' && 'Chargement du trafic…'}
          {trafficStatus === 'zoom' && 'Zoomez pour voir le trafic'}
          {trafficStatus === 'error' && 'Trafic indisponible'}
        </div>
      )}
      {route && routeControlsStatus !== 'idle' && (
        <div className="route-controls-legend" role="status" aria-live="polite">
          {routeControlsStatus === 'loading' && upcomingControls.length === 0 ? (
            <><LoaderCircle size={14} className="route-button-spinner" /> Recherche des feux et STOP à proximité…</>
          ) : routeControlsStatus === 'error' && upcomingControls.length === 0 ? (
            <>
              <span>Panneaux et feux indisponibles</span>
              <button
                type="button"
                className="route-controls-retry"
                onClick={() => setRouteControlsRetry((attempt) => attempt + 1)}
              >
                Réessayer
              </button>
            </>
          ) : upcomingControls.length === 0 && !routeControlsPartial ? (
            'Aucun feu ni STOP à proximité'
          ) : (
            <>
              {nextLight && (
                <span>
                  <i className="route-controls-light-key" aria-hidden="true"><span /><span /><span /></i>
                  Feu dans {formatDistance(Math.max(0, nextLight.distanceAlongRoute - routeProgress))}
                </span>
              )}
              {nextStop && (
                <span>
                  <i className="route-controls-stop-key">STOP</i>
                  STOP dans {formatDistance(Math.max(0, nextStop.distanceAlongRoute - routeProgress))}
                </span>
              )}
              {routeControlsPartial && (
                <span className="route-controls-partial">
                  {routeControlsPartial === 'stops' ? 'STOP indisponibles' : 'Feux indisponibles'}
                  <button
                    type="button"
                    className="route-controls-retry"
                    onClick={() => setRouteControlsRetry((attempt) => attempt + 1)}
                  >
                    Réessayer
                  </button>
                </span>
              )}
              <small>Données OpenStreetMap, non exhaustives</small>
            </>
          )}
        </div>
      )}
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
            ) : navigationRerouting ? (
              <p className="map-navigation-message" role="status">
                <LoaderCircle size={16} className="route-button-spinner" /> Recalcul de l’itinéraire…
              </p>
            ) : offRoute && guidance ? (
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
            {upcomingLanes && (
              <LaneGuidance lanes={upcomingLanes.guide.lanes} distance={formatDistance(upcomingLanes.distance)} />
            )}
          </section>

          <section className="map-live-speeds" aria-label="Vitesses">
            {overspeed && (
              <span className="map-overspeed-label" role="alert">Ralentissez</span>
            )}
            <div
              className={`map-speed-limit ${overspeed ? 'is-over' : ''}`}
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
              className={`map-current-speed ${overspeed ? 'is-over' : ''}`}
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
