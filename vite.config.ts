import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Liste des fichiers de build (noms avec hash) pour le service worker : il les met en cache
 * dès l'installation, l'appli démarre donc sans réseau même avant d'avoir tout visité.
 */
function precacheManifest(): Plugin {
  return {
    name: 'atlas-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith('assets/') && !fileName.endsWith('.map'))
        .map((fileName) => `/${fileName}`)
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify(files) })
    },
  }
}

export default defineConfig(({ mode }) => {
  // HERE_API_KEY (sans préfixe VITE_) reste côté serveur : il n'est jamais inclus dans le bundle.
  const env = loadEnv(mode, '.', '')
  const apiKey = encodeURIComponent(env.HERE_API_KEY ?? '')

  return {
    plugins: [react(), precacheManifest()],
    build: {
      rollupOptions: {
        output: {
          // React à part : il change rarement, une mise à jour de l'appli ne le retélécharge pas.
          manualChunks: { react: ['react', 'react-dom'] },
        },
      },
    },
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
