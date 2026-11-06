import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Destination, RouteMode, RouteSummary, TollPreference } from '../types/geocoding'
import type { CurrentPosition, SidebarSection } from '../types/navigation'
import type { NavigationGuidance } from '../services/navigation'
import { clearActiveTrip, saveActiveTrip, type ActiveTrip } from '../services/activeTrip'

export type MovementIcon = 'dot' | 'arrow' | 'car'
export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemeMode, 'auto'>
export type FavoriteShortcut = 'home' | 'work' | 'school'
/** Emplacement de la voiture garée (mémorisé dans le navigateur). */
export interface ParkedCar {
  coordinates: [longitude: number, latitude: number]
  /** Précision GPS au moment de l'enregistrement, en mètres. */
  accuracy: number | null
  /** Date d'enregistrement (ms depuis 1970). */
  savedAt: number
  /** Adresse approximative (géocodage inverse), si disponible. */
  address: string | null
}
/** Trajet récent (enregistré au démarrage d'une navigation). */
export interface RecentTrip {
  id: string
  /** Départ ; null = « Ma position » (relocalisé au moment de relancer le trajet). */
  origin: Destination | null
  destination: Destination
  waypoints: Destination[]
  routeMode: RouteMode
  tollPreference: TollPreference
  /** Dernier démarrage (ms depuis 1970). */
  startedAt: number
  /** Nombre de fois où ce trajet a été lancé. */
  count: number
}

/** Nombre maximal de trajets récents gardés. */
const MAX_RECENT_TRIPS = 12
/** Identifiants des départs « position GPS » : ils ne sont pas mémorisés tels quels. */
/** Destination créée par « Aller à ma voiture » (voir ParkedCar). */
export const PARKED_CAR_DESTINATION_ID = 'parked-car'
const CURRENT_POSITION_IDS = new Set(['browser-current-location', 'reroute-origin', 'current-position'])

/** Clé d'un trajet : même départ, même destination, même mode = même trajet récent. */
function getRecentTripKey(origin: Destination | null, destination: Destination, routeMode: RouteMode): string {
  const place = (value: Destination | null) =>
    value ? `${value.coordinates[0].toFixed(4)},${value.coordinates[1].toFixed(4)}` : 'ma-position'
  return `${place(origin)}>${place(destination)}>${routeMode}`
}

export type FavoritePlace = Destination & { shortcut?: FavoriteShortcut }

interface InterfaceState {
  activeSection: SidebarSection
  settingsOpen: boolean
  mobileNavOpen: boolean
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  searchTarget: 'origin' | 'destination' | 'stop' | 'favorite'
  searchStopIndex: number
  searchRequest: number
  favoriteDraft: Destination | null
  origin: Destination | null
  waypoints: Destination[]
  destination: Destination | null
  favorites: FavoritePlace[]
  routeMode: RouteMode
  tollPreference: TollPreference
  movementIcon: MovementIcon
  /** Vibrations (boutons, approche d'une manœuvre). Ignoré par les iPhone. */
  hapticsEnabled: boolean
  /** Préchargement de la carte le long du trajet (tunnels, zones sans réseau). */
  offlineMapEnabled: boolean
  route: RouteSummary | null
  routeOptions: RouteSummary[]
  selectedRouteIndex: number
  routeLoading: boolean
  routeError: string | null
  routeRequestId: number
  navigationActive: boolean
  /** Conduite sans itinéraire : vitesse et limitation affichées, carte qui suit. */
  freeDriveActive: boolean
  parkedCar: ParkedCar | null
  recentTrips: RecentTrip[]
  currentPosition: CurrentPosition | null
  /** Position sur le trajet, calculée une seule fois par position GPS. */
  navigationGuidance: NavigationGuidance | null
  navigationStepIndex: number
  /** Recalcul automatique en cours après une sortie d'itinéraire. */
  navigationRerouting: boolean
  navigationError: string | null
  selectSection: (section: SidebarSection) => void
  toggleSettings: () => void
  toggleMobileNav: () => void
  setThemeMode: (themeMode: ThemeMode) => void
  setResolvedTheme: (resolvedTheme: ResolvedTheme) => void
  openSearch: (target: 'origin' | 'destination' | 'stop' | 'favorite', stopIndex?: number) => void
  setFavoriteDraft: (place: Destination | null) => void
  setOrigin: (origin: Destination | null) => void
  setWaypoint: (stopIndex: number, waypoint: Destination | null) => void
  removeWaypoint: (stopIndex: number) => void
  setDestination: (destination: Destination | null) => void
  toggleFavorite: (place: Destination) => void
  removeFavorite: (id: string) => void
  setFavoriteShortcut: (id: string, shortcut: FavoriteShortcut | null) => void
  setRouteMode: (mode: RouteMode) => void
  setTollPreference: (preference: TollPreference) => void
  setMovementIcon: (icon: MovementIcon) => void
  setHapticsEnabled: (enabled: boolean) => void
  setOfflineMapEnabled: (enabled: boolean) => void
  selectRouteOption: (index: number) => void
  beginRouteCalculation: () => number
  completeRouteCalculation: (requestId: number, routes: RouteSummary[]) => void
  failRouteCalculation: (requestId: number, error: string) => void
  startNavigation: () => void
  stopNavigation: () => void
  /** Reprend un trajet sauvegardé (appli fermée ou rechargée en pleine navigation). */
  resumeTrip: (trip: ActiveTrip) => void
  /** Ajoute un arrêt en cours de navigation : nouvelles étapes et nouveau trajet. */
  applyDetour: (waypoints: Destination[], route: RouteSummary) => void
  startFreeDrive: () => void
  stopFreeDrive: () => void
  setParkedCar: (parkedCar: ParkedCar | null) => void
  removeRecentTrip: (id: string) => void
  clearRecentTrips: () => void
  /** Reprend un trajet récent (le calcul d'itinéraire se lance ensuite tout seul). */
  restoreRecentTrip: (trip: RecentTrip, origin: Destination | null) => void
  setCurrentPosition: (position: CurrentPosition | null) => void
  updateNavigationPosition: (position: CurrentPosition, guidance: NavigationGuidance) => void
  setNavigationRerouting: (rerouting: boolean) => void
  /** Remplace le trajet en gardant la navigation active (recalcul après sortie d'itinéraire). */
  applyReroute: (route: RouteSummary) => void
  setNavigationStepIndex: (stepIndex: number) => void
  setNavigationError: (error: string | null) => void
}

/** Sauvegarde du trajet en cours (pour la reprise), à partir de l'état du store. */
function persistTrip(state: InterfaceState): void {
  if (!state.navigationActive || !state.route || !state.destination) return
  saveActiveTrip({
    origin: state.origin,
    destination: state.destination,
    waypoints: state.waypoints,
    routeMode: state.routeMode,
    tollPreference: state.tollPreference,
    route: state.route,
  })
}

export const useInterfaceStore = create<InterfaceState>()(persist((set, get) => ({
  activeSection: 'route',
  settingsOpen: false,
  mobileNavOpen: false,
  themeMode: 'auto',
  resolvedTheme:
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  searchTarget: 'destination',
  searchStopIndex: 0,
  searchRequest: 0,
  favoriteDraft: null,
  origin: null,
  waypoints: [],
  destination: null,
  favorites: [],
  routeMode: 'driving',
  tollPreference: 'with-tolls',
  movementIcon: 'arrow',
  hapticsEnabled: true,
  offlineMapEnabled: true,
  route: null,
  routeOptions: [],
  selectedRouteIndex: 0,
  routeLoading: false,
  routeError: null,
  routeRequestId: 0,
  navigationActive: false,
  freeDriveActive: false,
  parkedCar: null,
  recentTrips: [],
  currentPosition: null, navigationGuidance: null,
  navigationStepIndex: 0, navigationRerouting: false,
  navigationError: null,
  selectSection: (activeSection) => set({ activeSection, settingsOpen: false, mobileNavOpen: false }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen, mobileNavOpen: false })),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  setThemeMode: (themeMode) => set({ themeMode }),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  openSearch: (searchTarget, searchStopIndex = 0) =>
    set((state) => ({
      searchTarget,
      searchStopIndex,
      searchRequest: state.searchRequest + 1,
    })),
  setFavoriteDraft: (favoriteDraft) =>
    set((state) => ({
      favoriteDraft,
      searchTarget: state.searchTarget === 'favorite' ? 'destination' : state.searchTarget,
    })),
  setOrigin: (origin) =>
    set((state) => ({
      origin,
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      navigationActive: false,
      currentPosition: null, navigationGuidance: null,
      navigationStepIndex: 0, navigationRerouting: false,
      navigationError: null,
    })),
  setWaypoint: (stopIndex, waypoint) =>
    set((state) => ({
      waypoints: waypoint
        ? stopIndex === state.waypoints.length
          ? [...state.waypoints, waypoint]
          : state.waypoints.map((stop, index) => (index === stopIndex ? waypoint : stop))
        : state.waypoints.filter((_, index) => index !== stopIndex),
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      navigationActive: false,
      currentPosition: null, navigationGuidance: null,
      navigationStepIndex: 0, navigationRerouting: false,
      navigationError: null,
    })),
  removeWaypoint: (stopIndex) =>
    set((state) => ({
      waypoints: state.waypoints.filter((_, index) => index !== stopIndex),
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      navigationActive: false,
      currentPosition: null, navigationGuidance: null,
      navigationStepIndex: 0, navigationRerouting: false,
      navigationError: null,
    })),
  setDestination: (destination) =>
    set((state) => ({
      destination,
      // « Aller à ma voiture » passe en mode piéton : pour la destination suivante, on repasse
      // en voiture (sinon le trajet ignore les sens interdits, comme pour un piéton).
      routeMode:
        state.destination?.id === PARKED_CAR_DESTINATION_ID &&
        destination?.id !== PARKED_CAR_DESTINATION_ID &&
        state.routeMode === 'walking'
          ? 'driving'
          : state.routeMode,
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      navigationActive: false,
      currentPosition: null, navigationGuidance: null,
      navigationStepIndex: 0, navigationRerouting: false,
      navigationError: null,
    })),
  toggleFavorite: (place) =>
    set((state) => ({
      favorites: state.favorites.some((favorite) => favorite.id === place.id)
        ? state.favorites.filter((favorite) => favorite.id !== place.id)
        : [...state.favorites, place],
    })),
  removeFavorite: (id) =>
    set((state) => ({ favorites: state.favorites.filter((favorite) => favorite.id !== id) })),
  setFavoriteShortcut: (id, shortcut) =>
    set((state) => ({
      favorites: state.favorites.map((favorite) =>
        favorite.id === id
          ? { ...favorite, shortcut: shortcut ?? undefined }
          : shortcut && favorite.shortcut === shortcut
            ? { ...favorite, shortcut: undefined }
            : favorite,
      ),
    })),
  setRouteMode: (routeMode) =>
    set((state) =>
      state.routeMode === routeMode
        ? state
        : {
            routeMode,
            route: null,
            routeOptions: [],
            selectedRouteIndex: 0,
            routeLoading: false,
            routeError: null,
            routeRequestId: state.routeRequestId + 1,
            navigationActive: false,
            currentPosition: null, navigationGuidance: null,
            navigationStepIndex: 0, navigationRerouting: false,
            navigationError: null,
          },
    ),
  setTollPreference: (tollPreference) => set({ tollPreference }),
  setMovementIcon: (movementIcon) => set({ movementIcon }),
  setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
  setOfflineMapEnabled: (offlineMapEnabled) => set({ offlineMapEnabled }),
  beginRouteCalculation: () => {
    let requestId = 0
    set((state) => {
      requestId = state.routeRequestId + 1
      return {
        routeRequestId: requestId,
        route: null,
        routeOptions: [],
        selectedRouteIndex: 0,
        routeLoading: true,
        routeError: null,
        navigationActive: false,
        currentPosition: null, navigationGuidance: null,
        navigationStepIndex: 0, navigationRerouting: false,
        navigationError: null,
      }
    })
    return requestId
  },
  completeRouteCalculation: (requestId, routeOptions) =>
    set((state) =>
      state.routeRequestId === requestId
        ? {
            route: routeOptions[0] ?? null,
            routeOptions,
            selectedRouteIndex: 0,
            routeLoading: false,
            routeError: null,
          }
        : state,
    ),
  failRouteCalculation: (requestId, routeError) =>
    set((state) =>
      state.routeRequestId === requestId
        ? { route: null, routeLoading: false, routeError }
        : state,
    ),
  startNavigation: () => {
    set((state) => ({
      navigationActive: true, freeDriveActive: false, currentPosition: null, navigationGuidance: null, navigationStepIndex: 0, navigationRerouting: false, navigationError: null,
      recentTrips: state.destination ? addRecentTrip(state) : state.recentTrips,
    }))
    persistTrip(get())
  },
  stopNavigation: () => {
    clearActiveTrip()
    set({ navigationActive: false, currentPosition: null, navigationGuidance: null, navigationStepIndex: 0, navigationRerouting: false, navigationError: null })
  },
  resumeTrip: (trip) => {
    set((state) => ({
      origin: trip.origin,
      destination: trip.destination,
      waypoints: trip.waypoints,
      routeMode: trip.routeMode,
      tollPreference: trip.tollPreference,
      route: trip.route,
      routeOptions: [trip.route],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      activeSection: 'route',
      settingsOpen: false,
      navigationActive: true,
      freeDriveActive: false,
      currentPosition: null, navigationGuidance: null,
      navigationStepIndex: 0, navigationRerouting: false,
      navigationError: null,
    }))
    persistTrip(get())
  },
  applyDetour: (waypoints, route) => {
    set({
      waypoints,
      route,
      routeOptions: [route],
      selectedRouteIndex: 0,
      navigationGuidance: null,
      navigationStepIndex: 0,
      navigationRerouting: false,
      navigationError: null,
    })
    persistTrip(get())
  },
  startFreeDrive: () =>
    set({ freeDriveActive: true, navigationActive: false, currentPosition: null, navigationGuidance: null, navigationError: null }),
  stopFreeDrive: () => set({ freeDriveActive: false, currentPosition: null }),
  setParkedCar: (parkedCar) => set({ parkedCar }),
  removeRecentTrip: (id) => set((state) => ({ recentTrips: state.recentTrips.filter((trip) => trip.id !== id) })),
  clearRecentTrips: () => set({ recentTrips: [] }),
  restoreRecentTrip: (trip, origin) =>
    set((state) => ({
      origin,
      destination: trip.destination,
      waypoints: trip.waypoints,
      routeMode: trip.routeMode,
      tollPreference: trip.tollPreference,
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      activeSection: 'route',
      settingsOpen: false,
      mobileNavOpen: false,
    })),
  setCurrentPosition: (currentPosition) => set({ currentPosition }),
  setNavigationRerouting: (navigationRerouting) => set({ navigationRerouting }),
  applyReroute: (route) => {
    set({
      route,
      routeOptions: [route],
      selectedRouteIndex: 0,
      navigationGuidance: null,
      navigationStepIndex: 0,
      navigationRerouting: false,
      navigationError: null,
    })
    persistTrip(get())
  },
  updateNavigationPosition: (currentPosition, navigationGuidance) =>
    set({
      currentPosition,
      navigationGuidance,
      navigationStepIndex: navigationGuidance.stepIndex,
      navigationError: null,
    }),
  selectRouteOption: (selectedRouteIndex) =>
    set((state) => {
      const route = state.routeOptions[selectedRouteIndex]
      return route
        ? {
            route,
            selectedRouteIndex,
            navigationActive: false,
            currentPosition: null, navigationGuidance: null,
            navigationStepIndex: 0, navigationRerouting: false,
            navigationError: null,
          }
        : state
    }),
  setNavigationStepIndex: (navigationStepIndex) => set({ navigationStepIndex }),
  setNavigationError: (navigationError) => set({ navigationError }),
}), {
  name: 'atlas-favorites',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    favorites: state.favorites,
    parkedCar: state.parkedCar,
    recentTrips: state.recentTrips,
    movementIcon: state.movementIcon,
    hapticsEnabled: state.hapticsEnabled,
    offlineMapEnabled: state.offlineMapEnabled,
    themeMode: state.themeMode,
  }),
}))

/** Liste des trajets récents après le démarrage du trajet en cours (sans doublon, le plus récent en tête). */
function addRecentTrip(state: InterfaceState): RecentTrip[] {
  const destination = state.destination
  if (!destination) return state.recentTrips
  const origin = state.origin && !CURRENT_POSITION_IDS.has(state.origin.id) ? state.origin : null
  const id = getRecentTripKey(origin, destination, state.routeMode)
  const previous = state.recentTrips.find((trip) => trip.id === id)
  const trip: RecentTrip = {
    id,
    origin,
    destination,
    waypoints: state.waypoints,
    routeMode: state.routeMode,
    tollPreference: state.tollPreference,
    startedAt: Date.now(),
    count: (previous?.count ?? 0) + 1,
  }
  return [trip, ...state.recentTrips.filter((entry) => entry.id !== id)].slice(0, MAX_RECENT_TRIPS)
}
