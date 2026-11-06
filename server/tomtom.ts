// Relais vers TomTom, partagés par Vercel (api/*.ts) et Netlify (netlify/functions/*.mts).
// La clé TOMTOM_API_KEY reste côté serveur : le navigateur n'appelle que /api/…

/** Le CDN garde une même réponse 2 minutes : tous les utilisateurs se partagent le même appel à TomTom. */
const SHARED_CACHE = 'public, s-maxage=120, stale-while-revalidate=60'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** GET /api/traffic?z=…&x=…&y=… : une tuile vectorielle de trafic TomTom (Traffic Flow, style « relative »). */
export async function proxyTrafficTile(request: Request, apiKey: string | undefined): Promise<Response> {
  if (!apiKey) return json({ error: 'TOMTOM_API_KEY manquante côté serveur.' }, 500)
  const params = new URL(request.url).searchParams
  const [z, x, y] = ['z', 'x', 'y'].map((name) => params.get(name) ?? '')
  if (![z, x, y].every((value) => /^\d{1,7}$/.test(value))) return json({ error: 'Tuile invalide.' }, 400)
  const max = 2 ** Number(z)
  if (Number(z) > 22 || Number(x) >= max || Number(y) >= max) return json({ error: 'Tuile hors limites.' }, 400)

  const target = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(target)
  // Pas de corps d'erreur TomTom renvoyé tel quel : il pourrait reprendre l'URL avec la clé.
  if (!response.ok) return json({ error: `TomTom a répondu ${response.status}.` }, response.status)

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'public, max-age=60',
      'CDN-Cache-Control': SHARED_CACHE,
      'Netlify-CDN-Cache-Control': SHARED_CACHE,
    },
  })
}

/** Paramètres de recherche transmis à TomTom (les autres sont ignorés). */
const ALONG_ROUTE_PARAMS: Record<string, RegExp> = {
  maxDetourTime: /^\d{1,4}$/,
  limit: /^\d{1,2}$/,
  categorySet: /^\d{4,7}(,\d{4,7}){0,9}$/,
  language: /^[a-z]{2}-[A-Z]{2}$/,
  sortBy: /^(detourTime|detourDistance|detourOffset)$/,
}
const MAX_BODY_BYTES = 200_000

/** POST /api/along-route?… : recherche de lieux le long du trajet (TomTom Along Route Search). */
export async function proxyAlongRoute(request: Request, apiKey: string | undefined): Promise<Response> {
  if (!apiKey) return json({ error: 'TOMTOM_API_KEY manquante côté serveur.' }, 500)
  if (request.method !== 'POST') return json({ error: 'POST attendu.' }, 405)

  const params = new URL(request.url).searchParams
  // Recherche sans mot-clé : la catégorie suffit (et donne plus de résultats).
  const target = new URL('https://api.tomtom.com/search/2/searchAlongRoute/.json')
  for (const [name, pattern] of Object.entries(ALONG_ROUTE_PARAMS)) {
    const value = params.get(name)
    if (value !== null && pattern.test(value)) target.searchParams.set(name, value)
  }
  target.searchParams.set('key', apiKey)

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return json({ error: 'Trajet trop long.' }, 413)

  const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (!response.ok) return json({ error: `TomTom a répondu ${response.status}.` }, response.status)
  return new Response(response.body, { status: 200, headers: { 'Content-Type': 'application/json' } })
}
