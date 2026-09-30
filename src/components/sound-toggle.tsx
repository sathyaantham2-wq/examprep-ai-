import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from './ui/button'
import { isSfxMuted, onSfxMutedChange, setSfxMuted } from '../lib/sfx'

// F128: switches the interface sounds on and off. Rendered next to the theme toggle.
export function SoundToggle() {
  // Storage is only readable in the browser, so the real state is picked up after mount --
  // same reason ThemeToggle waits for mount before choosing its icon.
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    setMuted(isSfxMuted())
    return onSfxMutedChange(setMuted)
  }, [])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={muted ? 'Turn sounds on' : 'Turn sounds off'}
      aria-pressed={!muted}
      onClick={() => setSfxMuted(!muted)}
    >
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </Button>
  )
}
