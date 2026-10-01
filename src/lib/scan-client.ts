// F050, browser side: turns whatever the parent picked (phone photos, or a scanned PDF) into
// upright, compressed JPEG pages before anything is uploaded. Photos from phones carry their
// rotation in EXIF; createImageBitmap with imageOrientation 'from-image' applies it, so the page
// is upright here and the server never has to decode an image. A page that is still sideways
// (a photo taken at an angle the phone didn't record) can be turned by hand with rotatePage().

/** Longest side of a page after compression: plenty for handwriting, small enough to upload. */
const MAX_EDGE = 1800
const TARGET_MAX_BYTES = 2.5 * 1024 * 1024

export interface LocalPage {
  key: string
  blob: Blob
  previewUrl: string
  width: number
  height: number
  /** Where it came from, for error messages: "IMG_2041.jpg" or "scan.pdf, page 3". */
  source: string
}

let counter = 0

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (blob && (blob.size <= TARGET_MAX_BYTES || quality === 0.55)) return blob
  }
  throw new Error('Could not compress this page.')
}

function fitCanvas(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  return canvas
}

async function pageFromCanvas(canvas: HTMLCanvasElement, source: string): Promise<LocalPage> {
  const blob = await canvasToJpeg(canvas)
  counter += 1
  return {
    key: `page-${Date.now()}-${counter}`,
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    source,
  }
}

async function imageToPage(file: Blob, source: string): Promise<LocalPage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = fitCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process photos.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return pageFromCanvas(canvas, source)
}

async function pdfToPages(file: File): Promise<Array<LocalPage>> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const doc = await task.promise
  const pages: Array<LocalPage> = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({
        scale: MAX_EDGE / Math.max(base.width, base.height),
      })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      pages.push(await pageFromCanvas(canvas, `${file.name}, page ${n}`))
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return pages
}

/** Every page in the picked files, in the order picked. PDFs expand to one page per sheet. */
export async function filesToPages(files: Array<File>): Promise<Array<LocalPage>> {
  const pages: Array<LocalPage> = []
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      pages.push(...(await pdfToPages(file)))
    } else if (file.type.startsWith('image/')) {
      pages.push(await imageToPage(file, file.name))
    } else {
      throw new Error(`"${file.name}" is not a photo or a PDF.`)
    }
  }
  return pages
}

/** A quarter turn clockwise, for a page the phone left sideways. */
export async function rotatePage(page: LocalPage): Promise<LocalPage> {
  const bitmap = await createImageBitmap(page.blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.height
  canvas.height = bitmap.width
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot rotate photos.')
  ctx.translate(canvas.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  URL.revokeObjectURL(page.previewUrl)
  return { ...(await pageFromCanvas(canvas, page.source)), key: page.key }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
