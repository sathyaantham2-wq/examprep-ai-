// F095: DPDP consent capture. This constant is the mechanism's source of truth, not legal
// copy -- the actual wording here is a placeholder and MUST be replaced by real privacy-notice
// text reviewed by counsel before this product processes a real child's data. What this file
// guarantees structurally: every consent event is pinned to a specific version string, so
// changing the notice later never silently rewrites what an earlier consent said (see
// migrations/0040_consents.ts).
export const CURRENT_CONSENT_VERSION = '2026-09-06-v1'

export const CONSENT_NOTICE = {
  version: CURRENT_CONSENT_VERSION,
  purpose:
    'We use your child’s name, class, school, and exam performance data to generate ' +
    'practice papers, mark attempts, and track which concepts need more work.',
  retention:
    'Performance and evaluation records are kept for as long as the account is active, plus ' +
    'the time needed to meet legal record-keeping requirements, and are never sold or shared ' +
    'with third parties for advertising.',
}
