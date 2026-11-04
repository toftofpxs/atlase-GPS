import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Destination, RouteMode, RouteSummary, TollPreference } from '../types/geocoding'
import type { CurrentPosition, SidebarSection } from '../types/navigation'

export type MovementIcon = 'dot' | 'arrow' | 'car'
export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemeMode, 'auto'>
export type FavoriteShortcut = 'home' | 'work' | 'school'
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
            currentPosition: null,
            navigationStepIndex: 0,
            navigationError: null,
          },
    ),
  setTollPreference: (tollPreference) => set({ tollPreference }),
  setMovementIcon: (movementIcon) => set({ movementIcon }),
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
  partialize: (state) => ({
    favorites: state.favorites,
    movementIcon: state.movementIcon,
    themeMode: state.themeMode,
  }),
}))
