import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/index.css'

// PWA : seulement en production (en dev, le cache gênerait le rechargement à chaud de Vite).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sans service worker, l'appli fonctionne normalement (simplement pas hors ligne).
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
