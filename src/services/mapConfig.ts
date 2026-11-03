import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

export const MAP_WORKER_URL = mapWorkerUrl
export const MAP_STYLE_URL =
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'https://tiles.openfreemap.org/styles/fiord'
    : 'https://tiles.openfreemap.org/styles/positron'
