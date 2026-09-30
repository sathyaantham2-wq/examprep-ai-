import { describe, expect, it } from 'vitest'
import { buildAssetLinks, parseFingerprints } from './android'

const A = Array.from({ length: 32 }, () => 'AB').join(':')
const B = Array.from({ length: 32 }, () => '0f').join(':')

describe('F131 assetlinks.json', () => {
  it('is null until both the package name and a fingerprint are configured', () => {
    expect(buildAssetLinks(undefined, A)).toBeNull()
    expect(buildAssetLinks('app.example', undefined)).toBeNull()
    expect(buildAssetLinks('app.example', ' , ')).toBeNull()
  })

  it('publishes every configured fingerprint, uppercased and de-duplicated', () => {
    const body = buildAssetLinks('app.example', `${A}, ${B}, ${A.toLowerCase()}`)
    expect(body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.example',
          sha256_cert_fingerprints: [A, B.toUpperCase()],
        },
      },
    ])
  })

  it('rejects a malformed fingerprint instead of publishing one that verifies nothing', () => {
    expect(() => parseFingerprints('AB:CD')).toThrow(/malformed/)
    expect(() => parseFingerprints(A.replace(/:/g, ''))).toThrow(/malformed/)
  })
})
