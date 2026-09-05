import 'dotenv/config'
import { createDb } from './connection'
import {
  subjectsRepository,
  sourcesRepository,
  chaptersRepository,
  chapterScopeRepository,
  conceptsRepository,
} from './repositories'

// Minimal fixture for exercising the M04 syllabus routes end to end. This is NOT approved
// curriculum content — real chapter scope must come from /examprep-ingest-source +
// /examprep-scope-authoring against an actual textbook (see that skill's own warning against
// authoring scope from memory). Names are marked "(seed)" so nobody mistakes this for real data.
async function main() {
  const db = createDb()
  try {
    const subject = await subjectsRepository.insert(db, {
      board: 'CBSE',
      class: 7,
      name: 'Mathematics (seed)',
      code: 'MATH-SEED',
      language: 'English',
    })

    const source = await sourcesRepository.insert(db, {
      subject_id: subject.id,
      publisher: 'Seed Publisher',
      title: 'Seed Textbook',
      edition: 'Seed Edition',
      year: 2026,
    })

    const chapterOne = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: source.id,
      part: 'I',
      chapter_no: 1,
      name: 'Sample Chapter — Fractions (seed)',
      order_index: 1,
    })

    const chapterTwo = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: source.id,
      part: 'I',
      chapter_no: 2,
      name: 'Sample Chapter — Decimals (seed)',
      order_index: 2,
    })

    await chapterScopeRepository.insertMany(db, [
      {
        chapter_id: chapterOne.id,
        kind: 'IN',
        item_text: 'Add and subtract fractions with unlike denominators (seed)',
        page_ref: '1-5',
      },
      {
        chapter_id: chapterOne.id,
        kind: 'OUT',
        item_text: 'Multiplication and division of fractions (seed)',
        page_ref: undefined,
      },
    ])

    await conceptsRepository.insert(db, {
      chapter_id: chapterOne.id,
      board: 'CBSE',
      class: 7,
      code: 'C7M-1.1-SEED',
      name: 'Adding unlike fractions (seed)',
      description: 'Find a common denominator, then add.',
      difficulty_base: 'Easy',
      idea: 'Fractions need the same denominator before adding.',
      rule: 'Convert to the LCM of the denominators, then add numerators.',
      example: '1/2 + 1/3 = 3/6 + 2/6 = 5/6',
    })

    console.log('Seeded subject:', subject.id)
    console.log('Seeded chapters:', chapterOne.id, chapterTwo.id)
  } finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
