// Affichage des manœuvres et des durées, partagé par l'écran de conduite et sa feuille dépliée.
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Merge,
  RotateCcw,
  Split,
  Undo2,
} from 'lucide-react'
import { formatManeuver } from '../../services/navigation'
import type { RouteStep } from '../../types/geocoding'

/** Icône de manœuvre plus précise que gauche/droite : légèrement, bifurcation, arrivée… */
export function getManeuverIcon(step: RouteStep | undefined) {
  if (!step) return ArrowUp
  const { type, modifier } = step.maneuver
  if (type === 'arrive') return Flag
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn' || type === 'exit rotary') return RotateCcw
  if (modifier === 'uturn') return Undo2
  if (type === 'fork') return Split
  if (type === 'merge') return Merge
  switch (modifier) {
    case 'slight left':
      return ArrowUpLeft
    case 'slight right':
      return ArrowUpRight
    case 'left':
    case 'sharp left':
      return CornerUpLeft
    case 'right':
    case 'sharp right':
      return CornerUpRight
    default:
      return ArrowUp
  }
}

/** Consigne courte, sans le nom de rue (affiché en grand à côté) : « Tournez à gauche ». */
export function getShortManeuver(step: RouteStep): string {
  return formatManeuver({ ...step, name: '' }).replace(/\.$/, '')
}

/** Distance en deux parties pour le bandeau : « 40 » en grand, « m » en petit. */
export function formatDistanceParts(distance: number): { value: string; unit: string } {
  if (distance < 1000) {
    // Arrondi au pas de 10 m au-delà de 100 m (comme les GPS) : moins de chiffres qui défilent.
    const rounded = distance < 100 ? Math.round(distance) : Math.round(distance / 10) * 10
    return { value: String(rounded), unit: 'm' }
  }
  return {
    value: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: distance < 10_000 ? 1 : 0 }).format(distance / 1000),
    unit: 'km',
  }
}

export function formatDistance(distance: number): string {
  if (distance < 1000) return `${Math.round(distance)} m`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(distance / 1000)} km`
}

export function formatDuration(duration: number): string {
  const minutes = Math.ceil(duration / 60)
  if (minutes < 1) return 'Arrivée'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`
}

export function formatArrivalTime(duration: number): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(Date.now() + duration * 1000),
  )
}
