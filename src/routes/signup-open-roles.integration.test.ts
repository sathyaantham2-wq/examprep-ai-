import { afterAll, describe, expect, it } from 'vitest'
import { auth } from '../lib/auth'
import { createDb } from '../db/connection'

const created: Array<string> = []

function signUp(email: string, signupType?: string) {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: 'correcthorsebatterystaple',
        name: 'Signup Guard Kid',
        ...(signupType ? { signup_type: signupType } : {}),
      }),
    }),
  )
}

/**
 * Owner decision 2026-09-22: parent sign-up reopened over HTTP (it had been student-only since
 * 2026-09-20). Teacher and admin still are not self-serve. Supersedes the old
 * signup-student-only.integration.test.ts, same fixture pattern.
 */
describe('sign-up: student and parent are open, teacher/admin/untyped are not', () => {
  afterAll(async () => {
    const db = createDb()
    for (const email of created) {
      const user = await db.selectFrom('users').select(['id', 'household_id']).where('email', '=', email).executeTakeFirst()
      if (!user) continue
      await db.deleteFrom('consents').where('household_id', '=', user.household_id).execute()
      await db.updateTable('students').set({ user_id: null }).where('user_id', '=', user.id).execute()
      await db.deleteFrom('users').where('id', '=', user.id).execute()
      await db.deleteFrom('households').where('id', '=', user.household_id).execute()
    }
    await db.destroy()
  })

  it('refuses teacher, admin and untyped sign-ups', async () => {
    for (const type of ['teacher', 'admin', undefined]) {
      const email = `guard-${type ?? 'none'}-${Date.now()}@example.com`
      const response = await signUp(email, type)
      expect(response.status).toBe(403)
      const db = createDb()
      const row = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()
      await db.destroy()
      expect(row).toBeUndefined()
    }
  })

  it('accepts a student sign-up', async () => {
    const email = `guard-student-${Date.now()}@example.com`
    created.push(email)
    const response = await signUp(email, 'student')
    expect(response.status).toBe(200)
    const db = createDb()
    const row = await db.selectFrom('users').select('role').where('email', '=', email).executeTakeFirstOrThrow()
    await db.destroy()
    expect(row.role).toBe('student')
  })

  it('accepts a parent sign-up, with her own fresh household and no student yet', async () => {
    const email = `guard-parent-${Date.now()}@example.com`
    created.push(email)
    const response = await signUp(email, 'parent')
    expect(response.status).toBe(200)
    const db = createDb()
    const row = await db
      .selectFrom('users')
      .select(['role', 'household_id'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow()
    expect(row.role).toBe('parent')
    const students = await db
      .selectFrom('students')
      .select('id')
      .where('household_id', '=', row.household_id)
      .execute()
    await db.destroy()
    expect(students).toHaveLength(0)
  })
})
