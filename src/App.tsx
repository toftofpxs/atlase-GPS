import { ArrowUpRight, Menu, Navigation2, X } from 'lucide-react'
import { MapCanvas } from './components/Map/MapCanvas'
import { RoutePanel } from './components/Navigation/RoutePanel'
import { SearchBar } from './components/Search/SearchBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { IconButton } from './components/UI/IconButton'
import { useInterfaceStore } from './stores/interfaceStore'

function App() {
  const activeSection = useInterfaceStore((state) => state.activeSection)
  const settingsOpen = useInterfaceStore((state) => state.settingsOpen)
  const mobileNavOpen = useInterfaceStore((state) => state.mobileNavOpen)
  const toggleMobileNav = useInterfaceStore((state) => state.toggleMobileNav)

  return (
    <main className="app-shell">
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
