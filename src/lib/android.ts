// F131: the Android app is a Trusted Web Activity over this web app. Android only opens it
// full-screen (no browser URL bar) once it has verified that this domain vouches for the app,
// by fetching /.well-known/assetlinks.json and finding the app's package name next to the
// SHA-256 fingerprint of the key it was signed with.
//
// Fingerprints come from configuration, not code: Play App Signing re-signs the app with
// Google's key, so production needs that fingerprint (Play Console > App integrity) and a
// locally built debug/upload APK needs its own. ANDROID_CERT_SHA256 takes several, comma-separated.

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

export type AssetLinkStatement = {
  relation: Array<string>
  target: {
    namespace: 'android_app'
    package_name: string
    sha256_cert_fingerprints: Array<string>
  }
}

/** Parses a comma-separated list of SHA-256 fingerprints, rejecting anything malformed. */
export function parseFingerprints(raw: string): Array<string> {
  const list = raw
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f.length > 0)
  const bad = list.filter((f) => !FINGERPRINT.test(f))
  if (bad.length > 0) {
    throw new Error(
      `ANDROID_CERT_SHA256 has a malformed fingerprint (expected 32 colon-separated hex bytes): ${bad.join(', ')}`,
    )
  }
  return [...new Set(list)]
}

/**
 * The assetlinks.json body, or null when the app isn't configured yet -- the route then 404s
 * instead of publishing a statement that would verify nothing.
 */
export function buildAssetLinks(
  packageName: string | undefined,
  fingerprintsRaw: string | undefined,
): Array<AssetLinkStatement> | null {
  if (!packageName || !fingerprintsRaw) return null
  const fingerprints = parseFingerprints(fingerprintsRaw)
  if (fingerprints.length === 0) return null
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]
}
