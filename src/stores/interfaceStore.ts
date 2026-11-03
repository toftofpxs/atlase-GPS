import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Destination, RouteMode, RouteSummary, TollPreference } from '../types/geocoding'
import type { CurrentPosition, SidebarSection } from '../types/navigation'

interface InterfaceState {
  activeSection: SidebarSection
  settingsOpen: boolean
  mobileNavOpen: boolean
  searchTarget: 'origin' | 'destination' | 'stop'
  searchStopIndex: number
  searchRequest: number
  origin: Destination | null
  waypoints: Destination[]
  destination: Destination | null
  favorites: Destination[]
  routeMode: RouteMode
  tollPreference: TollPreference
  route: RouteSummary | null
  routeOptions: RouteSummary[]
  selectedRouteIndex: number
  routeLoading: boolean
  routeError: string | null
  routeRequestId: number
  navigationActive: boolean
  currentPosition: CurrentPosition | null
  navigationStepIndex: number
  navigationError: string | null
  selectSection: (section: SidebarSection) => void
  toggleSettings: () => void
  toggleMobileNav: () => void
  openSearch: (target: 'origin' | 'destination' | 'stop', stopIndex?: number) => void
  setOrigin: (origin: Destination | null) => void
  setWaypoint: (stopIndex: number, waypoint: Destination | null) => void
  removeWaypoint: (stopIndex: number) => void
  setDestination: (destination: Destination | null) => void
  toggleFavorite: (place: Destination) => void
  removeFavorite: (id: string) => void
  setRouteMode: (mode: RouteMode) => void
  setTollPreference: (preference: TollPreference) => void
  selectRouteOption: (index: number) => void
  beginRouteCalculation: () => number
  completeRouteCalculation: (requestId: number, routes: RouteSummary[]) => void
  failRouteCalculation: (requestId: number, error: string) => void
  startNavigation: () => void
  stopNavigation: () => void
  setCurrentPosition: (position: CurrentPosition | null) => void
  setNavigationStepIndex: (stepIndex: number) => void
  setNavigationError: (error: string | null) => void
}

export const useInterfaceStore = create<InterfaceState>()(persist((set) => ({
  activeSection: 'route',
  settingsOpen: false,
  mobileNavOpen: false,
  searchTarget: 'destination',
  searchStopIndex: 0,
  searchRequest: 0,
  origin: null,
  waypoints: [],
  destination: null,
  favorites: [],
  routeMode: 'driving',
  tollPreference: 'with-tolls',
  route: null,
  routeOptions: [],
  selectedRouteIndex: 0,
  routeLoading: false,
  routeError: null,
  routeRequestId: 0,
  navigationActive: false,
  currentPosition: null,
  navigationStepIndex: 0,
  navigationError: null,
  selectSection: (activeSection) => set({ activeSection, settingsOpen: false, mobileNavOpen: false }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen, mobileNavOpen: false })),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  openSearch: (searchTarget, searchStopIndex = 0) =>
    set((state) => ({
      searchTarget,
      searchStopIndex,
      searchRequest: state.searchRequest + 1,
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
      currentPosition: null,
      navigationStepIndex: 0,
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
      currentPosition: null,
      navigationStepIndex: 0,
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
      currentPosition: null,
      navigationStepIndex: 0,
      navigationError: null,
    })),
  setDestination: (destination) =>
    set((state) => ({
      destination,
      route: null,
      routeOptions: [],
      selectedRouteIndex: 0,
      routeLoading: false,
      routeError: null,
      routeRequestId: state.routeRequestId + 1,
      navigationActive: false,
      currentPosition: null,
      navigationStepIndex: 0,
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
            currentPosition: null,
            navigationStepIndex: 0,
            navigationError: null,
          },
    ),
  setTollPreference: (tollPreference) => set({ tollPreference }),
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
        currentPosition: null,
        navigationStepIndex: 0,
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
  startNavigation: () =>
    set({ navigationActive: true, currentPosition: null, navigationStepIndex: 0, navigationError: null }),
  stopNavigation: () =>
    set({ navigationActive: false, currentPosition: null, navigationStepIndex: 0, navigationError: null }),
  setCurrentPosition: (currentPosition) => set({ currentPosition }),
  selectRouteOption: (selectedRouteIndex) =>
    set((state) => {
      const route = state.routeOptions[selectedRouteIndex]
      return route
        ? {
            route,
            selectedRouteIndex,
            navigationActive: false,
            currentPosition: null,
            navigationStepIndex: 0,
            navigationError: null,
          }
        : state
    }),
  setNavigationStepIndex: (navigationStepIndex) => set({ navigationStepIndex }),
  setNavigationError: (navigationError) => set({ navigationError }),
}), {
  name: 'atlas-favorites',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ favorites: state.favorites }),
}))
