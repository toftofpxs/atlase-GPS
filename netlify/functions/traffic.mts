// Netlify : GET /api/traffic?z=…&x=…&y=… → tuile de trafic TomTom (logique dans server/tomtom.ts).
// Variable à définir dans Netlify : Site configuration > Environment variables > TOMTOM_API_KEY.
import { proxyTrafficTile } from '../../server/tomtom'

export default (request: Request): Promise<Response> => proxyTrafficTile(request, process.env.TOMTOM_API_KEY)

export const config = { path: '/api/traffic' }
