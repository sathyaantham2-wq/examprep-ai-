import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { createDb } from './connection'
import { habitsRepository } from './repositories'

// F058: the H1-H10 presentation habit library. Only the fact that ten habits exist (named H1-
// H10) is actually specified in the plan (tab00/tab02/tab04/tab08 all reference "presentation
// habits H1-H10" by name, never by content) -- these descriptions are working definitions
// inferred from that context and from F060's own hint that H7-H10 specifically cover reading
// discipline ("reversal-word questions (NOT/least/false)"), following the exact same pattern
// seed-patterns.ts already established for P1-P6. Habits live as editable DB rows on purpose
// (F058: "habits are editable records, not code constants") -- refine these directly in the
// table, not in code.
const HABITS = [
  {
    code: 'H1',
    name: 'Shows Working',
    description:
      'Intermediate steps are written down, not just a final answer.',
    target_behaviour:
      'Write every step that leads to the answer, even ones that feel obvious.',
  },
  {
    code: 'H2',
    name: 'States Units',
    description:
      'Final answers to quantity-based questions carry the correct unit.',
    target_behaviour: 'Attach a unit to every numeric answer that has one.',
  },
  {
    code: 'H3',
    name: 'Labels Diagrams',
    description:
      'Diagrams carry labelled points, sides, or angles as the question requires.',
    target_behaviour:
      'Label every point, length, or angle a diagram question asks for.',
  },
  {
    code: 'H4',
    name: 'Underlines Final Answer',
    description:
      'The final answer is visually distinguished from the working above it.',
    target_behaviour:
      'Underline or box the final answer so it is unmistakable.',
  },
  {
    code: 'H5',
    name: 'Attempts Every Question',
    description:
      'No question is left blank without at least a partial attempt.',
    target_behaviour:
      'Write something -- even a formula or a first step -- before moving on.',
  },
  {
    code: 'H6',
    name: 'Manages Time Across Sections',
    description:
      'Later sections are not rushed or left incomplete because of time spent earlier.',
    target_behaviour:
      'Check the clock against the marks remaining, not just the questions remaining.',
  },
  {
    code: 'H7',
    name: 'Reads the Full Question First',
    description:
      'The question is read to the end before working begins, catching multi-part instructions.',
    target_behaviour:
      'Read every line of a question, including the last one, before starting to answer.',
  },
  {
    code: 'H8',
    name: 'Catches Reversal Words',
    description:
      'Words like NOT, least, false, or except are noticed and answered to, rather than the more common positive form of the question.',
    target_behaviour:
      'Circle or underline NOT/least/false/except before choosing an answer.',
  },
  {
    code: 'H9',
    name: 'Checks Option Plausibility',
    description:
      'In an MCQ, options are compared against the question rather than the first plausible-looking one being picked.',
    target_behaviour:
      'Eliminate options that are clearly wrong before committing to one.',
  },
  {
    code: 'H10',
    name: 'Reviews Before Submitting',
    description:
      'Time is set aside at the end to re-check answers, not just to finish writing.',
    target_behaviour:
      'Reread each answer once against its question before the paper is handed in.',
  },
] as const

export async function seedHabits(): Promise<void> {
  const db = createDb()
  try {
    for (const habit of HABITS) {
      const existing = await db
        .selectFrom('habits')
        .select('id')
        .where('code', '=', habit.code)
        .executeTakeFirst()
      if (existing) {
        console.log(`skip ${habit.code} — already exists`)
        continue
      }
      const created = await habitsRepository.insert(db, habit)
      console.log(`created ${habit.code}: ${created.id}`)
    }
  } finally {
    await db.destroy()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  seedHabits().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
