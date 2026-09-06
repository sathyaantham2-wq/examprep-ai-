import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../connection'
import type { Db } from '../connection'
import {
  householdsRepository,
  studentsRepository,
  papersRepository,
  blueprintsRepository,
} from '../repositories'

/**
 * T02: "Household A requests every endpoint with Household B's IDs -> every request denied."
 * This automates that check at the layer that actually enforces it — the repository — rather
 * than standing up the full HTTP/auth stack, per CLAUDE.md's own build-feature invariant: "Query
 * scoping by household is enforced in the repository layer, not the route handler." Every route
 * built this session (students, papers, evaluations, tracker) is a thin wrapper around exactly
 * this pattern, so this is the highest-leverage place to pin it down.
 *
 * Runs against the real dev database (DATABASE_URL) — there's no scratch-DB story for vitest yet
 * (unlike the migrations CI workflow, which spins up its own Postgres service container). Cleans
 * up everything it creates.
 */
describe('household isolation (T02)', () => {
  let db: Db
  let householdA: Awaited<ReturnType<typeof householdsRepository.insert>>
  let householdB: Awaited<ReturnType<typeof householdsRepository.insert>>
  let studentA: Awaited<ReturnType<typeof studentsRepository.insert>>
  let subjectId: string
  let blueprintId: string
  let paperId: string

  beforeAll(async () => {
    db = createDb()

    householdA = await householdsRepository.insert(db, {
      name: 'Isolation Test A',
      plan: 'free',
    })
    householdB = await householdsRepository.insert(db, {
      name: 'Isolation Test B',
      plan: 'free',
    })

    studentA = await studentsRepository.insert(db, {
      household_id: householdA.id,
      name: 'Isolation Kid A',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subjectId,
      board: 'CBSE',
      class: 7,
      name: 'Isolation test blueprint',
      total_marks: 1,
      duration_min: 10,
      sections: JSON.stringify([]),
      bloom_targets: JSON.stringify({}),
    })
    blueprintId = blueprint.id

    const paper = await papersRepository.insert(db, {
      student_id: studentA.id,
      blueprint_id: blueprintId,
      subject_id: subjectId,
      title: 'Isolation test paper',
      total_marks: 1,
      duration_min: 10,
    })
    paperId = paper.id
  })

  afterAll(async () => {
    // households cascades to students cascades to papers (F011 FKs), so deleting the two
    // households is enough — no attempts/evaluations were created here to block it.
    await db
      .deleteFrom('households')
      .where('id', 'in', [householdA.id, householdB.id])
      .execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.destroy()
  })

  it('a household can read its own student', async () => {
    const found = await studentsRepository.findById(
      db,
      householdA.id,
      studentA.id,
    )
    expect(found?.id).toBe(studentA.id)
  })

  it('a different household cannot read that student', async () => {
    const found = await studentsRepository.findById(
      db,
      householdB.id,
      studentA.id,
    )
    expect(found).toBeUndefined()
  })

  it("a different household's student list never includes another household's student", async () => {
    const list = await studentsRepository.list(db, householdB.id)
    expect(list.some((s) => s.id === studentA.id)).toBe(false)
  })

  it('a household can read its own student’s paper', async () => {
    const found = await papersRepository.findByIdForHousehold(
      db,
      householdA.id,
      paperId,
    )
    expect(found?.id).toBe(paperId)
  })

  it('a different household cannot read that paper, even knowing its exact id', async () => {
    const found = await papersRepository.findByIdForHousehold(
      db,
      householdB.id,
      paperId,
    )
    expect(found).toBeUndefined()
  })

  it('an update scoped to the wrong household affects the real row not at all', async () => {
    // createScopedRepository's update uses executeTakeFirstOrThrow, so a cross-household update
    // throws (no row matches the id+scope combination) rather than silently no-opping.
    await expect(
      studentsRepository.update(db, householdB.id, studentA.id, {
        name: 'Should never apply',
      }),
    ).rejects.toThrow()

    const stillOriginal = await studentsRepository.findById(
      db,
      householdA.id,
      studentA.id,
    )
    expect(stillOriginal?.name).toBe('Isolation Kid A')
  })
})
