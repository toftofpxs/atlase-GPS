// Petit bip d'alerte (survitesse), généré avec Web Audio : aucun fichier son à charger.

let audioContext: AudioContext | null = null

/**
 * À appeler depuis un clic (ex. « Démarrer ») : iOS et Chrome n'autorisent le son
 * qu'après une action de l'utilisateur.
 */
export function unlockAlertSound(): void {
  try {
    audioContext ??= new AudioContext()
    void audioContext.resume()
  } catch {
    // Web Audio indisponible : l'alerte reste visuelle.
  }
}

/** Deux bips courts. */
export function playAlertBeep(): void {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const start = audioContext.currentTime
    for (const offset of [0, 0.22]) {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16)
      oscillator.connect(gain).connect(audioContext.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.18)
    }
  } catch {
    // Son bloqué ou indisponible : l'alerte reste visuelle.
  }
}
