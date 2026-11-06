// Relais vers les tuiles de trafic TomTom : garde la clé TOMTOM_API_KEY côté serveur.
// Variable à définir dans Netlify : Site configuration > Environment variables > TOMTOM_API_KEY.

const TILE_PATH = /^\/api\/traffic\/flow\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.pbf$/

export default async (request: Request): Promise<Response> => {
  const apiKey = process.env.TOMTOM_API_KEY
  if (!apiKey) return Response.json({ error: 'TOMTOM_API_KEY manquante sur Netlify.' }, { status: 500 })

  const match = new URL(request.url).pathname.match(TILE_PATH)
  if (!match) return Response.json({ error: 'Tuile inconnue.' }, { status: 404 })
  const [, z, x, y] = match.map(Number)
  const max = 2 ** z
  if (z > 22 || x >= max || y >= max) return Response.json({ error: 'Tuile hors limites.' }, { status: 400 })

  const target = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(target)
  if (!response.ok) {
    // On ne renvoie pas le corps d'erreur de TomTom (il pourrait contenir l'URL avec la clé).
    return Response.json({ error: `TomTom a répondu ${response.status}.` }, { status: response.status })
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'public, max-age=60',
      // Cache partagé du CDN Netlify : une même tuile n'est demandée à TomTom qu'une fois par période.
      'Netlify-CDN-Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60',
    },
  })
}

export const config = { path: '/api/traffic/*' }
