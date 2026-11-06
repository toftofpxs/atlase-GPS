// Vercel : GET /api/traffic?z=…&x=…&y=… → tuile de trafic TomTom (logique dans server/tomtom.ts).
// Variable à définir dans Vercel : Settings > Environment Variables > TOMTOM_API_KEY.
import { proxyTrafficTile } from '../server/tomtom.js'

declare const process: { env: Record<string, string | undefined> }

export function GET(request: Request): Promise<Response> {
  return proxyTrafficTile(request, process.env.TOMTOM_API_KEY)
}
