import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { Car, Footprints, LoaderCircle, MapPin, Move, RefreshCw, Trash2, X } from 'lucide-react'
import { reverseGeocode } from '../../services/geocoding'
import { haptic } from '../../services/haptics'
import { getCurrentLocation, getLocationErrorMessage } from '../../services/location'
import { useInterfaceStore, type ParkedCar as ParkedCarData } from '../../stores/interfaceStore'

interface ParkedCarProps {
  map: MapLibreMap | null
  mapReady: boolean
  /** Navigation ou mode « Conduire » en cours. */
  drivingActive: boolean
}

/** Durée d'affichage de la proposition « Garé ? » après un trajet en voiture. */
const END_PROMPT_MS = 20_000

/**
 * « Ma voiture » : enregistre l'emplacement de la voiture garée, l'affiche sur la carte
 * et propose d'y retourner à pied. Proposé automatiquement à la fin d'un trajet en voiture.
 */
export function ParkedCar({ map, mapReady, drivingActive }: ParkedCarProps) {
  const parkedCar = useInterfaceStore((state) => state.parkedCar)
  const setParkedCar = useInterfaceStore((state) => state.setParkedCar)
  const currentPosition = useInterfaceStore((state) => state.currentPosition)
  const routeMode = useInterfaceStore((state) => state.routeMode)
  const freeDriveActive = useInterfaceStore((state) => state.freeDriveActive)
  const setOrigin = useInterfaceStore((state) => state.setOrigin)
  const setDestination = useInterfaceStore((state) => state.setDestination)
  const setRouteMode = useInterfaceStore((state) => state.setRouteMode)
  const selectSection = useInterfaceStore((state) => state.selectSection)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'walk' | null>(null)
  /** Mode « placer sur la carte » : le prochain appui sur la carte enregistre l'emplacement. */
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')
  const [endPrompt, setEndPrompt] = useState<{ coordinates: [number, number]; accuracy: number } | null>(null)
  const [now, setNow] = useState(Date.now)
  const markerRef = useRef<MapLibreMarker | null>(null)

  // Dernière position connue pendant un trajet EN VOITURE (la position est effacée à l'arrêt).
  const lastCarPositionRef = useRef<{ coordinates: [number, number]; accuracy: number } | null>(null)
  const wasDrivingRef = useRef(false)
  if (drivingActive && currentPosition && (freeDriveActive || routeMode === 'driving')) {
    lastCarPositionRef.current = { coordinates: currentPosition.coordinates, accuracy: currentPosition.accuracy }
  }

  // Fin d'un trajet en voiture : on propose d'enregistrer l'endroit où l'on s'est garé.
  useEffect(() => {
    const wasDriving = wasDrivingRef.current
    wasDrivingRef.current = drivingActive
    if (drivingActive) {
      setEndPrompt(null)
      return
    }
    if (!wasDriving || !lastCarPositionRef.current) return
    setEndPrompt(lastCarPositionRef.current)
    lastCarPositionRef.current = null
    const timer = window.setTimeout(() => setEndPrompt(null), END_PROMPT_MS)
    return () => window.clearTimeout(timer)
  }, [drivingActive])

  // « garée il y a … » : rafraîchi chaque minute tant que la fiche est ouverte.
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  // Repère « P » sur la carte (masqué pendant la conduite pour ne pas encombrer).
  useEffect(() => {
    markerRef.current?.remove()
    markerRef.current = null
    if (!map || !mapReady || !parkedCar || drivingActive) return
    let disposed = false
    void import('maplibre-gl').then(({ Marker }) => {
      if (disposed) return
      // Important : aucune rotation, translation ni échelle sur l'élément racine. MapLibre le place
      // avec « transform » ; les propriétés rotate/translate/scale s'y combineraient et
      // décaleraient le repère à chaque zoom. La forme et l'animation sont dans l'épingle intérieure.
      const element = document.createElement('div')
      element.className = 'parked-car-marker'
      element.setAttribute('role', 'button')
      element.setAttribute('tabindex', '0')
      element.setAttribute('aria-label', 'Ma voiture garée')
      element.innerHTML =
        '<svg class="parked-car-pin" viewBox="0 0 36 46" width="36" height="46" aria-hidden="true">' +
        '<path d="M18 45C18 45 34 29.5 34 17.5A16 16 0 0 0 2 17.5C2 29.5 18 45 18 45Z" fill="#5b4bd6" stroke="#fff" stroke-width="3"/>' +
        '<text x="18" y="23.5" text-anchor="middle" font-size="17" font-weight="800" fill="#fff" font-family="DM Sans, Arial, sans-serif">P</text>' +
        '</svg>'
      const openFromMarker = () => {
        haptic('tap')
        setError('')
        setOpen(true)
      }
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        openFromMarker()
      })
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') openFromMarker()
      })
      // Pas de glissement au doigt : en déplaçant la carte depuis l'épingle, on bougerait la voiture
      // sans le vouloir. Pour corriger l'emplacement : bouton « Déplacer » de la fiche.
      markerRef.current = new Marker({ element, anchor: 'bottom' }).setLngLat(parkedCar.coordinates).addTo(map)
    })
    return () => {
      disposed = true
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [map, mapReady, parkedCar, drivingActive])

  const save = (coordinates: [number, number], accuracy: number | null, savedAt = Date.now()) => {
    const entry: ParkedCarData = { coordinates, accuracy, savedAt, address: null }
    setParkedCar(entry)
    haptic('confirm')
    // L'adresse arrive un peu après ; on ne l'applique que si l'emplacement n'a pas changé entre-temps.
    void reverseGeocode(coordinates)
      .then((address) => {
        if (!address) return
        const current = useInterfaceStore.getState().parkedCar
        if (
          current?.savedAt === entry.savedAt &&
          current.coordinates[0] === coordinates[0] &&
          current.coordinates[1] === coordinates[1]
        ) {
          setParkedCar({ ...current, address })
        }
      })
      .catch(() => {
        // Sans adresse, la fiche affiche simplement « Emplacement enregistré ».
      })
  }

  useEffect(() => {
    if (!placing || !map) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    const handleClick = (event: { lngLat: { lng: number; lat: number } }) => {
      // Correction d'un emplacement existant : on garde l'heure de stationnement d'origine.
      save([event.lngLat.lng, event.lngLat.lat], null, useInterfaceStore.getState().parkedCar?.savedAt)
      setPlacing(false)
      setOpen(true)
    }
    map.once('click', handleClick)
    return () => {
      map.off('click', handleClick)
      canvas.style.cursor = ''
    }
    // save est recréé à chaque rendu : on ne réagit qu'à l'activation du mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing, map])

  const startPlacing = () => {
    haptic('tap')
    setError('')
    setOpen(false)
    setPlacing(true)
  }

  const saveCurrentPosition = async () => {
    setBusy('save')
    setError('')
    try {
      const here = await getCurrentLocation(5_000)
      save(here.coordinates, null)
    } catch (locationError) {
      setError(getLocationErrorMessage(locationError))
    } finally {
      setBusy(null)
    }
  }

  const walkToCar = async () => {
    if (!parkedCar) return
    setBusy('walk')
    setError('')
    try {
      // Position fraîche : on s'est sûrement déplacé depuis qu'on a garé la voiture.
      const here = await getCurrentLocation(5_000)
      if (getDistanceMeters(here.coordinates, parkedCar.coordinates) < 25) {
        setError('Vous êtes juste à côté de votre voiture (moins de 25 m).')
        return
      }
      // Le calcul d'itinéraire se lance tout seul dès que départ et destination sont connus.
      setRouteMode('walking')
      setOrigin(here)
      setDestination({
        id: 'parked-car',
        name: 'Ma voiture',
        details: parkedCar.address ?? 'Emplacement enregistré',
        coordinates: parkedCar.coordinates,
      })
      selectSection('route')
      haptic('confirm')
      setOpen(false)
    } catch (locationError) {
      setError(getLocationErrorMessage(locationError))
    } finally {
      setBusy(null)
    }
  }

  const openCard = () => {
    haptic('tap')
    setError('')
    setOpen(true)
    if (parkedCar && map) {
      map.flyTo({ center: parkedCar.coordinates, zoom: Math.max(map.getZoom(), 16), essential: true })
    }
  }

  return (
    <>
      {!drivingActive && (
        <button
          type="button"
          className={`parked-car-chip ${parkedCar ? 'has-car' : ''}`}
          onClick={openCard}
          aria-label={parkedCar ? 'Voir où est garée ma voiture' : 'Enregistrer où est garée ma voiture'}
        >
          <Car size={18} />
          <span>{parkedCar ? 'Ma voiture' : 'Garer'}</span>
        </button>
      )}

      {endPrompt && !drivingActive && !parkedCarIsHere(parkedCar, endPrompt.coordinates) &&
        createPortal(
          <div className="parked-car-prompt" role="status">
            <span className="parked-car-prompt-icon" aria-hidden="true">P</span>
            <span className="parked-car-prompt-copy">
              <strong>Garé ?</strong>
              <span>Enregistrez l’emplacement de votre voiture.</span>
            </span>
            <button
              type="button"
              className="parked-car-prompt-save"
              onClick={() => {
                save(endPrompt.coordinates, endPrompt.accuracy)
                setEndPrompt(null)
              }}
            >
              Enregistrer
            </button>
            <button type="button" className="parked-car-prompt-close" onClick={() => setEndPrompt(null)} aria-label="Ignorer">
              <X size={18} />
            </button>
          </div>,
          document.body,
        )}

      {placing &&
        createPortal(
          <div className="parked-car-prompt parked-car-placing" role="status">
            <span className="parked-car-prompt-icon" aria-hidden="true">P</span>
            <span className="parked-car-prompt-copy">
              <strong>Touchez la carte</strong>
              <span>à l’endroit où est garée votre voiture.</span>
            </span>
            <button type="button" className="parked-car-prompt-close" onClick={() => setPlacing(false)} aria-label="Annuler">
              <X size={18} />
            </button>
          </div>,
          document.body,
        )}

      {open &&
        createPortal(
          <section className="parked-car-panel" aria-label="Ma voiture">
            <div className="parked-car-header">
              <span className="parked-car-badge" aria-hidden="true">P</span>
              <span className="parked-car-title">
                <strong>Ma voiture</strong>
                <span>
                  {parkedCar
                    ? `${parkedCar.address ?? 'Emplacement enregistré'} · garée ${formatParkedSince(parkedCar.savedAt, now)}`
                    : 'Aucun emplacement enregistré'}
                </span>
              </span>
              <button type="button" className="parked-car-close" onClick={() => setOpen(false)} aria-label="Fermer">
                <X size={18} />
              </button>
            </div>

            {error && <p className="parked-car-error" role="alert">{error}</p>}

            {parkedCar ? (
              <div className="parked-car-actions">
                <button type="button" className="parked-car-primary" onClick={() => void walkToCar()} disabled={busy !== null}>
                  {busy === 'walk' ? <LoaderCircle size={18} className="route-button-spinner" /> : <Footprints size={18} />}
                  Y aller à pied
                </button>
                <div className="parked-car-row">
                  <button type="button" onClick={startPlacing} disabled={busy !== null}>
                    <Move size={18} />
                    Déplacer
                  </button>
                  <button type="button" onClick={() => void saveCurrentPosition()} disabled={busy !== null}>
                    {busy === 'save' ? <LoaderCircle size={18} className="route-button-spinner" /> : <RefreshCw size={18} />}
                    Ma position
                  </button>
                </div>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    haptic('tap')
                    setParkedCar(null)
                    setOpen(false)
                  }}
                  disabled={busy !== null}
                >
                  <Trash2 size={18} />
                  Supprimer
                </button>
              </div>
            ) : (
              <div className="parked-car-actions">
                <button type="button" className="parked-car-primary" onClick={() => void saveCurrentPosition()} disabled={busy !== null}>
                  {busy === 'save' ? <LoaderCircle size={18} className="route-button-spinner" /> : <MapPin size={18} />}
                  Ma position actuelle
                </button>
                <button type="button" onClick={startPlacing} disabled={busy !== null}>
                  <Move size={18} />
                  Placer sur la carte
                </button>
                <p className="parked-car-hint">
                  À la fin d’un trajet en voiture, Atlas vous proposera aussi de l’enregistrer automatiquement.
                </p>
              </div>
            )}
          </section>,
          document.body,
        )}
    </>
  )
}

/** Vrai si la voiture est déjà enregistrée à moins de 30 m de ce point (inutile de reproposer). */
function parkedCarIsHere(parkedCar: ParkedCarData | null, coordinates: [number, number]): boolean {
  return Boolean(parkedCar && getDistanceMeters(parkedCar.coordinates, coordinates) < 30)
}

function getDistanceMeters([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  return Math.hypot((lon1 - lon2) * 111_320 * Math.cos((lat1 * Math.PI) / 180), (lat1 - lat2) * 110_540)
}

/** « à l'instant », « il y a 12 min », « il y a 2 h 05 », « depuis le 3 nov. à 18:20 ». */
export function formatParkedSince(savedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - savedAt) / 60_000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h ${String(minutes % 60).padStart(2, '0')}`
  const date = new Date(savedAt)
  return `depuis le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
