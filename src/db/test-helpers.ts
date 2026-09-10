import { auth } from '../lib/auth'
import { createDb } from './connection'

/**
 * Shared fixture helpers for integration tests that need a real, working session — not a mock —
 * so route handlers exercise their actual auth.api.getSession() call. Everything here goes
 * through better-auth's in-process API (auth.api.*), the same functions the real /api/auth/$
 * catch-all route calls, rather than reaching into the database directly, so a real session
 * cookie comes out the other end.
 */

export const TEST_PASSWORD = 'correcthorsebatterystaple'

export interface TestSession {
  cookie: string
  userId: string
  householdId: string
  email: string
  password: string
}

/** Signs up, captures the verification link from the console (there's no email provider — see
 * src/lib/auth.ts's sendVerificationEmail stub), verifies, and signs in. Every fresh sign-up is
 * a parent starting a new household, per the databaseHooks in src/lib/auth.ts. */
export async function createParentSession(
  namePrefix: string,
): Promise<TestSession> {
  const email = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  let verificationUrl = ''
  const originalLog = console.log
  console.log = (...args: Array<unknown>) => {
    const line = args.join(' ')
    const match = /verification link for [^:]+: (\S+)/.exec(line)
    if (match) verificationUrl = match[1]
  }
  const signUp = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name: `${namePrefix} test user` },
  })
  console.log = originalLog

  const token = new URL(verificationUrl).searchParams.get('token')
  if (!token) throw new Error('No verification link was captured from sign-up')
  await auth.api.verifyEmail({ query: { token } })

  const signIn = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true,
  })
  const cookie = signIn.headers.get('set-cookie')
  if (!cookie) throw new Error('Sign-in did not return a session cookie')

  // household_id is typed loosely by better-auth's additionalFields (it doesn't know our
  // databaseHooks always sets it) — asserted here since it's genuinely never absent in practice.
  const householdId = signUp.user.household_id as string

  return {
    cookie: cookie.split(';')[0],
    userId: signUp.user.id,
    householdId,
    email,
    password: TEST_PASSWORD,
  }
}

/**
 * There's no self-service student login yet (F112 isn't built), so this mirrors exactly what
 * every manual verification this session did by hand: insert a student-role user + credential
 * account directly, link it to the student profile, then sign in for real through better-auth so
 * the resulting session is genuine.
 */
export async function createStudentSession(
  namePrefix: string,
  householdId: string,
  studentId: string,
): Promise<TestSession> {
  const { hashPassword } = await import('better-auth/crypto')
  const db = createDb()
  try {
    const email = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
    const hash = await hashPassword(TEST_PASSWORD)

    const user = await db
      .insertInto('users')
      .values({
        household_id: householdId,
        email,
        name: `${namePrefix} test student`,
        role: 'student',
        email_verified: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    await db
      .insertInto('accounts')
      .values({
        issuer: 'local:credential',
        account_id: user.id,
        provider_id: 'credential',
        user_id: user.id,
        password: hash,
      })
      .execute()

    await db
      .updateTable('students')
      .set({ user_id: user.id })
      .where('id', '=', studentId)
      .execute()

    const signIn = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      asResponse: true,
    })
    const cookie = signIn.headers.get('set-cookie')
    if (!cookie) throw new Error('Sign-in did not return a session cookie')

    return {
      cookie: cookie.split(';')[0],
      userId: user.id,
      householdId,
      email,
      password: TEST_PASSWORD,
    }
  } finally {
    await db.destroy()
  }
}

export async function promoteToAdmin(userId: string): Promise<void> {
  const db = createDb()
  try {
    await db
      .updateTable('users')
      .set({ role: 'admin' })
      .where('id', '=', userId)
      .execute()
  } finally {
    await db.destroy()
  }
}
