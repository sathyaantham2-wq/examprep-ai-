// F125: a short, original "coin" chime, synthesized with the Web Audio API rather than an
// uploaded/licensed audio file -- three quick ascending notes, no external asset, nothing to
// attribute. Best-effort only: browser autoplay policy can refuse to start an AudioContext
// outside a direct user-gesture call stack, and this fires from an async fetch response, so a
// failure here is silently swallowed -- a missing sound must never block or delay showing the
// student her result (the same rule the backlog entry's AC states for the reward generally).
export function playCoinSound(): void {
  try {
    const ctx = new AudioContext()
    const notes = [660, 880, 1320] // E5, A5, E6 -- a bright, quick major-ish arpeggio
    const noteLength = 0.09
    const gap = 0.07

    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * gap
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, start)
      gainNode.gain.setValueAtTime(0, start)
      gainNode.gain.linearRampToValueAtTime(0.15, start + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + noteLength)
      osc.connect(gainNode)
      gainNode.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + noteLength)
    })

    const totalMs = (notes.length * gap + noteLength) * 1000 + 50
    setTimeout(() => void ctx.close(), totalMs)
  } catch {
    // Autoplay refusal, no Web Audio support, or a headless/test environment -- fine either way.
  }
}
