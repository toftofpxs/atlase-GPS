import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { ResolvedTheme } from '../stores/interfaceStore'

export const MAP_WORKER_URL = mapWorkerUrl

export function getMapStyleUrl(theme: ResolvedTheme): string {
  return theme === 'dark'
    ? 'https://tiles.openfreemap.org/styles/fiord'
    : 'https://tiles.openfreemap.org/styles/positron'
}
