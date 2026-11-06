import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { LoaderCircle, MapPin, Search, X } from 'lucide-react'
import { getGeocodingErrorMessage, searchPlaces } from '../../services/geocoding'
import { useInterfaceStore } from '../../stores/interfaceStore'
import type { Destination } from '../../types/geocoding'

const MIN_QUERY_LENGTH = 3

export function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Destination[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focused, setFocused] = useState(false)
  const [replacingSelection, setReplacingSelection] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retryCount, setRetryCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTarget = useInterfaceStore((state) => state.searchTarget)
  const searchRequest = useInterfaceStore((state) => state.searchRequest)
  const initialSearchRequest = useRef(searchRequest)
  const searchStopIndex = useInterfaceStore((state) => state.searchStopIndex)
  const origin = useInterfaceStore((state) => state.origin)
  const waypoints = useInterfaceStore((state) => state.waypoints)
  const destination = useInterfaceStore((state) => state.destination)
  const setFavoriteDraft = useInterfaceStore((state) => state.setFavoriteDraft)
  const setOrigin = useInterfaceStore((state) => state.setOrigin)
  const setWaypoint = useInterfaceStore((state) => state.setWaypoint)
  const removeWaypoint = useInterfaceStore((state) => state.removeWaypoint)
  const setDestination = useInterfaceStore((state) => state.setDestination)
  const selectedPlace =
    searchTarget === 'origin'
      ? origin
      : searchTarget === 'stop'
        ? waypoints[searchStopIndex]
        : destination
  const activeSelection = replacingSelection ? null : selectedPlace
  const targetLabel =
    searchTarget === 'origin'
      ? 'Point de départ'
      : searchTarget === 'stop'
        ? 'Étape intermédiaire'
        : searchTarget === 'favorite'
          ? 'Lieu favori'
        : 'Destination'
  const normalizedQuery = query.trim()

  useEffect(() => {
    // Pas d'ouverture au chargement : seulement quand une demande de recherche arrive ensuite.
    // (On compare à la valeur initiale : en développement, React exécute les effets deux fois au montage.)
    if (searchRequest === initialSearchRequest.current) return

    setQuery('')
    setResults([])
    setError('')
    setActiveIndex(-1)
    setFocused(true)
    setReplacingSelection(true)
    inputRef.current?.focus()
  }, [searchRequest])

  useEffect(() => {
    setResults([])
    setError('')
    setActiveIndex(-1)

    if (activeSelection || normalizedQuery.length < MIN_QUERY_LENGTH) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setLoading(true)
      void searchPlaces(normalizedQuery, controller.signal)
        .then(setResults)
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(getGeocodingErrorMessage(requestError))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 350)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [activeSelection, normalizedQuery, retryCount])

  const choosePlace = (place: Destination) => {
    if (searchTarget === 'origin') {
      setOrigin(place)
    } else if (searchTarget === 'stop') {
      setWaypoint(searchStopIndex, place)
    } else if (searchTarget === 'favorite') {
      setFavoriteDraft(place)
    } else {
      setDestination(place)
    }
    setQuery(
      searchTarget === 'favorite'
        ? ''
        : [place.name, place.details].filter(Boolean).join(', '),
    )
    setResults([])
    setFocused(false)
    setActiveIndex(-1)
    setReplacingSelection(false)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      choosePlace(results[activeIndex])
    } else if (event.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const clearSearch = () => {
    if (query && replacingSelection) {
      setQuery('')
      setResults([])
      setError('')
      setFocused(true)
      inputRef.current?.focus()
      return
    }

    setQuery('')
    setResults([])
    setError('')
    if (searchTarget === 'favorite') setFavoriteDraft(null)
    else if (searchTarget === 'origin') setOrigin(null)
    else if (searchTarget === 'stop' && waypoints[searchStopIndex]) removeWaypoint(searchStopIndex)
    else setDestination(null)
    setReplacingSelection(false)
    setFocused(true)
    inputRef.current?.focus()
  }

  const showDropdown = focused && !activeSelection

  return (
    <div className="search-wrap">
      <div className="search-box">
        <Search className="search-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
        <label className="sr-only" htmlFor="destination-search">
          Rechercher une adresse ou une destination
        </label>
        <input
          ref={inputRef}
          id="destination-search"
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown && results.length > 0 ? 'photon-results' : undefined}
          aria-activedescendant={activeIndex >= 0 ? `photon-option-${activeIndex}` : undefined}
          aria-describedby="search-status"
          placeholder={
            searchTarget === 'origin'
              ? 'Rechercher un point de départ'
              : searchTarget === 'stop'
                ? 'Rechercher une étape intermédiaire'
                : searchTarget === 'favorite'
                  ? 'Rechercher un lieu à enregistrer'
                : 'Où souhaitez-vous aller ?'
          }
          value={query}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
        />
        {loading ? (
          <LoaderCircle className="search-spinner" size={16} aria-label="Recherche en cours" />
        ) : query || activeSelection ? (
          <button
            type="button"
            className="search-clear"
            aria-label={`Effacer ${targetLabel.toLowerCase()}`}
            onClick={clearSearch}
          >
            <X size={15} />
          </button>
        ) : (
          <kbd aria-hidden="true">⌘ K</kbd>
        )}
      </div>

      <span className="search-status" id="search-status" aria-live="polite">
        <MapPin size={12} />
        {activeSelection ? `${targetLabel} sélectionné` : `Recherche ${targetLabel.toLowerCase()} · Photon`}
      </span>

      {showDropdown && (
        <div className="search-dropdown">
          {normalizedQuery.length < MIN_QUERY_LENGTH ? (
            <p className="search-hint">Saisissez au moins 3 caractères pour rechercher.</p>
          ) : loading ? (
            <p className="search-hint" role="status">Recherche des lieux…</p>
          ) : error ? (
            <div className="search-error" role="alert">
              <p>{error}</p>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setRetryCount((count) => count + 1)}>
                Réessayer
              </button>
            </div>
          ) : results.length > 0 ? (
            <ul id="photon-results" className="search-results" role="listbox" aria-label="Résultats de recherche">
              {results.map((place, index) => (
                <li key={place.id} role="presentation">
                  <button
                    id={`photon-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    className={`search-result ${activeIndex === index ? 'search-result-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choosePlace(place)}
                  >
                    <span className="result-icon"><MapPin size={16} /></span>
                    <span className="result-copy">
                      <span className="result-name">{place.name}</span>
                      {place.details && <span className="result-details">{place.details}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="search-hint">Aucun lieu trouvé pour cette recherche.</p>
          )}
          <div className="search-attribution">Résultats Photon · © OpenStreetMap contributors</div>
        </div>
      )}
    </div>
  )
}
