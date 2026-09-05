//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      '.output/**',
      '.nitro/**',
      '.tanstack/**',
      '.vinxi/**',
      'dist/**',
      'dist-ssr/**',
    ],
  },
  {
    // F013: no raw untyped SQL in feature code. Everything outside src/db/** goes through the
    // typed repositories in src/db/repositories instead of the pg driver or Kysely directly.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message:
                'Use a repository from src/db/repositories instead of the pg driver directly.',
            },
            {
              name: 'kysely',
              message:
                'Use a repository from src/db/repositories instead of building Kysely queries directly.',
            },
          ],
        },
      ],
    },
  },
]
