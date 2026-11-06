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
        // En dev, les appels /api/… sont relayés vers TomTom avec la clé ajoutée ici.
        // En prod, ce sont les fonctions serveur qui le font (Vercel : api/*.ts, Netlify : netlify/functions/*.mts).
        // Recherche le long du trajet (sans mot-clé : la catégorie suffit).
        '/api/along-route': {
          target: 'https://api.tomtom.com',
          changeOrigin: true,
          rewrite: (path) => {
            const search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
            return `/search/2/searchAlongRoute/.json${search ? `${search}&` : '?'}key=${apiKey}`
          },
        },
        // Tuiles de trafic : /api/traffic?z=…&x=…&y=…
        '/api/traffic': {
          target: 'https://api.tomtom.com',
          changeOrigin: true,
          rewrite: (path) => {
            const tile = (name: string) => path.match(new RegExp('[?&]' + name + '=(\\d+)'))?.[1] ?? '0'
            const [z, x, y] = [tile('z'), tile('x'), tile('y')]
            return `/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${apiKey}`
          },
        },
      },
    },
  }
})
