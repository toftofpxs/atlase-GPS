// Trafic en temps réel TomTom (Traffic API, tuiles vectorielles « Vector Flow Tiles » v4).
// Les tuiles passent par /api/traffic : proxy Vite en dev, fonction serveur en prod (Vercel : api/traffic.ts,
// Netlify : netlify/functions/traffic.mts), pour que la clé TomTom ne soit jamais envoyée au navigateur.

/**
 * Zoom minimum de la couche trafic. Dézoomé, TomTom ne renvoie que les grands axes
 * (autoroutes, nationales…) : on voit les bouchons à l'échelle d'une région, sans surcharge.
 */
export const TRAFFIC_MIN_ZOOM = 9
/**
 * Au-delà de ce zoom, MapLibre agrandit les tuiles déjà chargées au lieu d'en demander
 * de nouvelles : beaucoup moins de requêtes, pour un rendu quasi identique.
 */
export const TRAFFIC_MAX_TILE_ZOOM = 16
/** Délai de rafraîchissement des données de trafic. */
export const TRAFFIC_REFRESH_MS = 120_000
/** Nom de la couche dans les tuiles TomTom. */
export const TRAFFIC_SOURCE_LAYER = 'Traffic flow'

/**
 * URL des tuiles pour MapLibre. Le paramètre `v` change toutes les 2 minutes : il force le
 * rechargement des données, et tous les utilisateurs d'une même période partagent le même
 * cache côté Netlify (moins d'appels à TomTom).
 */
export function getTrafficTileUrl(now = Date.now()): string {
  const version = Math.floor(now / TRAFFIC_REFRESH_MS)
  return `${window.location.origin}/api/traffic?z={z}&x={x}&y={y}&v=${version}`
}
