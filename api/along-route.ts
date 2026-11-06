// Vercel : POST /api/along-route?… → recherche le long du trajet TomTom (logique dans server/tomtom.ts).
// Variable à définir dans Vercel : Settings > Environment Variables > TOMTOM_API_KEY.
import { proxyAlongRoute } from '../server/tomtom.js'

declare const process: { env: Record<string, string | undefined> }

export function POST(request: Request): Promise<Response> {
  return proxyAlongRoute(request, process.env.TOMTOM_API_KEY)
}
