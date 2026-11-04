import { useState } from 'react'
import { Navigation2, X } from 'lucide-react'
import { clearActiveTrip, loadActiveTrip, type ActiveTrip } from '../../services/activeTrip'
import { unlockAlertSound } from '../../services/alertSound'
import { haptic } from '../../services/haptics'
import { useInterfaceStore } from '../../stores/interfaceStore'

/** Au lancement : propose de reprendre la navigation interrompue (appli fermée ou rechargée). */
export function ResumeTripBanner() {
  const [trip, setTrip] = useState<ActiveTrip | null>(() =>
    useInterfaceStore.getState().navigationActive ? null : loadActiveTrip(),
  )
  const navigationActive = useInterfaceStore((state) => state.navigationActive)
  const resumeTrip = useInterfaceStore((state) => state.resumeTrip)

  if (!trip || navigationActive) return null

  const dismiss = () => {
    clearActiveTrip()
    setTrip(null)
  }

  return (
    <div className="resume-trip-banner" role="dialog" aria-labelledby="resume-trip-title">
      <span className="resume-trip-icon" aria-hidden="true"><Navigation2 size={20} /></span>
      <div className="resume-trip-copy">
        <strong id="resume-trip-title">Reprendre la navigation ?</strong>
        <span>Vers {trip.destination.name}</span>
      </div>
      <button
        type="button"
        className="resume-trip-action"
        onClick={() => {
          // Le son de survitesse n'est autorisé qu'après un geste : ce clic en sert.
          unlockAlertSound()
          haptic('confirm')
          resumeTrip(trip)
          setTrip(null)
        }}
      >
        Reprendre
      </button>
      <button type="button" className="resume-trip-dismiss" onClick={dismiss} aria-label="Ignorer">
        <X size={18} />
      </button>
    </div>
  )
}
