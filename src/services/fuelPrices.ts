// Prix des carburants en France : données officielles du gouvernement (prix-carburants.gouv.fr),
// publiées en open data sur data.economie.gouv.fr. Gratuit, sans clé, appelable depuis le navigateur.
import type { Point } from './routeGeometry'

export type FuelType = 'gazole' | 'e10' | 'sp95' | 'sp98' | 'e85' | 'gplc'

export const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'gazole', label: 'Gazole' },
  { value: 'e10', label: 'SP95-E10' },
  { value: 'sp95', label: 'SP95' },
  { value: 'sp98', label: 'SP98' },
  { value: 'e85', label: 'E85' },
  { value: 'gplc', label: 'GPL' },
]

export interface FuelPrice {
  /** €/L, ou null si la station ne vend pas ce carburant (ou est en rupture). */
  price: number | null
  /** Date de la dernière mise à jour du prix (ISO). */
  updatedAt: string | null
}

export type StationPrices = Record<FuelType, FuelPrice>

const DATASET_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records'
/**
 * Distance max entre une station trouvée (TomTom ou OpenStreetMap) et la station officielle.
 * Au-delà, on risque d'afficher le prix de la station d'à côté.
 */
const MATCH_METERS = 150
const STORAGE_KEY = 'atlas-fuel-type'

type DatasetRecord = { geom?: { lon: number; lat: number } } & Partial<Record<`${FuelType}_prix` | `${FuelType}_maj`, string | number | null>>

/**
 * Prix pour chaque station de `points` (même ordre), ou null si aucune station officielle
 * n'est à moins de 200 m. Une seule requête pour toute la liste.
 */
export async function getFuelPrices(points: Point[], signal: AbortSignal): Promise<(StationPrices | null)[]> {
  if (points.length === 0) return []
  const where = points
    .map(([lon, lat]) => `within_distance(geom, geom'POINT(${lon.toFixed(6)} ${lat.toFixed(6)})', ${MATCH_METERS}m)`)
    .join(' OR ')
  const fields = FUEL_TYPES.flatMap(({ value }) => [`${value}_prix`, `${value}_maj`])
  const params = new URLSearchParams({ where, select: ['geom', ...fields].join(','), limit: '100' })
  const response = await fetch(`${DATASET_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`Prix des carburants : ${response.status}`)
  const data = (await response.json()) as { results?: DatasetRecord[] }
  const stations = (data.results ?? []).filter((record) => record.geom)

  // Attribution par paires les plus proches d'abord : chaque station officielle ne sert qu'une fois
  // (sinon deux stations voisines afficheraient le même prix).
  const pairs: { point: number; station: number; distance: number }[] = []
  points.forEach((point, pointIndex) => {
    stations.forEach((station, stationIndex) => {
      const distance = getDistanceMeters(point, [station.geom!.lon, station.geom!.lat])
      if (distance <= MATCH_METERS) pairs.push({ point: pointIndex, station: stationIndex, distance })
    })
  })
  pairs.sort((first, second) => first.distance - second.distance)
  const matched = new Map<number, DatasetRecord>()
  const usedStations = new Set<number>()
  for (const pair of pairs) {
    if (matched.has(pair.point) || usedStations.has(pair.station)) continue
    matched.set(pair.point, stations[pair.station])
    usedStations.add(pair.station)
  }

  return points.map((_, pointIndex) => {
    const best = matched.get(pointIndex)
    if (!best) return null
    const prices = {} as StationPrices
    for (const { value } of FUEL_TYPES) {
      const price = Number(best[`${value}_prix`])
      prices[value] = {
        price: Number.isFinite(price) && price > 0 ? price : null,
        updatedAt: (best[`${value}_maj`] as string | null | undefined) ?? null,
      }
    }
    return prices
  })
}

/** Carburant choisi par l'utilisateur (mémorisé dans le navigateur). */
export function loadFuelType(): FuelType {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (FUEL_TYPES.some((fuel) => fuel.value === value)) return value as FuelType
  } catch {
    // Stockage indisponible : valeur par défaut.
  }
  return 'gazole'
}

export function saveFuelType(fuelType: FuelType): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, fuelType)
  } catch {
    // Stockage indisponible : le choix n'est simplement pas mémorisé.
  }
}

export function formatFuelPrice(price: number): string {
  return `${price.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`
}

/** « il y a 3 j » si le prix a plus d'un jour, sinon null (prix frais). */
export function formatPriceAge(updatedAt: string | null, now = Date.now()): string | null {
  if (!updatedAt) return null
  const days = Math.floor((now - Date.parse(updatedAt)) / 86_400_000)
  if (!Number.isFinite(days) || days < 1) return null
  return `prix d'il y a ${days} j`
}

function getDistanceMeters(first: Point, second: Point): number {
  return Math.hypot(
    (first[0] - second[0]) * 111_320 * Math.cos((first[1] * Math.PI) / 180),
    (first[1] - second[1]) * 110_540,
  )
}
