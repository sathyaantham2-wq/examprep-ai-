import { betterAuth } from 'better-auth'
import { createAuthPool } from '../db/auth-pool'
import { getSharedDb } from '../db/connection'
import { consentsRepository, householdsRepository, studentsRepository } from '../db/repositories'
import { CURRENT_CONSENT_VERSION } from './consent'
import { env } from './env'

export const auth = betterAuth({
  database: createAuthPool(),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Every other table in this schema uses uuid primary keys (see src/db/migrations); without
  // this, better-auth defaults to 32-char random text ids, which can't FK against users.id uuid.
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  // No email confirmation (owner decision 2026-09-20): a new account signs in at once.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // Google is optional in dev — only registered once real OAuth credentials exist.
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  // A brand-new sign-up starts its own household. Which kind of account it is comes from the
  // sign-up form's `signup_type`: 'student' (one student, one login), 'teacher', or anything else
  // -- including Google sign-in and a tampered value -- which is a parent. 'admin' can never be
  // chosen here. household_id/role stay `input: false` below so a payload cannot set them.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const db = getSharedDb()
          const signupType = (user as { signup_type?: string }).signup_type
          const role =
            signupType === 'student'
              ? ('student' as const)
              : signupType === 'teacher'
                ? ('teacher' as const)
                : ('parent' as const)
          const household = await householdsRepository.insert(db, {
            name: `${user.name}'s household`,
            plan: 'free',
          })
          return {
            data: {
              ...user,
              household_id: household.id,
              role,
              signup_type: role,
            },
          }
        },
        // A student gets her profile right away: launch scope is CBSE Class 7, so those are the
        // defaults. The sign-up form makes her confirm a parent or guardian agrees to her using
        // the app; that declaration is recorded as her consent (F095). A guardian who later links
        // to her gives their own consent when they send the invite.
        after: async (user) => {
          const created = user as {
            id: string
            name: string
            household_id?: string
            role?: string
          }
          if (created.role !== 'student' || !created.household_id) return
          const db = getSharedDb()
          const student = await studentsRepository.insert(db, {
            household_id: created.household_id,
            own_household_id: created.household_id,
            user_id: created.id,
            name: created.name,
            class: 7,
            board: 'CBSE',
          })
          await consentsRepository.insert(db, {
            household_id: created.household_id,
            student_id: student.id,
            given_by_user_id: created.id,
            purpose_version: CURRENT_CONSENT_VERSION,
          })
        },
      },
    },
  },
  user: {
    modelName: 'users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      // required: false so better-auth's own request validation doesn't demand these from the
      // client — the databaseHooks.user.create.before hook below always supplies them before the
      // insert reaches Postgres, where the columns are genuinely NOT NULL.
      household_id: { type: 'string', required: false, input: false },
      role: { type: 'string', required: false, input: false },
      auth_provider: { type: 'string', required: false, input: false },
      // Read once at sign-up to pick the account type; never used for authorisation.
      signup_type: { type: 'string', required: false, input: true },
      is_active: {
        type: 'boolean',
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
})
