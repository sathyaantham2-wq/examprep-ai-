// F131: facts shared by the public /privacy and /delete-account pages, which Google Play requires
// before listing an app for children (a privacy policy URL, and a web page where anyone who can
// create an account can ask for it to be deleted).
//
// Every statement on those pages was checked against the code on 2026-09-30. If you change what
// data is collected or who processes it, update the pages in the same change. The consent notice
// in src/lib/consent.ts is still marked as placeholder text awaiting review, and so is this policy:
// it describes the product accurately but has not been reviewed by a lawyer.

export const POLICY_LAST_UPDATED = '30 September 2026'

/**
 * Where privacy and deletion requests go. Empty until the owner confirms an address. The pages
 * then say contact details are coming, rather than printing a guessed or personal address.
 * Must be set before the Play listing goes live.
 */
export const SUPPORT_EMAIL = '' as string

/** Services that receive personal data, and why. Keep in step with src/lib/env.ts. */
export const PROCESSORS: Array<{ name: string; purpose: string; where: string }> = [
  {
    name: 'Vercel',
    purpose: 'Runs the website and app servers.',
    where: 'Mumbai, India',
  },
  {
    name: 'Supabase',
    purpose: 'Stores accounts, papers, answers and marks in our database.',
    where: 'Mumbai, India',
  },
  {
    name: 'Google (Gemini API)',
    purpose:
      'Marks written answers, reads photographed handwriting, and writes explanations. It receives the question, the answer and any photo, never a name or email address.',
    where: 'Google servers, which may be outside India',
  },
  {
    name: 'Backup AI providers (Groq, Cerebras, Anthropic, OpenRouter)',
    purpose:
      'Used for the same AI tasks only if Google is unavailable and the provider is switched on. They receive the same information and no more.',
    where: 'Servers that may be outside India',
  },
  {
    name: 'Make.com and Gmail',
    purpose: 'Send account and weekly-summary emails to parents.',
    where: 'Servers that may be outside India',
  },
]
