// F128: interface sound effects. Like F125's coin chime (reward-sound.ts), every sound here is
// synthesized with the Web Audio API -- no audio files, nothing licensed, nothing to attribute.
// Sounds are short and quiet, and the student (or parent) can switch them off from the sidebar;
// that choice is remembered per device in localStorage, which is the right home for a per-viewer
// preference like this. Everything is best-effort: no Web Audio, a blocked AudioContext, or a
// private window with storage disabled simply means silence, never an error.

const STORAGE_KEY = 'examprep:sfx'
const listeners = new Set<(muted: boolean) => void>()
let ctx: AudioContext | null = null

export function isSfxMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

export function setSfxMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    // Storage unavailable -- the toggle still works for this page view via listeners.
  }
  listeners.forEach((fn) => fn(muted))
}

export function onSfxMutedChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || isSfxMuted()) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface ToneOptions {
  freq: number
  to?: number
  at?: number
  length?: number
  type?: OscillatorType
  volume?: number
}

function tone(ac: AudioContext, o: ToneOptions) {
  const start = ac.currentTime + (o.at ?? 0)
  const length = o.length ?? 0.08
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, start)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + length)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(o.volume ?? 0.06, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(start)
  osc.stop(start + length + 0.02)
}

/** A soft, bubbly "pop" for a button press. */
export function playTap(): void {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 420, to: 760, length: 0.07, volume: 0.05 })
}

/** A quick two-note rise for moving between sections. */
export function playNav(): void {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 587, length: 0.06, type: 'triangle', volume: 0.045 })
  tone(ac, {
    freq: 880,
    at: 0.05,
    length: 0.08,
    type: 'triangle',
    volume: 0.045,
  })
}

/** A tiny tick for ticking a box or choosing an option. */
export function playSelect(): void {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 1320, length: 0.035, type: 'triangle', volume: 0.035 })
}

/** A bright four-note arpeggio for finishing something. */
export function playSuccess(): void {
  const ac = audio()
  if (!ac) return
  ;[523, 659, 784, 1047].forEach((freq, i) =>
    tone(ac, {
      freq,
      at: i * 0.07,
      length: 0.16,
      type: 'triangle',
      volume: 0.06,
    }),
  )
}

/**
 * One document-level listener gives every button, link and choice in the app its sound, instead
 * of wiring each of ~24 screens by hand. Returns an uninstall function.
 */
export function installUiSounds(): () => void {
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    const target = event.target as Element | null
    const el = target?.closest(
      'button, a[href], [role="button"], summary, label, select, input[type="checkbox"], input[type="radio"]',
    )
    if (!el) return
    if (el.matches(':disabled, [aria-disabled="true"]')) return
    if (
      el.matches('label, select, input[type="checkbox"], input[type="radio"]')
    ) {
      playSelect()
    } else if (el.matches('nav a')) {
      playNav()
    } else {
      playTap()
    }
  }
  document.addEventListener('pointerdown', onPointerDown, { capture: true })
  return () =>
    document.removeEventListener('pointerdown', onPointerDown, {
      capture: true,
    })
}
