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
  // TOMTOM_API_KEY (sans préfixe VITE_) reste côté serveur : elle n'est jamais incluse dans le bundle.
  const env = loadEnv(mode, '.', '')
  const apiKey = encodeURIComponent(env.TOMTOM_API_KEY ?? '')

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
        // En dev, les tuiles /api/traffic/flow/{z}/{x}/{y}.pbf sont relayées vers TomTom avec la clé ajoutée ici.
        // En prod, c'est la fonction Netlify netlify/functions/traffic.mts qui fait la même chose.
        // Recherche le long du trajet (TomTom) : en prod, netlify/functions/along-route.mts.
        '/api/along-route': {
          target: 'https://api.tomtom.com',
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/api\/along-route\/([^/?]*)\.json(\?.*)?$/, (_match, query: string, search = '') =>
              `/search/2/searchAlongRoute/${query}.json${search ? `${search}&` : '?'}key=${apiKey}`,
            ),
        },
        '/api/traffic': {
          target: 'https://api.tomtom.com',
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(
              /^\/api\/traffic\/flow\/(\d+)\/(\d+)\/(\d+)\.pbf(\?.*)?$/,
              `/traffic/map/4/tile/flow/relative/$1/$2/$3.pbf?key=${apiKey}`,
            ),
        },
      },
    },
  }
})
