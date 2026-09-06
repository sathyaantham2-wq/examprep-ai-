import 'dotenv/config'
import { createDb } from './connection'
import { patternsRepository } from './repositories'

// F057: the P1-P6 behaviour pattern library. Only the six names are actually specified in the
// plan (tab03 F057's AC) — descriptions here are working definitions inferred from the name and,
// for First-Plausible Commit, the examprep-question-generation skill's own explanation. Patterns
// live as editable DB rows on purpose (F057: "configurable, not hardcoded"), so refine these
// descriptions directly in the table rather than in code.
const PATTERNS = [
  {
    code: 'P1',
    name: 'One-Idea Stop',
    description:
      'Answer correctly applies the first relevant idea, then stops instead of carrying it through the remaining steps of a multi-step question.',
  },
  {
    code: 'P2',
    name: 'Blank Retreat',
    description:
      'Question is left blank despite partial working being possible — a sign of avoidance rather than a knowledge gap.',
  },
  {
    code: 'P3',
    name: 'First-Plausible Commit',
    description:
      'Student checks one element of a multi-part item (assertion-reason, multi-statement, match-the-following) and commits to an answer without checking the rest.',
  },
  {
    code: 'P4',
    name: 'Label Flip',
    description:
      'Correct method and correct numbers, but labels, signs, or axes are swapped — e.g. x and y, or a dropped negative sign.',
  },
  {
    code: 'P5',
    name: 'Rule Over-Extension',
    description:
      'A rule that is valid in one context is applied outside the scope where it actually holds.',
  },
  {
    code: 'P6',
    name: 'Format Miss',
    description:
      'The mathematics is correct but the required format (units, significant figures, simplest form) is not followed, costing presentation marks.',
  },
] as const

async function main() {
  const db = createDb()
  try {
    for (const pattern of PATTERNS) {
      const existing = await db
        .selectFrom('patterns')
        .select('id')
        .where('code', '=', pattern.code)
        .executeTakeFirst()
      if (existing) {
        console.log(`skip ${pattern.code} — already exists`)
        continue
      }
      const created = await patternsRepository.insert(db, pattern)
      console.log(`created ${pattern.code}: ${created.id}`)
    }
  } finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
