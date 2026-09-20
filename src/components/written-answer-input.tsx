import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'

interface RecognitionResultList {
  length: number
  [index: number]: { isFinal: boolean; 0: { transcript: string } }
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: RecognitionResultList }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const LANGUAGES = [
  { code: 'en-IN', label: 'English' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'hi-IN', label: 'Hindi' },
]

const MAX_SIDE = 1600

// Shrinks a phone photo to a JPEG the server will accept, and returns its base64.
async function photoToBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/**
 * The answer box for a written question. Beyond typing she can speak her answer (the browser
 * turns speech into text) or photograph her handwritten answer (an AI reads it into the box, and
 * she checks and corrects it before submitting). The photo is not kept.
 */
export function WrittenAnswerInput({
  attemptId,
  paperQuestionId,
  value,
  onChange,
}: {
  attemptId: string
  paperQuestionId: string
  value: string
  onChange: (text: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [language, setLanguage] = useState('en-IN')
  const [note, setNote] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    setVoiceSupported(recognitionConstructor() !== null)
    return () => recognition.current?.stop()
  }, [])

  function toggleVoice() {
    setNote(null)
    if (listening) {
      recognition.current?.stop()
      return
    }
    const Ctor = recognitionConstructor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = language
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (event) => {
      let spoken = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) spoken += event.results[i][0].transcript
      }
      if (spoken.trim() === '') return
      const current = latest.current
      onChange(current.trim() === '' ? spoken.trim() : `${current.trimEnd()} ${spoken.trim()}`)
    }
    rec.onerror = (event) => {
      setNote(
        event.error === 'not-allowed'
          ? 'Allow the microphone to speak your answer.'
          : 'Could not hear you. Try again or type.',
      )
    }
    rec.onend = () => setListening(false)
    recognition.current = rec
    setListening(true)
    rec.start()
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setNote(null)
    setReading(true)
    try {
      const image = await photoToBase64(file)
      const response = await fetch(`/api/attempts/${attemptId}/answer-image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paper_question_id: paperQuestionId, media_type: 'image/jpeg', image_base64: image }),
      })
      const body = (await response.json().catch(() => null)) as { text?: string; message?: string } | null
      if (!response.ok || !body?.text) {
        setNote(body?.message ?? 'Could not read the photo. Type your answer instead.')
        return
      }
      onChange(body.text)
      setNote('Read from your photo. Please check it and fix anything that is wrong.')
    } catch {
      setNote('Could not read the photo. Type your answer instead.')
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="border-input min-h-24 w-full rounded-md border bg-transparent p-2 text-sm shadow-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Your answer"
      />
      <div className="no-print flex flex-wrap items-center gap-2">
        {voiceSupported && (
          <>
            <Button type="button" size="sm" variant={listening ? 'default' : 'outline'} onClick={toggleVoice}>
              {listening ? 'Stop speaking' : 'Speak your answer'}
            </Button>
            <select
              aria-label="Language to speak in"
              className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
              value={language}
              disabled={listening}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reading}
          onClick={() => fileInput.current?.click()}
        >
          {reading ? 'Reading your photo…' : 'Photo of my answer'}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handlePhoto(e)}
          aria-label="Upload a photo of your handwritten answer"
        />
      </div>
      {listening && <p className="text-small text-muted-foreground">Listening… speak your answer.</p>}
      {note && (
        <p className="text-small text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </div>
  )
}
