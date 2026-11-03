import type { CurrentPosition } from '../types/navigation'
import type { Destination } from '../types/geocoding'

export function watchCurrentLocation(
  onPosition: (position: CurrentPosition) => void,
  onError: (error: GeolocationPositionError) => void,
): number {
  return navigator.geolocation.watchPosition(
    ({ coords }) => {
      onPosition({
        coordinates: [coords.longitude, coords.latitude],
        accuracy: coords.accuracy,
        heading: coords.heading,
      })
    },
    onError,
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 1500 },
  )
}

export function getCurrentLocation(): Promise<Destination> {
  if (!window.isSecureContext) {
    return Promise.reject(new Error('secure-context-required'))
  }
  if (!navigator.geolocation) {
    return Promise.reject(new Error('unsupported'))
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({
          id: 'browser-current-location',
          name: 'Ma position',
          details: 'Position GPS actuelle',
          coordinates: [coords.longitude, coords.latitude],
        })
      },
      (error) => {
        reject(new Error(error.code === error.PERMISSION_DENIED ? 'permission-denied' : 'unavailable'))
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}

export function getLocationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'secure-context-required') {
      return 'Safari bloque la localisation sur cette adresse HTTP. Il faut ouvrir l’application en HTTPS ; autoriser la position dans les réglages ne suffit pas.'
    }
    if (error.message === 'unsupported') return 'La géolocalisation n’est pas prise en charge par ce navigateur.'
    if (error.message === 'permission-denied') {
      return 'L’accès à la position a été refusé pour ce site. Vérifiez Réglages > Safari > Localisation et choisissez Autoriser.'
    }
  }
  return 'Votre position est indisponible. Vérifiez le signal GPS et réessayez.'
}
