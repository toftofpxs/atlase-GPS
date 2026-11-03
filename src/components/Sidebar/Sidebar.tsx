import { Bookmark, Compass, Clock3, Settings2 } from 'lucide-react'
import { useInterfaceStore } from '../../stores/interfaceStore'
import { IconButton } from '../UI/IconButton'

export function Sidebar() {
  const activeSection = useInterfaceStore((state) => state.activeSection)
  const selectSection = useInterfaceStore((state) => state.selectSection)
  const settingsOpen = useInterfaceStore((state) => state.settingsOpen)
  const toggleSettings = useInterfaceStore((state) => state.toggleSettings)
  const mobileNavOpen = useInterfaceStore((state) => state.mobileNavOpen)

  return (
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-mobile-open' : ''}`} aria-label="Navigation principale">
      <div className="sidebar-group">
        <IconButton
          label="Itinéraire"
          active={activeSection === 'route' && !settingsOpen}
          onClick={() => selectSection('route')}
        >
          <Compass size={19} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          label="Favoris"
          active={activeSection === 'favorites' && !settingsOpen}
          onClick={() => selectSection('favorites')}
        >
          <Bookmark size={19} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          label="Récents"
          active={activeSection === 'recent' && !settingsOpen}
          onClick={() => selectSection('recent')}
        >
          <Clock3 size={19} strokeWidth={1.8} />
        </IconButton>
      </div>
      <div className="sidebar-bottom">
        <span className="sidebar-divider" />
        <IconButton
          label="Paramètres"
          active={settingsOpen}
          aria-expanded={settingsOpen}
          onClick={toggleSettings}
        >
          <Settings2 size={19} strokeWidth={1.8} />
        </IconButton>
        <div className="avatar" aria-label="Profil utilisateur à venir">
          A
        </div>
      </div>
    </aside>
  )
}
