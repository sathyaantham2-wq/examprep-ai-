import type { Db } from '../db/connection'

// Anonymous, original, kid-friendly display names -- never a real name (T09-adjacent privacy,
// the whole point of F125's opt-in leaderboard). Short suffix keeps two students who roll the
// same adjective+noun pair apart without needing a DB-level uniqueness guarantee: a repeated
// nickname is a harmless cosmetic collision, not a correctness problem, since rank is by points,
// never by name.
const ADJECTIVES = [
  'Clever', 'Swift', 'Bold', 'Bright', 'Curious', 'Daring', 'Eager', 'Fearless',
  'Gentle', 'Happy', 'Keen', 'Lucky', 'Mighty', 'Nimble', 'Quick', 'Radiant',
  'Sharp', 'Steady', 'Sunny', 'Wise',
]
const NOUNS = [
  'Comet', 'Falcon', 'Tiger', 'Eagle', 'Dolphin', 'Panda', 'Phoenix', 'Otter',
  'Fox', 'Lynx', 'Sparrow', 'Wolf', 'Heron', 'Panther', 'Robin', 'Stag',
  'Cheetah', 'Owl', 'Rabbit', 'Falconet',
]

export function generateNickname(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const suffix = Math.floor(Math.random() * 90 + 10) // 10-99, purely cosmetic disambiguation
  return `${adjective} ${noun} ${suffix}`
}

export interface LeaderboardEntry {
  rank: number
  nickname: string
  points: number
}

export interface LeaderboardView {
  entries: Array<LeaderboardEntry>
  me: { points: number; rank: number | null; optedIn: boolean; nickname: string | null } | null
}

const TOP_N = 20

/**
 * F125 (second slice). The cohort is exactly one subject_id (already "the same board, class and
 * subject" -- see migration 0069's note). Only opted-in students appear in `entries` or count
 * toward anyone else's rank; an opted-out student still sees her own point total privately
 * (`me.optedIn: false`, `me.rank: null`) since the points themselves were earned regardless of
 * whether she has chosen to be compared. Two plain aggregate queries rather than one window-
 * function query -- easier to read and to test, and this table will never be large enough within
 * one subject for it to matter.
 */
export async function getLeaderboard(
  db: Db,
  subjectId: string,
  viewerStudentId: string,
): Promise<LeaderboardView> {
  const totalsByOptedInStudent = await db
    .selectFrom('student_points_ledger')
    .innerJoin('students', 'students.id', 'student_points_ledger.student_id')
    .select(['student_points_ledger.student_id', 'students.leaderboard_nickname'])
    .select((eb) => eb.fn.sum<string>('student_points_ledger.points').as('total_points'))
    .where('student_points_ledger.subject_id', '=', subjectId)
    .where('students.leaderboard_opt_in', '=', true)
    .groupBy(['student_points_ledger.student_id', 'students.leaderboard_nickname'])
    .orderBy('total_points', 'desc')
    .execute()

  const ranked = totalsByOptedInStudent.map((row, i) => ({
    rank: i + 1,
    studentId: row.student_id,
    nickname: row.leaderboard_nickname ?? 'Anonymous Learner',
    points: Number(row.total_points),
  }))

  const entries: Array<LeaderboardEntry> = ranked.slice(0, TOP_N).map((r) => ({
    rank: r.rank,
    nickname: r.nickname,
    points: r.points,
  }))

  // The caller (the leaderboard API route) has already checked this viewerStudentId belongs to
  // the requesting student or her parent's household -- this lookup just needs her own opt-in
  // flag and nickname, not a repeat of that household check, so it goes straight to the table
  // rather than through the household-scoped studentsRepository (same precedent as
  // evaluation.ts/auto-confirm.ts/diagnosis.ts and others).
  const viewer = await db
    .selectFrom('students')
    .select(['leaderboard_opt_in', 'leaderboard_nickname'])
    .where('id', '=', viewerStudentId)
    .executeTakeFirst()
  const myRankedRow = ranked.find((r) => r.studentId === viewerStudentId)
  // Rolled up within THIS subject cohort only -- studentPointsLedgerRepository.totalForStudent()
  // sums across every subject a student has points in, which is not what a per-subject
  // leaderboard should show.
  const myTotalInSubject = await db
    .selectFrom('student_points_ledger')
    .select((eb) => eb.fn.sum<string>('points').as('total_points'))
    .where('subject_id', '=', subjectId)
    .where('student_id', '=', viewerStudentId)
    .executeTakeFirst()

  const me = viewer
    ? {
        points: Number(myTotalInSubject?.total_points ?? 0),
        rank: myRankedRow?.rank ?? null,
        optedIn: viewer.leaderboard_opt_in,
        nickname: viewer.leaderboard_nickname,
      }
    : null

  return { entries, me }
}
