import { useEffect, useState } from 'react'
import { ArrowUpRight, Menu, Navigation2, X } from 'lucide-react'
import { MapCanvas } from './components/Map/MapCanvas'
import { RoutePanel } from './components/Navigation/RoutePanel'
import { ResumeTripBanner } from './components/Navigation/ResumeTripBanner'
import { SearchBar } from './components/Search/SearchBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { IconButton } from './components/UI/IconButton'
import { isNightAt } from './services/sun'
import { useInterfaceStore } from './stores/interfaceStore'

/** Fréquence de vérification jour/nuit pendant la conduite. */
const NIGHT_CHECK_MS = 60_000

function App() {
  const activeSection = useInterfaceStore((state) => state.activeSection)
  const settingsOpen = useInterfaceStore((state) => state.settingsOpen)
  const mobileNavOpen = useInterfaceStore((state) => state.mobileNavOpen)
  const toggleMobileNav = useInterfaceStore((state) => state.toggleMobileNav)
  const themeMode = useInterfaceStore((state) => state.themeMode)
  const setResolvedTheme = useInterfaceStore((state) => state.setResolvedTheme)
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const freeDriveActive = useInterfaceStore((state) => state.freeDriveActive)
  const drivingActive = navigationActive || freeDriveActive
  const [isNight, setIsNight] = useState<boolean | null>(null)

  // Mode Auto pendant la conduite : clair le jour, sombre la nuit, d'après le soleil à l'endroit où l'on est.
  useEffect(() => {
    if (!drivingActive || themeMode !== 'auto') {
      setIsNight(null)
      return
    }
    const check = () => {
      // Lu dans le store à chaque vérification : pas de nouveau rendu de l'appli à chaque point GPS.
      const state = useInterfaceStore.getState()
      const [longitude, latitude] = state.currentPosition?.coordinates ?? state.route?.coordinates[0] ?? [2.3522, 48.8566]
      setIsNight(isNightAt(new Date(), latitude, longitude))
    }
    check()
    const timer = window.setInterval(check, NIGHT_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [drivingActive, themeMode])

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolvedTheme =
        themeMode !== 'auto'
          ? themeMode
          : isNight !== null
            ? (isNight ? 'dark' : 'light')
            : colorScheme.matches ? 'dark' : 'light'
      document.documentElement.dataset.theme = resolvedTheme
      setResolvedTheme(resolvedTheme)
    }

    applyTheme()
    if (themeMode !== 'auto' || isNight !== null) return

    colorScheme.addEventListener('change', applyTheme)
    return () => colorScheme.removeEventListener('change', applyTheme)
  }, [isNight, setResolvedTheme, themeMode])

  return (
    <main className={`app-shell ${drivingActive ? 'app-driving' : ''}`}>
      <ResumeTripBanner />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Atlas, accueil">
          <span className="brand-mark"><Navigation2 size={19} strokeWidth={2.2} /></span>
          <span className="brand-name">atlas<span>.</span></span>
        </a>
        <div className="topbar-divider" />
        <div className="topbar-context">
          <span className="context-label">ESPACE PERSONNEL</span>
          <span className="context-title">Navigation</span>
        </div>
        <SearchBar />
        <div className="topbar-actions">
          <span className="online-status"><span />MVP · Navigation</span>
          <IconButton
            label={mobileNavOpen ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation'}
            className="mobile-menu"
            aria-expanded={mobileNavOpen}
            onClick={toggleMobileNav}
          >
            {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
          </IconButton>
          <button className="profile-button" type="button" disabled aria-label="Profil utilisateur bientôt disponible">
            <span className="profile-initial">A</span>
            <span className="profile-label">Mon espace</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <Sidebar />
        <RoutePanel section={activeSection} settingsOpen={settingsOpen} />
        <MapCanvas />
      </div>

    </main>
  )
}

export default App
