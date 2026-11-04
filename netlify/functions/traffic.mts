// Relais vers l'API HERE Traffic v7 : garde la clé HERE_API_KEY côté serveur.
// Variable à définir dans Netlify : Site configuration > Environment variables > HERE_API_KEY.

const HERE_TRAFFIC_URL = 'https://data.traffic.hereapi.com/v7'
const ALLOWED_ENDPOINTS = new Set(['flow', 'incidents'])

export default async (request: Request): Promise<Response> => {
  const apiKey = process.env.HERE_API_KEY
  if (!apiKey) return Response.json({ error: 'HERE_API_KEY manquante sur Netlify.' }, { status: 500 })

  const url = new URL(request.url)
  const endpoint = url.pathname.replace(/^\/api\/traffic\/?/, '')
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return Response.json({ error: 'Endpoint inconnu.' }, { status: 404 })

  const target = new URL(`${HERE_TRAFFIC_URL}/${endpoint}`)
  url.searchParams.forEach((value, key) => {
    if (key !== 'apiKey') target.searchParams.set(key, value)
  })
  target.searchParams.set('apiKey', apiKey)

  const response = await fetch(target)
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      // Le trafic HERE est rafraîchi environ toutes les minutes : inutile de redemander plus souvent.
      'Cache-Control': 'public, max-age=60',
    },
  })
}

export const config = { path: '/api/traffic/*' }
