import { describe, expect, it } from 'vitest'
import {
  SCAN_URL_TTL_SEC,
  decryptScan,
  encryptScan,
  signedScanPageUrl,
  verifyScanPageSignature,
} from './scan-crypto'

const SECRET = 'test-secret-for-scan-crypto'

describe('F097 scan encryption', () => {
  it('round-trips, and the stored bytes are not the image', () => {
    const image = Buffer.from('\xff\xd8\xff pretend jpeg bytes', 'latin1')
    const sealed = encryptScan(image, SECRET)
    expect(sealed.includes(image)).toBe(false)
    expect(decryptScan(sealed, SECRET).equals(image)).toBe(true)
  })

  it('uses a fresh IV every time', () => {
    const image = Buffer.from('same image')
    expect(encryptScan(image, SECRET).equals(encryptScan(image, SECRET))).toBe(false)
  })

  it('rejects tampering and the wrong key', () => {
    const sealed = encryptScan(Buffer.from('answer sheet'), SECRET)
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] ^= 1
    expect(() => decryptScan(tampered, SECRET)).toThrow()
    expect(() => decryptScan(sealed, 'another-secret')).toThrow()
  })
})

describe('F097 signed short-lived image links', () => {
  const now = Date.UTC(2026, 8, 30, 12)
  const parse = (url: string) => new URL(url, 'http://x').searchParams

  it('verifies for the same page before expiry only', () => {
    const q = parse(signedScanPageUrl('page-1', now, SECRET))
    expect(verifyScanPageSignature('page-1', q.get('exp'), q.get('sig'), now, SECRET)).toBe(true)
    expect(
      verifyScanPageSignature('page-1', q.get('exp'), q.get('sig'), now + (SCAN_URL_TTL_SEC + 1) * 1000, SECRET),
    ).toBe(false)
  })

  it('cannot be moved to another page or have its expiry extended', () => {
    const q = parse(signedScanPageUrl('page-1', now, SECRET))
    expect(verifyScanPageSignature('page-2', q.get('exp'), q.get('sig'), now, SECRET)).toBe(false)
    expect(
      verifyScanPageSignature('page-1', String(Number(q.get('exp')) + 3600), q.get('sig'), now, SECRET),
    ).toBe(false)
    expect(verifyScanPageSignature('page-1', null, q.get('sig'), now, SECRET)).toBe(false)
    expect(verifyScanPageSignature('page-1', q.get('exp'), 'forged', now, SECRET)).toBe(false)
  })
})
