import type { CurrentPosition } from '../types/navigation'
import type { Destination } from '../types/geocoding'

export function watchCurrentLocation(
  onPosition: (position: CurrentPosition) => void,
  onError: (error: GeolocationPositionError) => void,
): number {
  let previousFix: { coordinates: [number, number]; accuracy: number; timestamp: number } | null = null

  return navigator.geolocation.watchPosition(
    ({ coords, timestamp }) => {
      const coordinates: [number, number] = [coords.longitude, coords.latitude]
      const deviceSpeed = Number.isFinite(coords.speed) && coords.speed !== null && coords.speed >= 0
        ? coords.speed
        : null
      let speed = deviceSpeed

      if (
        speed === null &&
        previousFix &&
        coords.accuracy <= 50 &&
        previousFix.accuracy <= 50
      ) {
        const elapsedSeconds = (timestamp - previousFix.timestamp) / 1000
        if (elapsedSeconds >= 0.5 && elapsedSeconds <= 10) {
          const estimatedSpeed = getDistanceMeters(previousFix.coordinates, coordinates) / elapsedSeconds
          if (estimatedSpeed <= 70) speed = estimatedSpeed < 0.8 ? 0 : estimatedSpeed
        }
      }

      previousFix = { coordinates, accuracy: coords.accuracy, timestamp }
      onPosition({
        coordinates,
        accuracy: coords.accuracy,
        heading: coords.heading,
        speed,
      })
    },
    onError,
    // maximumAge 0 : pas de position en cache, qui ferait reculer le marqueur entre deux vrais points GPS.
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  )
}

export function getDistanceMeters(
  first: [number, number],
  second: [number, number],
): number {
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

/**
 * Position actuelle. `maximumAgeMs` : âge maximal d'une position déjà connue du téléphone
 * (par défaut 1 minute ; mettre une valeur courte quand on s'est sûrement déplacé).
 */
export function getCurrentLocation(maximumAgeMs = 60_000): Promise<Destination> {
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
      { enableHighAccuracy: true, timeout: 12000, maximumAge: maximumAgeMs },
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
      return 'Safari a refusé l’accès à votre position pour ce site. Sur iPhone ou iPad, vérifiez Réglages > Apps > Safari > Localisation, puis dans Safari ouvrez les réglages de ce site et choisissez Autoriser pour la localisation. Sur Mac, vérifiez Safari > Réglages > Sites web > Localisation. Rechargez ensuite la page.'
    }
  }
  return 'Votre position est indisponible. Vérifiez le signal GPS et réessayez.'
}
