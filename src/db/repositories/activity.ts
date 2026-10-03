import { sql } from 'kysely'
import type { Db } from '../connection'

// Longest gap between two pings still counted as continuous use. The browser pings every 30 s, so
// anything beyond this means the tab was hidden or she walked away.
export const MAX_CONTINUOUS_GAP_SECONDS = 75
// Credit for the first ping after a break (or of the day): about one ping interval.
export const RESUME_CREDIT_SECONDS = 30

const TIME_ZONE = 'Asia/Kolkata'

/**
 * Credits one "she is here" ping to a student. Active time is the real time since her previous
 * ping when that was recent, otherwise one ping interval -- so pinging faster than every 30 s
 * adds nothing beyond the wall clock. Stored per day in India time; only a number of seconds is
 * kept, never what she was looking at.
 */
async function recordPing(
  db: Db,
  studentId: string,
): Promise<void> {
  await sql`
    insert into student_activity_daily (student_id, day, active_seconds, pings, first_seen_at, last_seen_at)
    values (${studentId}, (now() at time zone ${TIME_ZONE})::date, ${RESUME_CREDIT_SECONDS}, 1, now(), now())
    on conflict (student_id, day) do update set
      active_seconds = student_activity_daily.active_seconds + (
        case
          when extract(epoch from (now() - student_activity_daily.last_seen_at)) <= ${MAX_CONTINUOUS_GAP_SECONDS}
            then floor(extract(epoch from (now() - student_activity_daily.last_seen_at)))::int
          else ${RESUME_CREDIT_SECONDS}::int
        end
      ),
      pings = student_activity_daily.pings + 1,
      last_seen_at = now()
  `.execute(db)
}


export interface ActivityDay {
  day: string
  active_students: number
  minutes: number
}

export interface ActivityStudentRow {
  student_id: string
  name: string
  class: number
  minutes_in_window: number
  minutes_today: number
  active_days: number
  papers_submitted: number
  last_seen_at: string | null
}

export interface ActivityReport {
  window_days: number
  from: string
  to: string
  /** First day anything was recorded; usage before this was never measured. */
  tracking_since: string | null
  students_with_login: number
  active_today: number
  active_7d: number
  active_window: number
  total_minutes: number
  avg_minutes_per_active_day: number
  daily: Array<ActivityDay>
  students: Array<ActivityStudentRow>
}

const toMinutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10

/** Admin report: how many students used the app, and for how long, over a trailing window. */
async function getReport(
  db: Db,
  windowDays: number,
): Promise<ActivityReport> {
  const todayRow = await sql<{ today: string }>`
    select to_char((now() at time zone ${TIME_ZONE})::date, 'YYYY-MM-DD') as today
  `.execute(db)
  const today = todayRow.rows[0].today

  const bounds = await sql<{ from_day: string }>`
    select to_char(${today}::date - ${windowDays - 1}::int, 'YYYY-MM-DD') as from_day
  `.execute(db)
  const from = bounds.rows[0].from_day

  const dailyRows = await sql<{
    day: string
    active_students: string
    seconds: string
  }>`
    select to_char(d.day, 'YYYY-MM-DD') as day,
           count(*) as active_students,
           coalesce(sum(d.active_seconds), 0) as seconds
    from student_activity_daily d
    where d.day between ${from}::date and ${today}::date
    group by d.day
  `.execute(db)
  const byDay = new Map(dailyRows.rows.map((r) => [r.day, r]))

  const days = await sql<{ day: string }>`
    select to_char(g.day, 'YYYY-MM-DD') as day
    from generate_series(${from}::date, ${today}::date, interval '1 day') as g(day)
    order by g.day
  `.execute(db)
  const daily: Array<ActivityDay> = days.rows.map(({ day }) => {
    const row = byDay.get(day)
    return {
      day,
      active_students: row ? Number(row.active_students) : 0,
      minutes: row ? toMinutes(Number(row.seconds)) : 0,
    }
  })

  const counts = await sql<{
    students_with_login: string
    active_today: string
    active_7d: string
    active_window: string
    seconds: string
    active_days: string
    tracking_since: string | null
  }>`
    select
      (select count(*) from students where user_id is not null) as students_with_login,
      (select count(distinct student_id) from student_activity_daily where day = ${today}::date) as active_today,
      (select count(distinct student_id) from student_activity_daily
         where day between ${today}::date - 6 and ${today}::date) as active_7d,
      (select count(distinct student_id) from student_activity_daily
         where day between ${from}::date and ${today}::date) as active_window,
      (select coalesce(sum(active_seconds), 0) from student_activity_daily
         where day between ${from}::date and ${today}::date) as seconds,
      (select count(*) from student_activity_daily
         where day between ${from}::date and ${today}::date) as active_days,
      (select to_char(min(day), 'YYYY-MM-DD') from student_activity_daily) as tracking_since
  `.execute(db)
  const c = counts.rows[0]
  const totalSeconds = Number(c.seconds)
  const activeDays = Number(c.active_days)

  const studentRows = await sql<{
    student_id: string
    name: string
    class: number
    seconds: string
    seconds_today: string
    active_days: string
    last_seen_at: Date | null
    papers_submitted: string
  }>`
    select s.id as student_id, s.name, s.class,
           coalesce(sum(d.active_seconds), 0) as seconds,
           coalesce(sum(d.active_seconds) filter (where d.day = ${today}::date), 0) as seconds_today,
           count(d.day) as active_days,
           max(d.last_seen_at) as last_seen_at,
           (select count(*) from attempts a
              where a.student_id = s.id and a.submitted_at is not null
                and (a.submitted_at at time zone ${TIME_ZONE})::date between ${from}::date and ${today}::date
           ) as papers_submitted
    from students s
    left join student_activity_daily d
      on d.student_id = s.id and d.day between ${from}::date and ${today}::date
    where s.user_id is not null
    group by s.id, s.name, s.class
    order by seconds desc, s.name
    limit 500
  `.execute(db)

  return {
    window_days: windowDays,
    from,
    to: today,
    tracking_since: c.tracking_since,
    students_with_login: Number(c.students_with_login),
    active_today: Number(c.active_today),
    active_7d: Number(c.active_7d),
    active_window: Number(c.active_window),
    total_minutes: toMinutes(totalSeconds),
    avg_minutes_per_active_day:
      activeDays === 0 ? 0 : toMinutes(totalSeconds / activeDays),
    daily,
    students: studentRows.rows.map((r) => ({
      student_id: r.student_id,
      name: r.name,
      class: r.class,
      minutes_in_window: toMinutes(Number(r.seconds)),
      minutes_today: toMinutes(Number(r.seconds_today)),
      active_days: Number(r.active_days),
      papers_submitted: Number(r.papers_submitted),
      last_seen_at: r.last_seen_at
        ? new Date(r.last_seen_at).toISOString()
        : null,
    })),
  }
}

export const studentActivityRepository = { recordPing, getReport }
