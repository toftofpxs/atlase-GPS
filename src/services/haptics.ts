// Retour haptique (vibrations courtes). Android uniquement : Safari sur iPhone n'expose pas l'API.
import { useInterfaceStore } from '../stores/interfaceStore'

export type HapticKind = 'tap' | 'confirm' | 'warning' | 'maneuver-soon' | 'maneuver-now'

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 12,
  confirm: [18, 40, 18],
  warning: [60, 50, 60],
  'maneuver-soon': 40,
  'maneuver-now': [40, 70, 40, 70, 40],
}

export function haptic(kind: HapticKind): void {
  if (!useInterfaceStore.getState().hapticsEnabled) return
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(PATTERNS[kind])
  } catch {
    // Certains navigateurs refusent tant que l'utilisateur n'a pas touché la page.
  }
}

export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
