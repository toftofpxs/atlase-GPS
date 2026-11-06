// Relais vers la recherche le long du trajet de TomTom (Search API « Along Route Search ») :
// garde la clé TOMTOM_API_KEY côté serveur. Même variable que pour le trafic.

const PATH = /^\/api\/along-route\/([^/]*)\.json$/
/** Paramètres transmis à TomTom (les autres sont ignorés). */
const ALLOWED_PARAMS: Record<string, RegExp> = {
  maxDetourTime: /^\d{1,4}$/,
  limit: /^\d{1,2}$/,
  categorySet: /^\d{4,7}(,\d{4,7}){0,9}$/,
  language: /^[a-z]{2}-[A-Z]{2}$/,
  sortBy: /^(detourTime|detourDistance|detourOffset)$/,
}
const MAX_BODY_BYTES = 200_000

export default async (request: Request): Promise<Response> => {
  const apiKey = process.env.TOMTOM_API_KEY
  if (!apiKey) return Response.json({ error: 'TOMTOM_API_KEY manquante sur Netlify.' }, { status: 500 })
  if (request.method !== 'POST') return Response.json({ error: 'POST attendu.' }, { status: 405 })

  const url = new URL(request.url)
  const match = url.pathname.match(PATH)
  if (!match) return Response.json({ error: 'Chemin inconnu.' }, { status: 404 })

  const target = new URL(`https://api.tomtom.com/search/2/searchAlongRoute/${match[1]}.json`)
  for (const [name, pattern] of Object.entries(ALLOWED_PARAMS)) {
    const value = url.searchParams.get(name)
    if (value !== null && pattern.test(value)) target.searchParams.set(name, value)
  }
  target.searchParams.set('key', apiKey)

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return Response.json({ error: 'Trajet trop long.' }, { status: 413 })

  const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (!response.ok) {
    // Pas de corps d'erreur TomTom renvoyé tel quel (il pourrait reprendre l'URL avec la clé).
    return Response.json({ error: `TomTom a répondu ${response.status}.` }, { status: response.status })
  }
  return new Response(response.body, { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/along-route/*' }
