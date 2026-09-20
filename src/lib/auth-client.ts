import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'

// signup_type is the one extra sign-up field: 'student', 'parent' or 'teacher'. The server decides
// what it means and never lets it reach 'admin'.
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: { signup_type: { type: 'string', required: false } },
    }),
  ],
})
export const { useSession, signIn, signUp, signOut } = authClient
