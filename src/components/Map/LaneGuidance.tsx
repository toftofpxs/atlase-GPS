import type { Lane } from '../../services/routeLanes'

// Flèches dessinées vers la droite (ou tout droit) dans une grille 24×24 ;
// les variantes « left » sont le miroir horizontal.
const ARROWS: Record<string, { shaft: string; head: string }> = {
  straight: { shaft: 'M12 21V5', head: 'M7 10l5-5 5 5' },
  slight: { shaft: 'M10 21v-7l7-7', head: 'M11.5 6.5H17v5.5' },
  turn: { shaft: 'M8 21v-8a5 5 0 0 1 5-5h6', head: 'M15 4l4 4-4 4' },
  sharp: { shaft: 'M8 21V9a4 4 0 0 1 7-2.6l3.5 6.6', head: 'M19.5 7.5l-1 5.5-5.2-1.7' },
  uturn: { shaft: 'M17 21V10a5 5 0 0 0-10 0v6', head: 'M3.5 12.5L7 16l3.5-3.5' },
}

function getArrow(indication: string): { arrow: { shaft: string; head: string }; mirrored: boolean } {
  const mirrored = indication.includes('left')
  if (indication === 'uturn') return { arrow: ARROWS.uturn, mirrored: false }
  if (indication.startsWith('slight') || indication.startsWith('merge')) return { arrow: ARROWS.slight, mirrored }
  if (indication.startsWith('sharp')) return { arrow: ARROWS.sharp, mirrored }
  if (indication === 'left' || indication === 'right') return { arrow: ARROWS.turn, mirrored }
  return { arrow: ARROWS.straight, mirrored: false }
}

function LaneIcon({ lane }: { lane: Lane }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      {lane.indications.map((indication) => {
        const { arrow, mirrored } = getArrow(indication)
        // Sur une voie à plusieurs flèches, seule celle du trajet est mise en avant.
        const highlighted = lane.valid && (!lane.validIndication || lane.validIndication === indication || lane.indications.length === 1)
        return (
          <g
            key={indication}
            transform={mirrored ? 'translate(24 0) scale(-1 1)' : undefined}
            opacity={highlighted ? 1 : 0.35}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={arrow.shaft} />
            <path d={arrow.head} />
          </g>
        )
      })}
    </svg>
  )
}

export function LaneGuidance({ lanes, distance }: { lanes: Lane[]; distance: string }) {
  const validCount = lanes.filter((lane) => lane.valid).length
  return (
    <div
      className="map-navigation-lanes"
      role="img"
      aria-label={`Dans ${distance}, ${validCount} voie${validCount > 1 ? 's' : ''} sur ${lanes.length} pour suivre le trajet`}
    >
      {lanes.map((lane, index) => (
        <span key={index} className={`map-navigation-lane ${lane.valid ? 'is-valid' : ''}`}>
          <LaneIcon lane={lane} />
        </span>
      ))}
    </div>
  )
}
