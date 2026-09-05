import { betterAuth } from 'better-auth'
import { createAuthPool } from '../db/auth-pool'
import { createDb } from '../db/connection'
import { householdsRepository } from '../db/repositories'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const auth = betterAuth({
  database: createAuthPool(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Every other table in this schema uses uuid primary keys (see src/db/migrations); without
  // this, better-auth defaults to 32-char random text ids, which can't FK against users.id uuid.
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    // Resend integration (M16) doesn't exist yet — log the link server-side so sign-up is
    // testable in dev instead of silently stranding every new account unable to verify.
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[auth] verification link for ${user.email}: ${url}`)
    },
  },
  // Google is optional in dev — only registered once real OAuth credentials exist.
  socialProviders:
    googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : undefined,
  // A brand-new sign-up is always a parent starting their own household (F008) — students get
  // added afterwards, they don't self-register into an empty household. household_id/role are
  // `input: false` below precisely so a signup payload can't set them itself.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const db = createDb()
          try {
            const household = await householdsRepository.insert(db, {
              name: `${user.name}'s household`,
              plan: 'free',
            })
            return { data: { ...user, household_id: household.id, role: 'parent' as const } }
          } finally {
            await db.destroy()
          }
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
      is_active: { type: 'boolean', required: false, defaultValue: true, input: false },
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
