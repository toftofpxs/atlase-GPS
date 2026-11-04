// Carte « mode conduite » : plus légère pendant la conduite, et préchargée hors ligne le long du trajet.
import type { Map as MapLibreMap, VectorTileSource } from 'maplibre-gl'
import type { RouteSummary } from '../types/geocoding'
import { getPointAtDistance, getRouteGeometry, type Point } from './routeGeometry'

/** Au-delà de 2, la différence ne se voit pas en roulant mais coûte cher en calcul (écrans 3x). */
const DRIVING_MAX_PIXEL_RATIO = 2
/** Calques masqués en conduite : bâtiments 3D, points d'intérêt, numéros de rue. */
const DECORATIVE_SYMBOL_PATTERN = /poi|housenum|aerodrome|aeroway|airport/i

const hiddenLayers = new WeakMap<MapLibreMap, Set<string>>()

export function applyDrivingMapLook(map: MapLibreMap, driving: boolean): void {
  const devicePixelRatio = window.devicePixelRatio || 1
  const pixelRatio = driving ? Math.min(devicePixelRatio, DRIVING_MAX_PIXEL_RATIO) : devicePixelRatio
  if (map.getPixelRatio() !== pixelRatio) map.setPixelRatio(pixelRatio)

  const hidden = hiddenLayers.get(map) ?? new Set<string>()
  hiddenLayers.set(map, hidden)
  if (driving) {
    for (const layer of map.getStyle().layers ?? []) {
      const decorative =
        layer.type === 'fill-extrusion' || (layer.type === 'symbol' && DECORATIVE_SYMBOL_PATTERN.test(layer.id))
      if (!decorative || map.getLayoutProperty(layer.id, 'visibility') === 'none') continue
      map.setLayoutProperty(layer.id, 'visibility', 'none')
      hidden.add(layer.id)
    }
    return
  }
  for (const id of hidden) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
  }
  hidden.clear()
}

/** Longueur de trajet préchargée devant la position (au-delà, rechargé en route). */
export const PREFETCH_AHEAD_METERS = 120_000
/** Relance du préchargement quand on a parcouru cette distance. */
export const PREFETCH_REFRESH_METERS = 60_000
const SAMPLE_STEP_METERS = 250
/** Points pris de part et d'autre du tracé, pour couvrir les tuiles voisines quand on longe un bord. */
const SIDE_OFFSET_METERS = 450
const MAX_TILES = 700

/**
 * Demande au service worker de mettre en cache les tuiles de carte le long du trajet,
 * pour que la carte reste affichée dans les tunnels et les zones sans réseau.
 * Les tuiles vectorielles au zoom max de la source servent à tous les zooms supérieurs.
 */
export function prefetchRouteTiles(map: MapLibreMap, route: RouteSummary, fromAlong: number): number {
  const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null
  if (!controller) return 0
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return 0

  const coordinates = route.coordinates as Point[]
  const { total } = getRouteGeometry(coordinates)
  const end = Math.min(total, fromAlong + PREFETCH_AHEAD_METERS)
  const urls = new Set<string>()

  for (const [id, specification] of Object.entries(map.getStyle().sources ?? {})) {
    if (specification.type !== 'vector') continue
    const source = map.getSource<VectorTileSource>(id)
    const templates = source?.tiles
    if (!source || !templates?.length) continue
    const maxZoom = Math.min(source.maxzoom ?? 14, 16)
    const minZoom = source.minzoom ?? 0
    // Zoom max (détail) + deux niveaux plus larges (horizon de la vue inclinée, dézoom sur voie rapide).
    const zooms = [maxZoom, maxZoom - 2, maxZoom - 4].filter((zoom) => zoom >= minZoom)

    for (let along = Math.max(0, fromAlong); along <= end && urls.size < MAX_TILES; along += SAMPLE_STEP_METERS) {
      const point = getPointAtDistance(coordinates, along)
      for (const zoom of zooms) {
        const offsets = zoom === maxZoom ? SIDE_OFFSETS : [[0, 0]]
        for (const [east, north] of offsets) {
          const [x, y] = getTile(offsetPoint(point, east, north), zoom)
          const template = templates[(x + y) % templates.length]
          urls.add(template.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y)))
        }
      }
    }
  }

  if (urls.size > 0) controller.postMessage({ type: 'prefetch-tiles', urls: [...urls] })
  return urls.size
}

const SIDE_OFFSETS: [number, number][] = [
  [0, 0],
  [SIDE_OFFSET_METERS, 0],
  [-SIDE_OFFSET_METERS, 0],
  [0, SIDE_OFFSET_METERS],
  [0, -SIDE_OFFSET_METERS],
]

function offsetPoint([longitude, latitude]: Point, eastMeters: number, northMeters: number): Point {
  return [
    longitude + eastMeters / (111_320 * Math.cos((latitude * Math.PI) / 180)),
    latitude + northMeters / 110_540,
  ]
}

/** Tuile (x, y) contenant le point, schéma XYZ Web Mercator. */
function getTile([longitude, latitude]: Point, zoom: number): [number, number] {
  const scale = 2 ** zoom
  const latitudeRadians = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180
  const x = Math.floor(((longitude + 180) / 360) * scale)
  const y = Math.floor(((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * scale)
  return [Math.min(Math.max(x, 0), scale - 1), Math.min(Math.max(y, 0), scale - 1)]
}
