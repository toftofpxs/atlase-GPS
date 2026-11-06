// Netlify : POST /api/along-route?… → recherche le long du trajet TomTom (logique dans server/tomtom.ts).
// Même variable que pour le trafic : TOMTOM_API_KEY.
import { proxyAlongRoute } from '../../server/tomtom'

export default (request: Request): Promise<Response> => proxyAlongRoute(request, process.env.TOMTOM_API_KEY)

export const config = { path: '/api/along-route' }
