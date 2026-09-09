import { createHash } from 'node:crypto'
import type { Db } from '../db/connection'

/**
 * F023: "exact-hash ... check on save." Normalizes whitespace/case before hashing so "What is
 * 2+2?" and "what is  2+2?" (extra space, different case) are recognised as the same question --
 * anything beyond that (paraphrases, reordered options) needs the embedding-similarity half of
 * the AC, which needs an AI provider (no ANTHROPIC_API_KEY configured) and isn't built.
 */
export function computeTextHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized).digest('hex')
}

export interface DuplicateMatch {
  id: string
  text: string
  status: string
}

/**
 * Scoped to the same concept -- the same question text is a real duplicate within one concept,
 * but two different concepts can legitimately share a worked example (e.g. a generic "simplify
 * this fraction" prompt), so a global text match isn't actually evidence of duplication.
 */
export async function findExactDuplicate(
  db: Db,
  conceptId: string,
  textHash: string,
  excludeQuestionId?: string,
): Promise<DuplicateMatch | undefined> {
  let query = db
    .selectFrom('questions')
    .select(['id', 'text', 'status'])
    .where('concept_id', '=', conceptId)
    .where('text_hash', '=', textHash)
    .where('status', '!=', 'retired')

  if (excludeQuestionId) {
    query = query.where('id', '!=', excludeQuestionId)
  }

  return query.executeTakeFirst()
}
