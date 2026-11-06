import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ErrorEvent,
  Map as MapLibreMap,
  MapMouseEvent,
  MapSourceDataEvent,
  MapTouchEvent,
  Marker as MapLibreMarker,
} from 'maplibre-gl'
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Car,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Gauge,
  LocateFixed,
  LoaderCircle,
  Merge,
  RotateCcw,
  Route as RouteIcon,
  Share2,
  Shield,
  Split,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import type { RouteStep } from '../../types/geocoding'
import { getRouteGeometry } from '../../services/routeGeometry'
import { getMapStyleUrl, MAP_WORKER_URL } from '../../services/mapConfig'
import {
  CONTROLS_REFETCH_STEP_METERS,
  getRouteControls,
  getUpcomingControls,
  type RouteControl,
} from '../../services/routeControls'
import { getRouteSpeedLimits, getSpeedLimitAt, type SpeedLimitSpan } from '../../services/routeSpeedLimits'
import { getRouteLanes, getUpcomingLanes, type LaneGuide } from '../../services/routeLanes'
import { playAlertBeep, unlockAlertSound } from '../../services/alertSound'
import {
  createMotionState,
  getAngleDelta,
  getDrivingZoom,
  getMotionFrame,
  type MotionState,
} from '../../services/positionMotion'
import { haptic } from '../../services/haptics'
import { useFreeDrive } from '../../hooks/useFreeDrive'
import { applyDrivingMapLook, prefetchRouteTiles, PREFETCH_REFRESH_METERS } from '../../services/drivingMap'
import { AlongRouteSearch } from './AlongRouteSearch'
import { ParkedCar } from './ParkedCar'
import { LaneGuidance } from './LaneGuidance'

/** « Puis » : affiché si la manœuvre suivante est à moins de cette distance de la prochaine… */
const THEN_MAX_GAP_METERS = 150
/** … et qu'on approche de la prochaine. */
const THEN_SHOW_WITHIN_METERS = 600
/** En navigation, la légende feux/STOP ne s'affiche qu'à moins de cette distance. */
const CONTROLS_LEGEND_NEAR_METERS = 600
/** Recentrage automatique sur la position après ce délai sans toucher la carte. */
const AUTO_RECENTER_MS = 8_000
/** Vibrations d'approche d'une manœuvre. */
const MANEUVER_SOON_METERS = 250
const MANEUVER_NOW_METERS = 40

/** Constante de lissage de l'inclinaison et du décalage de la caméra. */
const CAMERA_SMOOTHING_MS = 300
/** Lissage plus lent du zoom : il suit la vitesse sans « respirer » à chaque variation. */
const CAMERA_ZOOM_SMOOTHING_MS = 1_500
/** Durée du raccord quand la caméra recommence à suivre la position. */
const CAMERA_CATCH_UP_MS = 700
/** Collé au tracé tant qu'on en est à moins de cette distance (ou de la précision GPS, plafonnée). */
const ROUTE_SNAP_MAX_METERS = 30
const ROUTE_SNAP_ACCURACY_CAP_METERS = 50

type CameraCatchUp = 'pending' | { start: number; center: [number, number]; bearing: number }

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

/** Tolérance avant l'alerte de survitesse : 5 km/h, ou 5 % au-delà de 100 km/h. */
const getOverspeedTolerance = (limit: number) => Math.max(5, limit * 0.05)
/** Délai minimum entre deux bips de survitesse. */
const OVERSPEED_BEEP_COOLDOWN_MS = 30_000
import {
  formatManeuver,
  getRemainingRouteMetrics,
  getRouteBearing,
  isOffRoute,
} from '../../services/navigation'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { FavoriteShortcut } from '../../stores/interfaceStore'
import {
  getTrafficTileUrl,
  TRAFFIC_MAX_TILE_ZOOM,
  TRAFFIC_MIN_ZOOM,
  TRAFFIC_REFRESH_MS,
  TRAFFIC_SOURCE_LAYER,
} from '../../services/traffic'
import {
  getRemainingTrafficDelay,
  getRouteTraffic,
  ROUTE_TRAFFIC_AHEAD_METERS,
  ROUTE_TRAFFIC_REFRESH_MS,
  type RouteTraffic,
} from '../../services/routeTraffic'
import { getRouteSlice, type Point } from '../../services/routeGeometry'

const ROUTE_TRAFFIC_SOURCE_ID = 'route-traffic'
const ROUTE_TRAFFIC_LAYER_ID = 'route-traffic-line'
/** Retard à partir duquel le temps restant passe en orange, puis en rouge (secondes). */
const TRAFFIC_DELAY_SLOW_SECONDS = 2 * 60
const TRAFFIC_DELAY_HEAVY_SECONDS = 10 * 60

const TRAFFIC_SOURCE_ID = 'tomtom-traffic'
const TRAFFIC_LAYER_ID = 'tomtom-traffic-line'
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
  const motionRef = useRef<MotionState | null>(null)
  const cameraFollowRef = useRef<{ pitch: number; paddingTop: number } | null>(null)
  /** Zoom visé, recalculé à chaque point GPS selon la vitesse et la prochaine manœuvre. */
  const cameraZoomTargetRef = useRef(17)
  const cameraCatchUpRef = useRef<CameraCatchUp | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [trafficEnabled, setTrafficEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(TRAFFIC_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [trafficStatus, setTrafficStatus] = useState<'idle' | 'loading' | 'ready' | 'zoom' | 'error'>('idle')
  const [routeTraffic, setRouteTraffic] = useState<RouteTraffic | null>(null)
  const [routeTrafficTick, setRouteTrafficTick] = useState(0)
  const trafficButtonRef = useRef<HTMLButtonElement | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mapViewportMobile, setMapViewportMobile] = useState(false)
  const [followingPosition, setFollowingPosition] = useState(true)
  /** Début du compte à rebours avant recentrage automatique (null : en pause ou inactif). */
  const [recenterCountdownStart, setRecenterCountdownStart] = useState<number | null>(null)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
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
  const freeDriveActive = useInterfaceStore((state) => state.freeDriveActive)
  /** Navigation guidée ou conduite libre : la carte suit la position. */
  const drivingActive = navigationActive || freeDriveActive
  const navigationRerouting = useInterfaceStore((state) => state.navigationRerouting)
  // Lu par l'effet du tracé sans le relancer : pas de recadrage sur tout le trajet en pleine navigation.
  const navigationActiveRef = useRef(navigationActive)
  const animatedRouteOptionsRef = useRef<unknown>(null)
  navigationActiveRef.current = navigationActive
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const movementIcon = useInterfaceStore((state) => state.movementIcon)
  const movementIconRef = useRef(movementIcon)
  movementIconRef.current = movementIcon
  const resolvedTheme = useInterfaceStore((state) => state.resolvedTheme)
  const navigationStepIndex = useInterfaceStore((state) => state.navigationStepIndex)
  // Calculé une seule fois par position GPS (dans RoutePanel), pas à chaque rendu.
  const guidance = useInterfaceStore((state) => state.navigationGuidance)
  const navigationError = useInterfaceStore((state) => state.navigationError)
  const favorites = useInterfaceStore((state) => state.favorites)
  const stopNavigation = useInterfaceStore((state) => state.stopNavigation)
  const startFreeDrive = useInterfaceStore((state) => state.startFreeDrive)
  const stopFreeDrive = useInterfaceStore((state) => state.stopFreeDrive)
  const offlineMapEnabled = useInterfaceStore((state) => state.offlineMapEnabled)
  const [alongRouteOpen, setAlongRouteOpen] = useState(false)
  const [shareFeedback, setShareFeedback] = useState('')
  const isDarkMapStyle = resolvedTheme === 'dark'
  const resolvedThemeRef = useRef(resolvedTheme)
  resolvedThemeRef.current = resolvedTheme
  const baseRemaining = useMemo(() => (route ? getRemainingRouteMetrics(route, guidance) : null), [route, guidance])
  const stepIndexNow = guidance?.stepIndex ?? navigationStepIndex
  const currentStep = route?.steps[stepIndexNow]
  const offRoute = currentPosition ? isOffRoute(guidance, currentPosition.accuracy) : false
  // Bandeau : icône de la manœuvre, rue à prendre (en grand) et consigne courte.
  const ManeuverIcon = getManeuverIcon(currentStep)
  const arriving = currentStep?.maneuver.type === 'arrive'
  const maneuverRoad = arriving ? destination?.name ?? '' : currentStep?.name ?? ''
  const maneuverHint = !currentStep
    ? ''
    : arriving
      ? guidance && guidance.distanceToStep > 30 ? 'Destination' : 'Vous êtes arrivé'
      : getShortManeuver(currentStep)
  // « Puis » : la manœuvre suivante quand elle arrive juste après celle-ci.
  const thenCandidate = route?.steps[stepIndexNow + 1]
  const thenStep =
    currentStep && thenCandidate && !offRoute && guidance &&
    currentStep.distance <= THEN_MAX_GAP_METERS && guidance.distanceToStep <= THEN_SHOW_WITHIN_METERS
      ? thenCandidate
      : null
  const ThenIcon = thenStep ? getManeuverIcon(thenStep) : null

  // Distance parcourue sur le trajet. Si l'utilisateur est loin du trajet
  // (aperçu avant le départ, écart GPS), on garde la dernière valeur connue.
  const routeProgressRef = useRef<{ route: typeof route; along: number }>({ route: null, along: 0 })
  const previousProgress = routeProgressRef.current.route === route ? routeProgressRef.current.along : 0
  const routeProgress = guidance && guidance.distanceFromRoute <= 100 ? guidance.along : previousProgress
  routeProgressRef.current = { route, along: routeProgress }
  // Retard dû aux bouchons sur le reste du trajet (0 si le trafic est désactivé).
  const trafficDelay = trafficEnabled ? getRemainingTrafficDelay(routeTraffic, routeProgress) : 0
  const remaining = baseRemaining && { ...baseRemaining, duration: baseRemaining.duration + trafficDelay }
  const trafficDelayLevel =
    trafficDelay >= TRAFFIC_DELAY_HEAVY_SECONDS ? 'heavy' : trafficDelay >= TRAFFIC_DELAY_SLOW_SECONDS ? 'slow' : null
  // Fenêtre analysée : on la décale tous les 50 km parcourus (et on rafraîchit toutes les 5 minutes).
  const routeTrafficFrom = Math.floor(routeProgress / (ROUTE_TRAFFIC_AHEAD_METERS / 2)) * (ROUTE_TRAFFIC_AHEAD_METERS / 2)
  // Portions ralenties devant la position, redessinées tous les 100 m seulement.
  const routeProgressStep = Math.floor(routeProgress / 100) * 100
  const routeTrafficData = useMemo(() => {
    if (!route || !routeTraffic || !trafficEnabled) return null
    const coordinates = route.coordinates as Point[]
    return {
      type: 'FeatureCollection' as const,
      features: routeTraffic.spans
        .filter((span) => span.end > routeProgressStep)
        .map((span) => ({
          type: 'Feature' as const,
          properties: { kind: span.kind },
          geometry: {
            type: 'LineString' as const,
            coordinates: getRouteSlice(coordinates, Math.max(span.start, routeProgressStep), span.end),
          },
        }))
        .filter((feature) => feature.geometry.coordinates.length >= 2),
    }
  }, [route, routeTraffic, trafficEnabled, routeProgressStep])
  const freeDrive = useFreeDrive(freeDriveActive)
  // Rue sur laquelle on roule (étiquette en bas de la carte).
  const currentRoadName = navigationActive
    ? offRoute ? '' : route?.steps[stepIndexNow - 1]?.name ?? ''
    : freeDriveActive ? freeDrive.roadName ?? '' : ''
  const routeSpeedLimit =
    routeSpeedLimits && guidance && !offRoute ? getSpeedLimitAt(routeSpeedLimits, guidance.along) : null
  // Sans itinéraire, la limitation vient du recalage des derniers points GPS.
  const speedLimit = freeDriveActive ? freeDrive.speedLimit : routeSpeedLimit
  const speedLimitStatus: SpeedLimitStatus = freeDriveActive
    ? freeDrive.limitStatus
    : speedLimitsStatus === 'available' && speedLimit === null ? 'unavailable' : speedLimitsStatus
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
  // Écran épuré en navigation : la légende feux/STOP n'apparaît qu'à leur approche.
  const controlsNearby = [nextLight, nextStop].some(
    (control) => control && control.distanceAlongRoute - routeProgress <= CONTROLS_LEGEND_NEAR_METERS,
  )

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
        const handleError = (event: ErrorEvent & { sourceId?: string; tile?: unknown }) => {
          // Une tuile qui échoue (tunnel, réseau faible) ne doit pas masquer toute la carte :
          // seules les erreurs du style lui-même sont bloquantes. Les tuiles manquantes se rechargent seules.
          if (event.sourceId || event.tile) return
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

  // Trafic TomTom : bouton, préférence mémorisée, couche colorée selon l'embouteillage.
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

    // Tuiles vectorielles TomTom : MapLibre ne charge que la zone visible, comme le fond de carte.
    if (!map.getSource(TRAFFIC_SOURCE_ID)) {
      map.addSource(TRAFFIC_SOURCE_ID, {
        type: 'vector',
        tiles: [getTrafficTileUrl()],
        minzoom: TRAFFIC_MIN_ZOOM,
        maxzoom: TRAFFIC_MAX_TILE_ZOOM,
        attribution: 'Trafic © TomTom',
      })
    }
    if (!map.getLayer(TRAFFIC_LAYER_ID)) {
      const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
      map.addLayer(
        {
          id: TRAFFIC_LAYER_ID,
          type: 'line',
          source: TRAFFIC_SOURCE_ID,
          'source-layer': TRAFFIC_SOURCE_LAYER,
          minzoom: TRAFFIC_MIN_ZOOM,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            // traffic_level TomTom (style « relative ») : vitesse actuelle / vitesse fluide, de 0 à 1.
            'line-color': [
              'case',
              ['has', 'road_closure'], '#7f1d1d',
              ['step', ['to-number', ['get', 'traffic_level'], 1],
                '#d93025',
                0.4, '#f29900',
                0.75, '#1e8e3e',
              ],
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 11, 2, 15, 4, 18, 7],
            // Route à double sens : chaque sens est décalé de son côté pour voir les deux.
            // (MapLibre exige que l'interpolation sur le zoom soit au premier niveau de l'expression.)
            'line-offset': [
              'interpolate', ['linear'], ['zoom'],
              9, ['case', ['==', ['get', 'traffic_road_coverage'], 'one_side'], 0.75, 0],
              15, ['case', ['==', ['get', 'traffic_road_coverage'], 'one_side'], 2.5, 0],
              18, ['case', ['==', ['get', 'traffic_road_coverage'], 'one_side'], 4, 0],
            ],
            'line-opacity': 0.85,
          },
        },
        // Toujours sous le trajet (et son contour), sinon les lignes de trafic le recouvrent.
        map.getLayer('osrm-route-casing') ? 'osrm-route-casing' : firstSymbolLayer,
      )
    }

    const updateZoomStatus = () => {
      setTrafficStatus((current) => {
        if (map.getZoom() < TRAFFIC_MIN_ZOOM) return 'zoom'
        return current === 'zoom' || current === 'idle' ? 'loading' : current
      })
    }
    const handleSourceData = (event: MapSourceDataEvent) => {
      if (event.sourceId === TRAFFIC_SOURCE_ID && event.isSourceLoaded && map.getZoom() >= TRAFFIC_MIN_ZOOM) {
        setTrafficStatus('ready')
      }
    }
    const handleError = (event: ErrorEvent & { sourceId?: string }) => {
      if (event.sourceId === TRAFFIC_SOURCE_ID) setTrafficStatus('error')
    }
    // Toutes les 2 minutes, nouvelle URL de tuiles : MapLibre recharge les données de trafic.
    const interval = window.setInterval(() => {
      const source = map.getSource(TRAFFIC_SOURCE_ID)
      if (source && 'setTiles' in source && typeof source.setTiles === 'function') {
        source.setTiles([getTrafficTileUrl()])
      }
    }, TRAFFIC_REFRESH_MS)

    map.on('zoomend', updateZoomStatus)
    map.on('sourcedata', handleSourceData)
    map.on('error', handleError)
    updateZoomStatus()

    return () => {
      map.off('zoomend', updateZoomStatus)
      map.off('sourcedata', handleSourceData)
      map.off('error', handleError)
      window.clearInterval(interval)
    }
  }, [trafficEnabled, status])

  // Trafic sur le trajet : tuiles TomTom le long des 100 km à venir, rafraîchies toutes les 5 minutes.
  useEffect(() => {
    if (!trafficEnabled || !route) {
      setRouteTraffic(null)
      return
    }
    const controller = new AbortController()
    void getRouteTraffic(route, routeTrafficFrom, controller.signal)
      .then((traffic) => {
        if (!controller.signal.aborted) setRouteTraffic(traffic)
      })
      .catch(() => {
        // Trafic indisponible : on garde l'ancien état, le trajet reste bleu au pire.
      })
    const timer = window.setTimeout(() => setRouteTrafficTick((tick) => tick + 1), ROUTE_TRAFFIC_REFRESH_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [trafficEnabled, route, routeTrafficFrom, routeTrafficTick])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return
    if (!routeTrafficData) {
      if (map.getLayer(ROUTE_TRAFFIC_LAYER_ID)) map.removeLayer(ROUTE_TRAFFIC_LAYER_ID)
      if (map.getSource(ROUTE_TRAFFIC_SOURCE_ID)) map.removeSource(ROUTE_TRAFFIC_SOURCE_ID)
      return
    }
    const source = map.getSource(ROUTE_TRAFFIC_SOURCE_ID)
    if (source && 'setData' in source && typeof source.setData === 'function') source.setData(routeTrafficData)
    else if (!source) map.addSource(ROUTE_TRAFFIC_SOURCE_ID, { type: 'geojson', data: routeTrafficData })

    const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
    if (!map.getLayer(ROUTE_TRAFFIC_LAYER_ID)) {
      map.addLayer(
        {
          id: ROUTE_TRAFFIC_LAYER_ID,
          type: 'line',
          source: ROUTE_TRAFFIC_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'kind'], 'closed', '#7f1d1d', 'heavy', '#d93025', '#f29900'],
            // Même épaisseur que la bande bleue du trajet sélectionné, qu'elle recouvre.
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 8, 18, 16],
          },
        },
        firstSymbolLayer,
      )
    }
    // Toujours au-dessus de la bande bleue (qui peut être recréée après un changement de thème).
    if (map.getLayer('osrm-route-line')) map.moveLayer(ROUTE_TRAFFIC_LAYER_ID, firstSymbolLayer)
  }, [routeTrafficData, status, route])

  // En conduite, le trafic des autres routes passe au second plan : sans le vert « fluide »
  // (inutile en roulant) et plus transparent, pour que le trajet reste bien lisible.
  // Le trajet lui-même garde ses portions orange et rouges (couche route-traffic-line).
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map || !trafficEnabled || !map.getLayer(TRAFFIC_LAYER_ID)) return
    map.setFilter(
      TRAFFIC_LAYER_ID,
      drivingActive
        ? ['any', ['has', 'road_closure'], ['<', ['to-number', ['get', 'traffic_level'], 1], 0.75]]
        : null,
    )
    map.setPaintProperty(TRAFFIC_LAYER_ID, 'line-opacity', drivingActive ? 0.5 : 0.85)
  }, [drivingActive, trafficEnabled, status])

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

  // Nouveau point GPS : nouvel état de mouvement (prédiction + collage au tracé),
  // raccordé en douceur à ce qui est affiché. Le zoom visé suit la vitesse.
  useEffect(() => {
    if (!currentPosition) {
      motionRef.current = null
      return
    }

    const snapToRoute =
      navigationActive &&
      route !== null &&
      guidance !== null &&
      guidance.distanceFromRoute <=
        Math.max(ROUTE_SNAP_MAX_METERS, Math.min(currentPosition.accuracy, ROUTE_SNAP_ACCURACY_CAP_METERS))
    const routeBearing = navigationActive && route && guidance ? getRouteBearing(route, guidance.along) : null

    motionRef.current = createMotionState(
      {
        coordinates: currentPosition.coordinates,
        speed: currentPosition.speed,
        heading: currentPosition.heading,
        snap: snapToRoute && route && guidance ? { coordinates: route.coordinates, along: guidance.along } : null,
        fallbackHeading: routeBearing,
      },
      performance.now(),
      motionRef.current,
    )
    cameraZoomTargetRef.current = getDrivingZoom(
      currentPosition.speed,
      guidance && !isOffRoute(guidance, currentPosition.accuracy) ? guidance.distanceToStep : null,
    )
    // guidance et route sont mis à jour en même temps que la position (même mise à jour du store).
  }, [currentPosition])

  // Boucle d'animation : marqueur et caméra suivent la position prédite à chaque image.
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    let frame = 0
    let lastFrame = performance.now()
    let settledMotion: MotionState | null = null

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(now - lastFrame, 100)
      lastFrame = now

      const motion = motionRef.current
      if (!motion) return
      const { coordinates, heading, settled } = getMotionFrame(motion, now)

      const marker = currentPositionMarkerRef.current
      if (marker && settledMotion !== motion) {
        marker.setLngLat(coordinates)
        marker.setRotation(movementIconRef.current === 'dot' ? 0 : heading)
        if (settled) settledMotion = motion
      }

      const follow = cameraFollowRef.current
      if (!follow) return

      let center = coordinates
      let bearing = heading
      let catchUp = cameraCatchUpRef.current
      if (catchUp === 'pending') {
        const mapCenter = map.getCenter()
        catchUp = { start: now, center: [mapCenter.lng, mapCenter.lat], bearing: map.getBearing() }
        cameraCatchUpRef.current = catchUp
      }
      if (catchUp) {
        const t = Math.min((now - catchUp.start) / CAMERA_CATCH_UP_MS, 1)
        const eased = 1 - (1 - t) ** 3
        center = [lerp(catchUp.center[0], coordinates[0], eased), lerp(catchUp.center[1], coordinates[1], eased)]
        bearing = catchUp.bearing + getAngleDelta(catchUp.bearing, heading) * eased
        if (t >= 1) cameraCatchUpRef.current = null
      }

      const zoom = map.getZoom()
      const pitch = map.getPitch()
      const paddingTop = map.getPadding().top ?? 0
      const zoomTarget = cameraZoomTargetRef.current
      const cameraSettled =
        !catchUp &&
        Math.abs(zoomTarget - zoom) < 0.002 &&
        Math.abs(follow.pitch - pitch) < 0.01 &&
        Math.abs(follow.paddingTop - paddingTop) < 0.5
      if (cameraSettled && settledMotion === motion) return

      const k = 1 - Math.exp(-dt / CAMERA_SMOOTHING_MS)
      const zoomK = 1 - Math.exp(-dt / CAMERA_ZOOM_SMOOTHING_MS)
      map.jumpTo({
        center,
        bearing,
        zoom: lerp(zoom, zoomTarget, zoomK),
        pitch: lerp(pitch, follow.pitch, k),
        padding: { top: lerp(paddingTop, follow.paddingTop, k), bottom: 0, left: 0, right: 0 },
      })
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [status])

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
      // Position et rotation sont ensuite animées image par image (voir la boucle d'animation).
      const motion = motionRef.current
      const displayed = motion ? getMotionFrame(motion, performance.now()) : null
      marker
        .setLngLat(displayed?.coordinates ?? currentPosition.coordinates)
        .setRotationAlignment('map')
        .setRotation(movementIcon === 'dot' ? 0 : displayed?.heading ?? currentPosition.heading ?? 0)
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
    haptic('warning')
  }, [overspeed])

  useEffect(() => {
    if (navigationActive) return

    setReportMode(null)
    setReportMenuOpen(false)
    setStopConfirmOpen(false)
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

  // Carte allégée pendant la conduite : rendu moins coûteux, sans détails inutiles en roulant.
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return
    applyDrivingMapLook(map, drivingActive)
  }, [drivingActive, status])

  // Carte hors ligne : tuiles préchargées devant soi au départ, puis tous les PREFETCH_REFRESH_METERS.
  const prefetchStep = Math.floor(routeProgress / PREFETCH_REFRESH_METERS)
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map || !navigationActive || !route || !offlineMapEnabled) return
    // On laisse d'abord la carte charger ce qui est à l'écran.
    const timer = window.setTimeout(() => prefetchRouteTiles(map, route, routeProgressRef.current.along), 4_000)
    return () => window.clearTimeout(timer)
  }, [navigationActive, offlineMapEnabled, prefetchStep, route, status])

  // Aperçu : tout le trajet restant à l'écran, carte à plat et nord en haut.
  // Le recentrage automatique ramène ensuite la vue sur la voiture.
  const showRouteOverview = () => {
    const map = mapRef.current
    if (!map || !route) return
    haptic('tap')
    cameraFollowRef.current = null
    cameraCatchUpRef.current = null
    setFollowingPosition(false)
    const { cumulative } = getRouteGeometry(route.coordinates)
    const remainingPoints = route.coordinates.filter((_, index) => cumulative[index] >= routeProgress)
    const points = currentPosition ? [currentPosition.coordinates, ...remainingPoints] : remainingPoints
    if (points.length === 0) return
    let [west, south] = points[0]
    let [east, north] = points[0]
    for (const [longitude, latitude] of points) {
      west = Math.min(west, longitude)
      east = Math.max(east, longitude)
      south = Math.min(south, latitude)
      north = Math.max(north, latitude)
    }
    const height = map.getContainer().clientHeight
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })
    map.fitBounds(
      [[west, south], [east, north]],
      {
        padding: { top: Math.round(height * 0.22), bottom: Math.round(height * 0.24), left: 48, right: 48 },
        pitch: 0,
        bearing: 0,
        maxZoom: 16,
        duration: 900,
        essential: true,
      },
    )
  }

  // Étiquette de la rue à prendre, posée sur la carte à l'endroit de la manœuvre.
  const maneuverLabelRef = useRef<MapLibreMarker | null>(null)
  const maneuverLabelText = navigationActive && !offRoute && currentStep && !arriving ? currentStep.name : ''
  const [maneuverLongitude, maneuverLatitude] = currentStep?.maneuver.location ?? [Number.NaN, Number.NaN]
  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map || !maneuverLabelText || !Number.isFinite(maneuverLongitude)) return

    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed || mapRef.current !== map) return
      const element = document.createElement('div')
      element.className = 'nav-maneuver-label'
      element.textContent = maneuverLabelText
      element.setAttribute('aria-hidden', 'true')
      maneuverLabelRef.current = new Marker({ element, anchor: 'bottom-left', offset: [8, -8] })
        .setLngLat([maneuverLongitude, maneuverLatitude])
        .addTo(map)
    })
    return () => {
      disposed = true
      maneuverLabelRef.current?.remove()
      maneuverLabelRef.current = null
    }
  }, [maneuverLabelText, maneuverLatitude, maneuverLongitude, status])

  const shareArrival = async () => {
    if (!remaining) return
    haptic('tap')
    const text = `J’arrive${destination ? ` à ${destination.name}` : ''} vers ${formatArrivalTime(remaining.duration)} (dans ${formatDuration(remaining.duration)}).`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      setShareFeedback('Heure d’arrivée copiée')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareFeedback('Partage impossible sur cet appareil')
    }
  }

  useEffect(() => {
    if (!shareFeedback) return
    const timer = window.setTimeout(() => setShareFeedback(''), 2_500)
    return () => window.clearTimeout(timer)
  }, [shareFeedback])

  const wasNavigationActiveRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    if (!drivingActive) {
      setFollowingPosition(true)
      setRecenterCountdownStart(null)
      return
    }

    let interacting = false
    const stopFollowing = () => {
      // Coupé tout de suite, sans attendre le rendu React, pour que la boucle ne lutte pas contre le geste.
      cameraFollowRef.current = null
      cameraCatchUpRef.current = null
      setFollowingPosition(false)
    }
    const startInteraction = () => {
      interacting = true
      setRecenterCountdownStart(null)
    }
    const endInteraction = () => {
      interacting = false
      if (!cameraFollowRef.current) setRecenterCountdownStart(Date.now())
    }
    // Mouvement venant d'un geste (nos jumpTo de suivi n'ont pas d'originalEvent).
    const handleUserCameraChange = (event: { originalEvent?: Event }) => {
      if (event.originalEvent) stopFollowing()
    }
    const handleTouchStart = (event: MapTouchEvent) => {
      startInteraction()
      // Pincer ou tourner à deux doigts : on arrête de suivre dès le 2e doigt, avant que le geste ne démarre.
      if (event.originalEvent.touches.length >= 2) stopFollowing()
    }
    const handleTouchEnd = (event: MapTouchEvent) => {
      if (event.originalEvent.touches.length === 0) endInteraction()
    }
    // Molette : le compte à rebours repartira au moveend du zoom.
    const handleWheel = () => {
      stopFollowing()
      setRecenterCountdownStart(null)
    }
    // Fin d'un déplacement (inertie comprise) : le compte à rebours du recentrage repart.
    const handleMoveEnd = () => {
      if (!interacting && !cameraFollowRef.current) setRecenterCountdownStart(Date.now())
    }

    map.on('dragstart', stopFollowing)
    map.on('zoomstart', handleUserCameraChange)
    map.on('rotatestart', handleUserCameraChange)
    map.on('pitchstart', handleUserCameraChange)
    map.on('touchstart', handleTouchStart)
    map.on('touchend', handleTouchEnd)
    map.on('touchcancel', handleTouchEnd)
    map.on('mousedown', startInteraction)
    map.on('mouseup', endInteraction)
    map.on('wheel', handleWheel)
    map.on('moveend', handleMoveEnd)
    return () => {
      map.off('dragstart', stopFollowing)
      map.off('zoomstart', handleUserCameraChange)
      map.off('rotatestart', handleUserCameraChange)
      map.off('pitchstart', handleUserCameraChange)
      map.off('touchstart', handleTouchStart)
      map.off('touchend', handleTouchEnd)
      map.off('touchcancel', handleTouchEnd)
      map.off('mousedown', startInteraction)
      map.off('mouseup', endInteraction)
      map.off('wheel', handleWheel)
      map.off('moveend', handleMoveEnd)
    }
  }, [drivingActive, status])

  // Recentrage automatique après AUTO_RECENTER_MS sans toucher la carte
  // (en pause pendant un signalement, le temps de choisir où le placer).
  useEffect(() => {
    if (reportMode || reportMenuOpen || alongRouteOpen) setRecenterCountdownStart(null)
    else if (drivingActive && !cameraFollowRef.current) setRecenterCountdownStart(Date.now())
  }, [alongRouteOpen, drivingActive, reportMenuOpen, reportMode])

  useEffect(() => {
    if (followingPosition) {
      setRecenterCountdownStart(null)
      return
    }
    if (recenterCountdownStart === null || !drivingActive || alongRouteOpen || reportMode || reportMenuOpen) return
    const delay = Math.max(0, AUTO_RECENTER_MS - (Date.now() - recenterCountdownStart))
    const timer = window.setTimeout(() => {
      setRecenterCountdownStart(null)
      setFollowingPosition(true)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [alongRouteOpen, followingPosition, drivingActive, recenterCountdownStart, reportMenuOpen, reportMode])

  // Vibrations à l'approche de la prochaine manœuvre (une fois à 250 m, une fois au moment de tourner).
  const maneuverHapticRef = useRef({ stepIndex: -1, soon: false, now: false })
  useEffect(() => {
    if (!navigationActive || !guidance || !currentPosition || isOffRoute(guidance, currentPosition.accuracy)) return
    const state = maneuverHapticRef.current
    if (state.stepIndex !== guidance.stepIndex) {
      // Nouvelle manœuvre : si on est déjà tout près (étapes rapprochées), pas d'alerte « bientôt ».
      maneuverHapticRef.current = {
        stepIndex: guidance.stepIndex,
        soon: guidance.distanceToStep <= MANEUVER_NOW_METERS,
        now: false,
      }
    }
    const current = maneuverHapticRef.current
    if (!current.soon && guidance.distanceToStep <= MANEUVER_SOON_METERS) {
      current.soon = true
      haptic('maneuver-soon')
    } else if (!current.now && guidance.distanceToStep <= MANEUVER_NOW_METERS) {
      current.now = true
      current.soon = true
      haptic('maneuver-now')
    }
  }, [currentPosition, guidance, navigationActive])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'ready' || !map) return

    if (!drivingActive) {
      cameraFollowRef.current = null
      cameraCatchUpRef.current = null
      if (wasNavigationActiveRef.current) {
        map.easeTo({
          pitch: 0,
          bearing: 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 700,
          essential: true,
        })
      }
      wasNavigationActiveRef.current = false
      return
    }

    wasNavigationActiveRef.current = true
    if (!followingPosition) {
      cameraFollowRef.current = null
      cameraCatchUpRef.current = null
      return
    }

    // La caméra elle-même est déplacée image par image par la boucle d'animation.
    // Le décalage vers le bas de la position passe par un padding haut (= 2 × l'ancien offset).
    const wasFollowing = cameraFollowRef.current !== null
    cameraFollowRef.current = {
      pitch: mapViewportMobile ? 55 : 58,
      // Voiture vers le bas de l'écran (≈ 68 % de la hauteur sur téléphone) : on voit loin devant.
      paddingTop: Math.round(map.getContainer().clientHeight * (mapViewportMobile ? 0.36 : 0.32)),
    }
    if (!wasFollowing) {
      map.stop()
      cameraCatchUpRef.current = 'pending'
    }
  }, [followingPosition, mapViewportMobile, drivingActive, status])

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

    // Animation d'apparition : seulement pour une nouvelle liste d'itinéraires, hors navigation,
    // et si l'appareil ne demande pas de réduire les animations.
    const routeList = routeOptions.length > 0 ? routeOptions : route
    const animateDrawing =
      animatedRouteOptionsRef.current !== routeList &&
      !navigationActiveRef.current &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    animatedRouteOptionsRef.current = routeList
    const partialRouteData = (progress: number) => ({
      ...routeData,
      features: routeData.features.map((feature) => {
        const coordinates = feature.geometry.coordinates
        const count = Math.max(2, Math.ceil(coordinates.length * progress))
        return { ...feature, geometry: { ...feature.geometry, coordinates: coordinates.slice(0, count) } }
      }),
    })
    let drawFrame = 0

    try {
      const initialData = animateDrawing ? partialRouteData(0) : routeData
      const source = map.getSource(sourceId)
      if (source && 'setData' in source && typeof source.setData === 'function') {
        source.setData(initialData)
      } else if (!source) {
        map.addSource(sourceId, { type: 'geojson', data: initialData })
      } else {
        throw new Error('Une source cartographique incompatible utilise déjà cet identifiant.')
      }
      if (animateDrawing) {
        const startTime = performance.now()
        const DRAW_DURATION_MS = 900
        const step = (now: number) => {
          const routeSource = map.getSource(sourceId)
          if (!routeSource || !('setData' in routeSource) || typeof routeSource.setData !== 'function') return
          const linear = Math.min(1, (now - startTime) / DRAW_DURATION_MS)
          const eased = 1 - (1 - linear) ** 3
          routeSource.setData(linear < 1 ? partialRouteData(eased) : routeData)
          if (linear < 1) drawFrame = window.requestAnimationFrame(step)
        }
        drawFrame = window.requestAnimationFrame(step)
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
              // Tracé épais en vue rapprochée (lisible d'un coup d'œil en conduisant), fin en vue d'ensemble.
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'selected'], 7, 5], 15, ['case', ['get', 'selected'], 12, 7], 18, ['case', ['get', 'selected'], 22, 10]],
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'selected'], 4, 3], 15, ['case', ['get', 'selected'], 8, 4], 18, ['case', ['get', 'selected'], 16, 7]],
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

    return () => window.cancelAnimationFrame(drawFrame)
  }, [isDarkMapStyle, mapViewportMobile, route, routeOptions, selectedRouteIndex, status])

  // Légende feux/STOP : sous le bandeau en navigation, dans un coin de la carte sinon.
  const controlsLegend = route && routeControlsStatus !== 'idle' && (!navigationActive || controlsNearby) ? (
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
  ) : null

  return (
    <section
      className={`map-canvas ${drivingActive ? 'map-navigation-active' : ''} ${upcomingLanes ? 'has-lanes' : ''}`}
      aria-label={drivingActive ? 'Carte de navigation en perspective' : 'Carte interactive'}
    >
      <div className="map-host" ref={mapContainerRef} />
      {trafficEnabled && (trafficStatus === 'loading' || trafficStatus === 'zoom' || trafficStatus === 'error') && (
        <div className={`map-traffic-status ${trafficStatus === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">
          {trafficStatus === 'loading' && 'Chargement du trafic…'}
          {trafficStatus === 'zoom' && 'Zoomez pour voir le trafic'}
          {trafficStatus === 'error' && 'Trafic indisponible'}
        </div>
      )}
      {!navigationActive && controlsLegend}
      {navigationActive && route && (
        <>
          {/* Bandeau de guidage : flèche + distance, rue à prendre, puis les voies dans le même bloc. */}
          <div className="nav-top">
            <section className="nav-banner" aria-label="Prochaine direction">
              {navigationError ? (
                <p className="nav-banner-message" role="alert">{navigationError}</p>
              ) : !currentPosition ? (
                <p className="nav-banner-message" role="status">
                  <LoaderCircle size={18} className="route-button-spinner" />
                  Recherche de votre position GPS…
                </p>
              ) : navigationRerouting ? (
                <p className="nav-banner-message" role="status">
                  <LoaderCircle size={18} className="route-button-spinner" /> Recalcul de l’itinéraire…
                </p>
              ) : offRoute && guidance ? (
                <p className="nav-banner-message" role="status">
                  Vous êtes à {formatDistance(guidance.distanceFromRoute)} de l’itinéraire.
                </p>
              ) : guidance && currentStep ? (
                <div className="nav-banner-main" key={guidance.stepIndex}>
                  <span className="nav-banner-turn">
                    <ManeuverIcon size={40} strokeWidth={2.8} aria-hidden="true" />
                    <span className="nav-banner-distance">
                      {formatDistanceParts(guidance.distanceToStep).value}
                      <small>{formatDistanceParts(guidance.distanceToStep).unit}</small>
                    </span>
                  </span>
                  <span className="nav-banner-copy">
                    {maneuverRoad && <span className="nav-banner-hint">{maneuverHint}</span>}
                    <strong>{maneuverRoad || maneuverHint}</strong>
                  </span>
                </div>
              ) : null}
              {upcomingLanes && !offRoute && (
                <LaneGuidance lanes={upcomingLanes.guide.lanes} distance={formatDistance(upcomingLanes.distance)} />
              )}
            </section>
            <div className="nav-top-under">
              {thenStep && ThenIcon && (
                <div className="nav-then" aria-label={`Puis ${getShortManeuver(thenStep).toLocaleLowerCase('fr-FR')}`}>
                  <span>Puis</span>
                  <ThenIcon size={20} strokeWidth={2.8} aria-hidden="true" />
                </div>
              )}
              {controlsLegend}
            </div>
          </div>

          {/* Boutons ronds à droite, au-dessus de la feuille du bas. */}
          <div className="nav-fabs">
            {/* Trafic : le groupe de boutons de carte est masqué en conduite, on le propose ici. */}
            <button
              type="button"
              className={`nav-fab nav-fab-traffic ${trafficEnabled ? 'is-active' : ''}`}
              aria-pressed={trafficEnabled}
              aria-label={trafficEnabled ? 'Masquer le trafic en temps réel' : 'Afficher le trafic en temps réel'}
              title="Trafic en temps réel"
              onClick={() => {
                haptic('tap')
                setTrafficEnabled((enabled) => !enabled)
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <rect x="7" y="2" width="10" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="7" r="1.8" fill="#d93025" />
                <circle cx="12" cy="12" r="1.8" fill="#f29900" />
                <circle cx="12" cy="17" r="1.8" fill="#1e8e3e" />
              </svg>
            </button>
            <AlongRouteSearch
              map={mapRef.current}
              mapReady={status === 'ready'}
              along={routeProgress}
              onOpenChange={(open) => {
                setAlongRouteOpen(open)
                if (open) setReportMenuOpen(false)
              }}
            />
            <div className="nav-report">
              <button
                type="button"
                className={`nav-fab nav-fab-report ${reportMenuOpen ? 'is-active' : ''}`}
                aria-label={reportMenuOpen ? 'Fermer les signalements' : 'Ajouter un signalement sur la route'}
                aria-expanded={reportMenuOpen}
                title="Signaler"
                onClick={() => {
                  haptic('tap')
                  setReportMode(null)
                  setReportMenuOpen((isOpen) => !isOpen)
                }}
              >
                {reportMenuOpen ? <X size={24} /> : <TriangleAlert size={24} />}
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
                        haptic('tap')
                        setReportMode(type)
                        setReportMenuOpen(false)
                      }}
                    >
                      <Icon size={20} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
          {shareFeedback && <p className="map-share-feedback" role="status">{shareFeedback}</p>}

          {/* Feuille du bas : temps restant en grand, distance et heure d'arrivée, aperçu, quitter. */}
          <section className="nav-sheet" aria-label="Résumé de navigation">
            <span className="nav-sheet-grip" aria-hidden="true" />
            <button
              type="button"
              className="nav-sheet-summary"
              onClick={() => void shareArrival()}
              disabled={!remaining}
              aria-label={
                remaining
                  ? `${formatDuration(remaining.duration)} restantes, ${formatDistance(remaining.distance)}, arrivée à ${formatArrivalTime(remaining.duration)}. Partager l’heure d’arrivée`
                  : 'Temps restant inconnu'
              }
            >
              <strong className={trafficDelayLevel ? `is-traffic-${trafficDelayLevel}` : undefined}>
                {remaining ? formatDuration(remaining.duration) : '—'}
                {trafficDelayLevel && (
                  <small className="nav-traffic-delay">+{Math.round(trafficDelay / 60)} min</small>
                )}
              </strong>
              <span>
                {remaining ? `${formatDistance(remaining.distance)} · ${formatArrivalTime(remaining.duration)}` : 'Calcul en cours'}
                <Share2 size={13} aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              className="nav-sheet-round"
              onClick={showRouteOverview}
              aria-label="Aperçu du trajet restant"
              title="Aperçu du trajet"
            >
              <RouteIcon size={22} />
            </button>
            <button
              type="button"
              className="nav-sheet-quit"
              onClick={() => {
                haptic('tap')
                setStopConfirmOpen(true)
              }}
              aria-haspopup="dialog"
            >
              Quitter
            </button>
          </section>
          {stopConfirmOpen && (
            <div className="map-stop-confirm-backdrop" onClick={() => setStopConfirmOpen(false)}>
              <div
                className="map-stop-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="map-stop-confirm-title"
                onClick={(event) => event.stopPropagation()}
              >
                <p id="map-stop-confirm-title">Arrêter la navigation ?</p>
                <div className="map-stop-confirm-actions">
                  <button type="button" autoFocus onClick={() => setStopConfirmOpen(false)}>
                    Continuer
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      haptic('confirm')
                      setStopConfirmOpen(false)
                      stopNavigation()
                    }}
                  >
                    Arrêter
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {drivingActive && (
        <>
          {/* Vitesses en bas à gauche : panneau de limitation + vitesse actuelle. */}
          <section className={`nav-speed ${overspeed ? 'is-over' : ''}`} aria-label="Vitesses">
            <div
              className="nav-speed-limit"
              title={
                speedLimitStatus === 'loading'
                  ? 'Recherche de la limitation dans OpenStreetMap'
                  : speedLimitStatus === 'unavailable'
                    ? 'Limitation non renseignée ou indisponible dans OpenStreetMap'
                    : 'Limitation de vitesse issue d’OpenStreetMap'
              }
              aria-label={`Limitation de vitesse : ${speedLimit ?? 'inconnue'} km/h`}
            >
              {speedLimit ?? '—'}
            </div>
            <div
              className="nav-speed-current"
              aria-label={`Vitesse actuelle : ${currentSpeedKmh === null ? 'indisponible' : `${Math.round(currentSpeedKmh)} km/h`}`}
            >
              <strong>{currentSpeedKmh === null ? '--' : Math.round(currentSpeedKmh)}</strong>
              <span>km/h</span>
            </div>
            {overspeed && <span className="nav-speed-alert" role="alert">Ralentissez</span>}
          </section>

          {currentPosition && !followingPosition ? (
            <button
              type="button"
              className="nav-recenter"
              onClick={() => {
                haptic('tap')
                setRecenterCountdownStart(null)
                setFollowingPosition(true)
              }}
              aria-label="Recentrer la carte sur ma position"
            >
              <LocateFixed size={20} />
              <span>Recentrer</span>
              {recenterCountdownStart !== null && (
                <span
                  key={recenterCountdownStart}
                  className="map-recenter-progress"
                  style={{ animationDuration: `${AUTO_RECENTER_MS}ms` }}
                  aria-hidden="true"
                />
              )}
            </button>
          ) : (
            currentRoadName && (
              <div className="nav-road-label" aria-label={`Vous êtes sur ${currentRoadName}`}>
                {currentRoadName}
              </div>
            )
          )}
        </>
      )}
      {freeDriveActive && (
        <section className="nav-sheet nav-sheet-free" aria-label="Conduite libre">
          <span className="nav-sheet-grip" aria-hidden="true" />
          <div className="nav-sheet-summary">
            <strong>Conduite libre</strong>
            <span>
              {navigationError
                ? navigationError
                : !currentPosition
                  ? 'Recherche de votre position GPS…'
                  : speedLimitStatus === 'loading'
                    ? 'Recherche de la limitation…'
                    : speedLimitStatus === 'unavailable'
                      ? 'Limitation inconnue sur cette route'
                      : 'Vitesse et limitation en direct'}
            </span>
          </div>
          <button
            type="button"
            className="nav-sheet-quit"
            onClick={() => {
              haptic('confirm')
              stopFreeDrive()
            }}
          >
            Quitter
          </button>
        </section>
      )}
      {/* Raccourcis en haut à gauche : conduite libre et voiture garée, sur une même ligne. */}
      <div className="map-quick-actions">
      {!drivingActive && status === 'ready' && (
        <button
          type="button"
          className="map-free-drive-start"
          onClick={() => {
            // Débloque le son de survitesse (autorisé seulement après un geste).
            unlockAlertSound()
            haptic('confirm')
            startFreeDrive()
          }}
          title="Conduire sans itinéraire : vitesse et limitation en direct"
        >
          <Gauge size={18} />
          <span>Conduire</span>
        </button>
      )}
        <ParkedCar map={mapRef.current} mapReady={status === 'ready'} drivingActive={drivingActive} />
      </div>
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

/** Icône de manœuvre plus précise que gauche/droite : légèrement, bifurcation, arrivée… */
function getManeuverIcon(step: RouteStep | undefined) {
  if (!step) return ArrowUp
  const { type, modifier } = step.maneuver
  if (type === 'arrive') return Flag
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn' || type === 'exit rotary') return RotateCcw
  if (modifier === 'uturn') return Undo2
  if (type === 'fork') return Split
  if (type === 'merge') return Merge
  switch (modifier) {
    case 'slight left':
      return ArrowUpLeft
    case 'slight right':
      return ArrowUpRight
    case 'left':
    case 'sharp left':
      return CornerUpLeft
    case 'right':
    case 'sharp right':
      return CornerUpRight
    default:
      return ArrowUp
  }
}

/** Consigne courte, sans le nom de rue (affiché en grand à côté) : « Tournez à gauche ». */
function getShortManeuver(step: RouteStep): string {
  return formatManeuver({ ...step, name: '' }).replace(/\.$/, '')
}

/** Distance en deux parties pour le bandeau : « 40 » en grand, « m » en petit. */
function formatDistanceParts(distance: number): { value: string; unit: string } {
  if (distance < 1000) {
    // Arrondi au pas de 10 m au-delà de 100 m (comme les GPS) : moins de chiffres qui défilent.
    const rounded = distance < 100 ? Math.round(distance) : Math.round(distance / 10) * 10
    return { value: String(rounded), unit: 'm' }
  }
  return {
    value: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: distance < 10_000 ? 1 : 0 }).format(distance / 1000),
    unit: 'km',
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
