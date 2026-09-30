import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { env } from './env'

// F097: "Uploads in private storage with signed short-lived URLs; encryption at rest; no public
// bucket paths anywhere."
//
// - Encryption at rest: every page image is sealed with AES-256-GCM by the app before it is
//   written, so the database (and any dump or backup of it) only ever holds ciphertext. That is on
//   top of the database provider's own disk encryption.
// - Signed short-lived URLs: an image is only served by GET /api/scan-pages/:id with an expiry and
//   an HMAC over (page id, expiry), and the viewer must also be signed in with access to it.
//
// Both keys are derived from BETTER_AUTH_SECRET with HKDF under separate labels, so no new secret
// has to be provisioned. Rotating that secret makes existing scans unreadable. That's acceptable
// because scans are short-lived by design (purged after SCAN_RETENTION_DAYS).

const IV_BYTES = 12
const TAG_BYTES = 16

function deriveKey(label: string, secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'prepplan-scans', label, 32))
}

export function encryptScan(
  plain: Buffer,
  secret: string = env.BETTER_AUTH_SECRET,
): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey('scan-image-v1', secret), iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

/** Throws if the data was tampered with or sealed under a different key. */
export function decryptScan(
  sealed: Buffer,
  secret: string = env.BETTER_AUTH_SECRET,
): Buffer {
  const iv = sealed.subarray(0, IV_BYTES)
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const body = sealed.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('scan-image-v1', secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/** How long a signed image link stays valid. */
export const SCAN_URL_TTL_SEC = 10 * 60

function signature(pageId: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', deriveKey('scan-url-v1', secret))
    .update(`${pageId}.${expiresAt}`)
    .digest('base64url')
}

export function signedScanPageUrl(
  pageId: string,
  now: number = Date.now(),
  secret: string = env.BETTER_AUTH_SECRET,
): string {
  const exp = Math.floor(now / 1000) + SCAN_URL_TTL_SEC
  return `/api/scan-pages/${pageId}?exp=${exp}&sig=${signature(pageId, exp, secret)}`
}

export function verifyScanPageSignature(
  pageId: string,
  exp: string | null,
  sig: string | null,
  now: number = Date.now(),
  secret: string = env.BETTER_AUTH_SECRET,
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false
  const expiresAt = Number(exp)
  if (expiresAt < Math.floor(now / 1000)) return false
  const expected = Buffer.from(signature(pageId, expiresAt, secret))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
