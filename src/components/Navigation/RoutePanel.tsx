import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  Bookmark,
  BookmarkCheck,
  Bike,
  Car,
  CarFront,
  Circle,
  CornerDownRight,
  Footprints,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Monitor,
  Moon,
  Navigation2,
  Plus,
  Route as RouteIcon,
  Search,
  Sun,
  Trash2,
  Train,
  X,
} from 'lucide-react'
import { getCurrentLocation, getLocationErrorMessage, watchCurrentLocation } from '../../services/location'
import { getNavigationGuidance } from '../../services/navigation'
import {
  calculateRoute,
  getRouteModeLabel,
  getRouteProviderLabel,
  getRoutingErrorMessage,
} from '../../services/routing'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { MovementIcon, ThemeMode } from '../../stores/interfaceStore'
import type { RouteMode, TollPreference } from '../../types/geocoding'
import type { SidebarSection } from '../../types/navigation'

interface RoutePanelProps {
  section: SidebarSection
  settingsOpen: boolean
}

const recentSectionContent = {
  title: 'Aucun trajet récent',
  description: 'Vos dernières destinations seront regroupées ici.',
}

export function RoutePanel({ section, settingsOpen }: RoutePanelProps) {
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [locationDialogOpen, setLocationDialogOpen] = useState(false)
  const [locationDialogClosing, setLocationDialogClosing] = useState(false)
  const [departureDate, setDepartureDate] = useState(getCurrentDateValue)
  const [departureTime, setDepartureTime] = useState(getCurrentTimeValue)
  const origin = useInterfaceStore((state) => state.origin)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const destination = useInterfaceStore((state) => state.destination)
  const favorites = useInterfaceStore((state) => state.favorites)
  const routeMode = useInterfaceStore((state) => state.routeMode)
  const tollPreference = useInterfaceStore((state) => state.tollPreference)
  const movementIcon = useInterfaceStore((state) => state.movementIcon)
  const setMovementIcon = useInterfaceStore((state) => state.setMovementIcon)
  const themeMode = useInterfaceStore((state) => state.themeMode)
  const setThemeMode = useInterfaceStore((state) => state.setThemeMode)
  const route = useInterfaceStore((state) => state.route)
  const routeOptions = useInterfaceStore((state) => state.routeOptions)
  const selectedRouteIndex = useInterfaceStore((state) => state.selectedRouteIndex)
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const routeLoading = useInterfaceStore((state) => state.routeLoading)
  const routeError = useInterfaceStore((state) => state.routeError)
  const beginRouteCalculation = useInterfaceStore((state) => state.beginRouteCalculation)
  const completeRouteCalculation = useInterfaceStore((state) => state.completeRouteCalculation)
  const failRouteCalculation = useInterfaceStore((state) => state.failRouteCalculation)
  const openSearch = useInterfaceStore((state) => state.openSearch)
  const setOrigin = useInterfaceStore((state) => state.setOrigin)
  const removeWaypoint = useInterfaceStore((state) => state.removeWaypoint)
  const setDestination = useInterfaceStore((state) => state.setDestination)
  const startNavigation = useInterfaceStore((state) => state.startNavigation)
  const stopNavigation = useInterfaceStore((state) => state.stopNavigation)
  const setCurrentPosition = useInterfaceStore((state) => state.setCurrentPosition)
  const setNavigationError = useInterfaceStore((state) => state.setNavigationError)
  const setNavigationStepIndex = useInterfaceStore((state) => state.setNavigationStepIndex)
  const toggleFavorite = useInterfaceStore((state) => state.toggleFavorite)
  const removeFavorite = useInterfaceStore((state) => state.removeFavorite)
  const setRouteMode = useInterfaceStore((state) => state.setRouteMode)
  const setTollPreference = useInterfaceStore((state) => state.setTollPreference)
  const selectRouteOption = useInterfaceStore((state) => state.selectRouteOption)
  const selectSection = useInterfaceStore((state) => state.selectSection)
  const isDestinationFavorite = destination
    ? favorites.some((favorite) => favorite.id === destination.id)
    : false

  useEffect(() => {
    if (!navigationActive || !route) return
    if (!window.isSecureContext) {
      setNavigationError(getLocationErrorMessage(new Error('secure-context-required')))
      stopNavigation()
      return
    }
    if (!navigator.geolocation) {
      setNavigationError(getLocationErrorMessage(new Error('unsupported')))
      stopNavigation()
      return
    }

    setNavigationError(null)
    setNavigationStepIndex(0)
    let stepIndex = 0
    const watchId = watchCurrentLocation(
      (position) => {
        setCurrentPosition(position)
        setNavigationError(null)
        const guidance = getNavigationGuidance(route, position.coordinates, stepIndex)
        stepIndex = guidance.stepIndex
        setNavigationStepIndex(guidance.stepIndex)
      },
      (error) => {
        setNavigationError(
          getLocationErrorMessage(
            new Error(error.code === error.PERMISSION_DENIED ? 'permission-denied' : 'unavailable'),
          ),
        )
      },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [navigationActive, route, setCurrentPosition, setNavigationError, setNavigationStepIndex, stopNavigation])

  const handleUseCurrentLocation = async () => {
    setLocationDialogClosing(true)
    setLocationError('')
    setLocating(true)
    try {
      setOrigin(await getCurrentLocation())
    } catch (error) {
      setLocationError(getLocationErrorMessage(error))
    } finally {
      setLocating(false)
    }
  }

  const openLocationDialog = () => {
    setLocationDialogClosing(false)
    setLocationDialogOpen(true)
  }

  const finishClosingLocationDialog = () => {
    setLocationDialogOpen(false)
    setLocationDialogClosing(false)
  }

  const handleCalculateRoute = async (preference = tollPreference) => {
    if (!origin || !destination || routeLoading) return

    const requestId = beginRouteCalculation()
    try {
      const result = await calculateRoute(origin, destination, routeMode, waypoints, preference)
      completeRouteCalculation(requestId, result)
    } catch (error) {
      failRouteCalculation(requestId, getRoutingErrorMessage(error, routeMode))
    }
  }

  const handleTollPreference = (preference: TollPreference) => {
    if (preference === tollPreference || routeLoading) return
    const hasRoute = Boolean(route)
    setTollPreference(preference)
    if (hasRoute) void handleCalculateRoute(preference)
  }

  if (settingsOpen) {
    return (
      <section className="side-panel" aria-labelledby="panel-title">
        <PanelHeading eyebrow="Préférences" title="Paramètres" />
        <div className="settings-card">
          <div>
            <p className="settings-title">Apparence</p>
            <p className="settings-description">Le mode Auto suit le thème de votre appareil.</p>
          </div>
          <div className="theme-mode-options" role="group" aria-label="Thème de l’application">
            {([
              { value: 'auto', label: 'Auto', Icon: Monitor },
              { value: 'light', label: 'Clair', Icon: Sun },
              { value: 'dark', label: 'Sombre', Icon: Moon },
            ] satisfies { value: ThemeMode; label: string; Icon: typeof Monitor }[]).map(
              ({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-mode-option ${themeMode === value ? 'theme-mode-option-selected' : ''}`}
                  aria-pressed={themeMode === value}
                  onClick={() => setThemeMode(value)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <p className="settings-title">Icône de déplacement</p>
              <p className="settings-description">Choisissez l’icône affichée sur la carte.</p>
            </div>
          </div>
          <div className="movement-icon-options" role="group" aria-label="Icône de déplacement">
            {([
              { value: 'dot', label: 'Point' },
              { value: 'arrow', label: 'Flèche' },
              { value: 'car', label: 'Voiture 3D' },
            ] satisfies { value: MovementIcon; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`movement-icon-option ${movementIcon === value ? 'movement-icon-option-selected' : ''}`}
                aria-pressed={movementIcon === value}
                onClick={() => setMovementIcon(value)}
              >
                <span className={`movement-icon-preview movement-icon-preview-${value}`} aria-hidden="true">
                  {value === 'dot' ? <Circle size={22} fill="currentColor" /> : null}
                  {value === 'arrow' ? <Navigation2 size={24} fill="currentColor" /> : null}
                  {value === 'car' ? <CarFront size={25} fill="currentColor" /> : null}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (section === 'favorites') {
    return (
      <section className="side-panel" aria-labelledby="panel-title">
        <PanelHeading eyebrow="Enregistrés" title="Vos lieux préférés" />
        {favorites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><MapPin size={20} /></div>
            <p>Enregistrez vos destinations pour les retrouver ici.</p>
            <span className="empty-caption">Stockés uniquement sur cet appareil</span>
          </div>
        ) : (
          <ul className="favorite-list" aria-label="Destinations favorites">
            {favorites.map((favorite) => (
              <li className="favorite-item" key={favorite.id}>
                <button
                  type="button"
                  className="favorite-select"
                  onClick={() => {
                    setDestination(favorite)
                    selectSection('route')
                  }}
                  aria-label={`Utiliser ${favorite.name} comme destination`}
                >
                  <span className="favorite-icon"><MapPin size={16} /></span>
                  <span className="favorite-copy">
                    <span className="favorite-name">{favorite.name}</span>
                    {favorite.details && <span className="favorite-details">{favorite.details}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className="favorite-remove"
                  onClick={() => removeFavorite(favorite.id)}
                  aria-label={`Retirer ${favorite.name} des favoris`}
                  title="Retirer des favoris"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  if (section === 'recent') {
    return (
      <section className="side-panel" aria-labelledby="panel-title">
        <PanelHeading eyebrow="Votre activité" title={recentSectionContent.title} />
        <div className="empty-state">
          <div className="empty-icon"><Search size={20} /></div>
          <p>{recentSectionContent.description}</p>
          <span className="empty-caption">Aucune donnée pour le moment</span>
        </div>
      </section>
    )
  }

  return (
    <section className={`side-panel route-panel ${navigationActive ? 'route-panel-navigation' : ''}`} aria-labelledby="panel-title">
      <PanelHeading eyebrow="Votre prochain voyage" title="Planifier un trajet" />
      <div className="route-inputs">
        <div className="route-line" aria-hidden="true">
          <Circle size={11} className="origin-dot" />
          {waypoints.map((waypoint, index) => (
            <Fragment key={`${waypoint.id}-${index}`}>
              <span />
              <MapPin size={14} className="waypoint-pin" />
            </Fragment>
          ))}
          <span />
          <MapPin size={15} className="destination-pin" />
        </div>
        <div className="route-fields">
          <button
            type="button"
            className="route-field route-field-select"
            aria-label={origin ? `Modifier le départ : ${origin.name}` : 'Choisir un point de départ'}
            onClick={() => openSearch('origin')}
          >
            <span className="field-label">Départ</span>
            {origin ? (
              <>
                <span className="selected-destination-name">{origin.name}</span>
                {origin.details && <span className="selected-destination-details">{origin.details}</span>}
              </>
            ) : (
              <span className="field-placeholder">Choisir un point de départ</span>
            )}
          </button>
            {waypoints.map((waypoint, index) => (
              <Fragment key={`${waypoint.id}-${index}`}>
                <div className="field-separator" />
                <div className="route-waypoint-row">
                  <button
                    type="button"
                    className="route-field route-field-select route-waypoint-field"
                    aria-label={`Modifier l’étape ${index + 1} : ${waypoint.name}`}
                    onClick={() => openSearch('stop', index)}
                  >
                    <span className="field-label">Étape {index + 1}</span>
                    <span className="selected-destination-name">{waypoint.name}</span>
                    {waypoint.details && (
                      <span className="selected-destination-details">{waypoint.details}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="remove-waypoint"
                    aria-label={`Supprimer l’étape ${index + 1}`}
                    title="Supprimer l’étape"
                    onClick={() => removeWaypoint(index)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </Fragment>
            ))}
            <div className="field-separator" />
          <button
            type="button"
            className="route-field route-field-select"
            aria-label={destination ? `Modifier la destination : ${destination.name}` : 'Ajouter une destination'}
            onClick={() => openSearch('destination')}
          >
            <span className="field-label">Destination</span>
            {destination ? (
              <>
                <span className="selected-destination-name">{destination.name}</span>
                {destination.details && <span className="selected-destination-details">{destination.details}</span>}
              </>
            ) : (
              <span className="field-placeholder">Ajouter une destination</span>
            )}
          </button>
        </div>
        <button className="swap-button" type="button" disabled aria-label="Inverser le départ et l'arrivée">
          <ArrowDown size={15} />
        </button>
      </div>

      <div className="route-actions">
        <button
          type="button"
          className="location-button"
          onClick={openLocationDialog}
          disabled={locating}
        >
          {locating ? <LoaderCircle size={14} className="route-button-spinner" /> : <LocateFixed size={14} />}
          {locating ? 'Localisation…' : origin?.id === 'browser-current-location' ? 'Actualiser ma position' : 'Utiliser ma position'}
        </button>
        {destination && (
          <button
            type="button"
            className={`favorite-toggle ${isDestinationFavorite ? 'favorite-toggle-active' : ''}`}
            onClick={() => toggleFavorite(destination)}
            aria-pressed={isDestinationFavorite}
            aria-label={isDestinationFavorite ? 'Retirer des favoris' : 'Enregistrer la destination dans les favoris'}
          >
            {isDestinationFavorite ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            {isDestinationFavorite ? 'Enregistrée' : 'Enregistrer'}
          </button>
        )}
      </div>
      {locationError && <p className="location-error" role="alert">{locationError}</p>}
      {locationDialogOpen && createPortal(
        <div
          className={`location-dialog-backdrop${locationDialogClosing ? ' location-dialog-closing' : ''}`}
          onClick={event => {
            if (event.target === event.currentTarget) setLocationDialogClosing(true)
          }}
          onAnimationEnd={event => {
            if (
              event.target === event.currentTarget &&
              event.animationName === 'location-dialog-exit'
            ) {
              finishClosingLocationDialog()
            }
          }}
        >
          <section
            className="location-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-dialog-title"
            aria-describedby="location-dialog-description"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="location-dialog-icon" aria-hidden="true"><LocateFixed size={21} /></span>
            <h2 id="location-dialog-title">Autoriser votre position</h2>
            <p id="location-dialog-description">
              Votre position sert à définir le départ et à vous guider pendant le trajet. Vous pourrez autoriser l’accès dans la fenêtre du navigateur.
            </p>
            <div className="location-dialog-actions">
              <button type="button" className="location-dialog-cancel" onClick={() => setLocationDialogClosing(true)}>
                Plus tard
              </button>
              <button type="button" className="location-dialog-confirm" onClick={handleUseCurrentLocation}>
                Continuer
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <div className="departure-schedule">
        <span className="departure-schedule-label">Départ prévu</span>
        <div className="departure-schedule-fields">
          <label>
            <span className="sr-only">Jour de départ</span>
            <input
              type="date"
              value={departureDate}
              min={getCurrentDateValue()}
              onChange={(event) => setDepartureDate(event.target.value)}
              aria-label="Jour prévu de départ"
            />
          </label>
          <label>
            <span className="sr-only">Heure de départ</span>
            <input
              id="departure-time"
              type="time"
              value={departureTime}
              onChange={(event) => setDepartureTime(event.target.value)}
              aria-label="Heure prévue de départ"
            />
          </label>
        </div>
      </div>

      <button
        className="add-stop"
        type="button"
        onClick={() => openSearch('stop', waypoints.length)}
      >
        <Plus size={15} />
        Ajouter une étape
      </button>

      <div className="route-mode-selector" role="group" aria-label="Mode de déplacement">
        <RouteModeButton
          mode="driving"
          selectedMode={routeMode}
          label="Voiture"
          onSelect={setRouteMode}
          icon={<Car size={16} />}
        />
        <RouteModeButton
          mode="walking"
          selectedMode={routeMode}
          label="À pied"
          onSelect={setRouteMode}
          icon={<Footprints size={16} />}
        />
        <RouteModeButton
          mode="cycling"
          selectedMode={routeMode}
          label="Vélo"
          onSelect={setRouteMode}
          icon={<Bike size={16} />}
        />
        <button
          type="button"
          className="route-mode-button route-mode-unavailable"
          disabled
          title="Les transports en commun seront ajoutés ultérieurement."
          aria-label="Train et transports en commun, bientôt disponibles"
        >
          <Train size={16} />
          <span>Train</span>
          <small>Bientôt</small>
        </button>
      </div>

      {routeMode === 'driving' && (
        <div className="toll-options" role="group" aria-label="Préférence de péage">
          <span className="toll-options-title">Péages</span>
          <div className="toll-option-buttons">
            <button
              type="button"
              className={`toll-option ${tollPreference === 'with-tolls' ? 'toll-option-selected' : ''}`}
              onClick={() => handleTollPreference('with-tolls')}
              aria-pressed={tollPreference === 'with-tolls'}
              aria-describedby="toll-disclaimer"
              disabled={routeLoading}
            >
              Avec péages
              {route && tollPreference === 'with-tolls' && (
                <small>
                  {getTollEstimate(route.distance, origin, destination, waypoints) ?? 'Prix non estimé'}
                </small>
              )}
              {route && tollPreference === 'avoid-tolls' && <small>Estimation après sélection</small>}
            </button>
            <button
              type="button"
              className={`toll-option ${tollPreference === 'avoid-tolls' ? 'toll-option-selected' : ''}`}
              onClick={() => handleTollPreference('avoid-tolls')}
              aria-pressed={tollPreference === 'avoid-tolls'}
              aria-describedby="toll-disclaimer"
              disabled={routeLoading}
            >
              Éviter les péages
            </button>
          </div>
          <p className="toll-disclaimer" id="toll-disclaimer">
            {tollPreference === 'with-tolls'
              ? 'Estimation très indicative pour un trajet surtout autoroutier en France. Le tarif réel varie selon les tronçons.'
              : 'Les routes sans péage sont privilégiées, mais des péages peuvent rester inévitables.'}
          </p>
        </div>
      )}

      <div className="route-divider" />

      {route ? (
        <div className="route-summary" role="status" aria-live="polite">
          <div className="route-summary-heading">
            <span className="route-summary-icon"><RouteIcon size={17} /></span>
            <span>
              <strong>Itinéraire trouvé</strong>
              <small>{getRouteModeLabel(routeMode)} · {getRouteProviderLabel()}</small>
            </span>
          </div>
          <div className="route-metrics">
            <div>
              <span>Distance</span>
              <strong>{formatDistance(route.distance)}</strong>
            </div>
            <div>
              <span>Durée estimée</span>
              <strong>{formatDuration(route.duration)}</strong>
            </div>
          </div>
          <div className="route-arrival">
            <span>Arrivée approximative</span>
            <strong>{formatScheduledArrival(departureDate, departureTime, route.duration)}</strong>
          </div>
          {routeOptions.length > 1 && (
            <div className="route-choices" role="group" aria-label="Choisir un itinéraire">
              <span className="route-choices-title">Autres itinéraires</span>
              {routeOptions.map((option, index) => (
                <button
                  type="button"
                  key={`${option.distance}-${option.duration}-${index}`}
                  className={`route-choice ${selectedRouteIndex === index ? 'route-choice-selected' : ''}`}
                  onClick={() => selectRouteOption(index)}
                  aria-pressed={selectedRouteIndex === index}
                  aria-label={`${index === 0 ? 'Itinéraire principal' : `Itinéraire alternatif ${index}`}, ${formatDuration(option.duration)}, ${formatDistance(option.distance)}`}
                >
                  <span className={`route-choice-marker ${selectedRouteIndex === index ? 'route-choice-marker-selected' : ''}`}>
                    {index + 1}
                  </span>
                  <span className="route-choice-copy">
                    <strong>{index === 0 ? 'Itinéraire principal' : `Alternative ${index}`}</strong>
                    <small>{formatDistance(option.distance)}</small>
                  </span>
                  <strong className="route-choice-duration">{formatDuration(option.duration)}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`route-empty ${routeLoading ? 'route-empty-loading' : ''} ${routeError ? 'route-empty-error' : ''}`}
          role={routeError ? 'alert' : undefined}
        >
          <div className="route-empty-art" aria-hidden="true">
            <div className="route-art-ring ring-one" />
            <div className="route-art-ring ring-two" />
            {routeLoading ? <LoaderCircle size={20} className="route-loading-icon" /> : <CornerDownRight size={20} />}
          </div>
          <h3>
            {routeLoading
              ? 'Calcul de l’itinéraire…'
              : routeError
                ? 'Itinéraire indisponible'
                : origin && destination
                  ? `Prêt à partir ${getRouteModeLabel(routeMode).toLocaleLowerCase('fr-FR')} ?`
                  : origin
                    ? 'Point de départ sélectionné'
                    : destination
                      ? 'Destination sélectionnée'
                      : 'Votre itinéraire commence ici'}
          </h3>
          <p>
            {routeLoading
              ? `Recherche du meilleur trajet ${getRouteModeLabel(routeMode).toLocaleLowerCase('fr-FR')}.`
              : routeError
                ? routeError
                : origin && destination
                  ? `Calculez un itinéraire ${getRouteModeLabel(routeMode).toLocaleLowerCase('fr-FR')} entre ces deux lieux.`
                  : origin
                    ? 'Choisissez une destination pour compléter votre trajet.'
                    : destination
                      ? 'Choisissez un point de départ pour compléter votre trajet.'
                      : 'Choisissez un point de départ et une destination pour préparer votre trajet.'}
          </p>
        </div>
      )}

      {route && !navigationActive && (
        <button
          className="primary-button navigation-start"
          type="button"
          disabled={route.steps.length === 0}
          onClick={() => {
            setNavigationError(null)
            startNavigation()
          }}
        >
          <Navigation2 size={16} />
          Démarrer la navigation
        </button>
      )}

      {!navigationActive && (
        <>
          <button
            className="primary-button"
            type="button"
            disabled={!origin || !destination || routeLoading}
            onClick={() => void handleCalculateRoute()}
          >
            {routeLoading ? <LoaderCircle size={16} className="route-button-spinner" /> : <Search size={16} />}
            {routeLoading ? 'Calcul en cours…' : route ? 'Recalculer l’itinéraire' : 'Calculer l’itinéraire'}
          </button>
          <p className="panel-footnote">
            {route
              ? `Itinéraire ${getRouteModeLabel(routeMode).toLocaleLowerCase('fr-FR')} calculé via ${getRouteProviderLabel()}.`
              : `Calcul ${getRouteModeLabel(routeMode).toLocaleLowerCase('fr-FR')} via Valhalla.`}
          </p>
        </>
      )}
    </section>
  )
}

interface RouteModeButtonProps {
  mode: RouteMode
  selectedMode: RouteMode
  label: string
  icon: ReactNode
  onSelect: (mode: RouteMode) => void
}

function RouteModeButton({
  mode,
  selectedMode,
  label,
  icon,
  onSelect,
}: RouteModeButtonProps) {
  return (
    <button
      type="button"
      className={`route-mode-button ${selectedMode === mode ? 'route-mode-selected' : ''}`}
      onClick={() => onSelect(mode)}
      aria-pressed={selectedMode === mode}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function formatDistance(distance: number): string {
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(distance / 1000)} km`
}

function formatDuration(duration: number): string {
  const minutes = Math.round(duration / 60)
  if (minutes < 1) return 'Moins d’1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`
}

function getCurrentTimeValue(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function getCurrentDateValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function getScheduledDepartureDate(date: string, time: string): Date | null {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  if (![year, month, day, hours, minutes].every(Number.isInteger)) return null
  const departure = new Date(year, month - 1, day, hours, minutes)
  return departure.getFullYear() === year &&
    departure.getMonth() === month - 1 &&
    departure.getDate() === day
    ? departure
    : null
}

function formatScheduledArrival(departureDate: string, departureTime: string, duration: number): string {
  const departure = getScheduledDepartureDate(departureDate, departureTime)
  if (!departure) return '—'
  const arrival = new Date(departure.getTime() + duration * 1000)
  const now = new Date()
  const arrivalDay = new Date(arrival.getFullYear(), arrival.getMonth(), arrival.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayOffset = Math.round((arrivalDay - today) / 86_400_000)
  const dayLabel = dayOffset === 0
    ? 'Aujourd’hui'
    : dayOffset === 1
      ? 'Demain'
      : arrival.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  const timeLabel = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(arrival)
  return `${dayLabel} · ${timeLabel}`
}

function getTollEstimate(
  distance: number,
  origin: { coordinates: [number, number] } | null,
  destination: { coordinates: [number, number] } | null,
  waypoints: { coordinates: [number, number] }[],
): string | null {
  if (distance < 50_000 || !origin || !destination) return null
  const franceBounds = { minLongitude: -5.5, maxLongitude: 9.8, minLatitude: 41, maxLatitude: 51.5 }
  const routeLocations = [origin, ...waypoints, destination]
  const entirelyInFrance = routeLocations.every(({ coordinates: [longitude, latitude] }) =>
    longitude >= franceBounds.minLongitude &&
    longitude <= franceBounds.maxLongitude &&
    latitude >= franceBounds.minLatitude &&
    latitude <= franceBounds.maxLatitude,
  )
  if (!entirelyInFrance) return null

  const kilometers = distance / 1000
  const minimum = Math.floor(kilometers * 0.08)
  const maximum = Math.ceil(kilometers * 0.12)
  const formatPrice = (price: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
  return `Environ ${formatPrice(minimum)}–${formatPrice(maximum)}`
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="panel-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1 id="panel-title">{title}</h1>
    </div>
  )
}
