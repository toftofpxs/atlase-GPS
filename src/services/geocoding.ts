import axios from 'axios'
import type { Destination, PhotonFeature, PhotonFeatureCollection } from '../types/geocoding'

const PHOTON_API_URL = 'https://photon.komoot.io/api/'
const RESULT_LIMIT = 6

function formatDestination(feature: PhotonFeature, index: number): Destination | null {
  const [longitude, latitude] = feature.geometry.coordinates
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null

  const properties = feature.properties
  const address = [properties.housenumber, properties.street].filter(Boolean).join(' ')
  const city = properties.city ?? properties.district ?? properties.locality ?? properties.county
  const locality = [properties.postcode, city].filter(Boolean).join(' ')
  const details = [address, locality, properties.state, properties.country]
    .filter((value, position, values) => Boolean(value) && values.indexOf(value) === position)
    .join(', ')
  const name = properties.name || address || city || properties.country
  if (!name) return null

  const id = properties.osm_id
    ? `${properties.osm_type ?? 'osm'}-${properties.osm_id}`
    : `${longitude},${latitude}-${index}`

  return {
    id,
    name,
    details,
    coordinates: [longitude, latitude],
  }
}

export async function searchPlaces(query: string, signal: AbortSignal): Promise<Destination[]> {
  const response = await axios.get<PhotonFeatureCollection>(PHOTON_API_URL, {
    params: {
      q: query,
      limit: RESULT_LIMIT,
      lang: 'fr',
    },
    signal,
    timeout: 10000,
  })

  const places = response.data.features
    .map(formatDestination)
    .filter((destination): destination is Destination => destination !== null)
  const seenPlaces = new Set<string>()

  return places.filter((place) => {
    const key = `${place.name}\u0000${place.details}`.toLocaleLowerCase('fr')
    if (seenPlaces.has(key)) return false
    seenPlaces.add(key)
    return true
  })
}

export function getGeocodingErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'La recherche met trop de temps à répondre.'
    if (error.response?.status === 429) return 'Trop de recherches rapprochées. Réessayez dans un instant.'
  }
  return 'Impossible de contacter le service de recherche.'
}

/** Adresse approximative d'un point (géocodage inverse Photon), ou null si introuvable. */
export async function reverseGeocode(
  [longitude, latitude]: [number, number],
  signal?: AbortSignal,
): Promise<string | null> {
  const params = new URLSearchParams({ lon: String(longitude), lat: String(latitude), lang: 'fr', limit: '1' })
  const response = await fetch(`https://photon.komoot.io/reverse?${params}`, { signal })
  if (!response.ok) return null
  const data = (await response.json()) as PhotonFeatureCollection
  const properties = data.features?.[0]?.properties
  if (!properties) return null
  const street = [properties.housenumber, properties.street].filter(Boolean).join(' ')
  const city = properties.city ?? properties.district ?? properties.locality
  const label = [street || properties.name, city].filter(Boolean).join(', ')
  return label || null
}
