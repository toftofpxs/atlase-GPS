import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // HERE_API_KEY (sans préfixe VITE_) reste côté serveur : il n'est jamais inclus dans le bundle.
  const env = loadEnv(mode, '.', '')
  const apiKey = encodeURIComponent(env.HERE_API_KEY ?? '')

  return {
    plugins: [react()],
    server: {
      allowedHosts: ['weak-yaks-fold.loca.lt'],
      proxy: {
        // En dev, /api/traffic/* est relayé vers HERE avec la clé ajoutée ici.
        // En prod, c'est la fonction Netlify netlify/functions/traffic.mts qui fait la même chose.
        '/api/traffic': {
          target: 'https://data.traffic.hereapi.com',
          changeOrigin: true,
          rewrite: (path) => {
            const target = path.replace(/^\/api\/traffic/, '/v7')
            return `${target}${target.includes('?') ? '&' : '?'}apiKey=${apiKey}`
          },
        },
      },
    },
  }
})
