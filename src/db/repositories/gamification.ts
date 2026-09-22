import type { Selectable } from 'kysely'
import type { Db } from '../connection'
import type { DB } from '../types'
import { createScopedRepository } from './factory'

// F125 (first slice). Append-only ledger (CLAUDE.md invariant 4) -- insert only, no update method
// even though createScopedRepository would offer one. Leaderboard aggregation (a later pass)
// reads this scoped by student and rolls it up across students in the same cohort itself; this
// repository only ever writes and reads one student's own rows.
const student_points_ledger = createScopedRepository('student_points_ledger', 'student_id')
export const studentPointsLedgerRepository = {
  findById: student_points_ledger.findById,
  list: student_points_ledger.list,
  insert: student_points_ledger.insert,
  async totalForStudent(db: Db, studentId: string) {
    const rows = await db
      .selectFrom('student_points_ledger')
      .select(['points', 'coins'])
      .where('student_id', '=', studentId)
      .execute()
    return rows.reduce(
      (sum, r) => ({ points: sum.points + r.points, coins: sum.coins + r.coins }),
      { points: 0, coins: 0 },
    )
  },
}

export type StudentPointsLedgerRow = Selectable<DB['student_points_ledger']>
