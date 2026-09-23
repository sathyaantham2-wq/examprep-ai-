// Runs a command with .env.test loaded instead of .env, so db:migrate / db:seed can target the
// local test database without a developer having to remember to swap .env around (the swap being
// exactly how test fixtures ended up in the real users' database before 2026-09-23).
//
// A plain `DATABASE_URL=... npm run x` prefix is bash-only and breaks on Windows, and adding
// cross-env just for this is a dependency for six lines of code -- hence this wrapper.
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { config } from 'dotenv'

if (!existsSync('.env.test')) {
  console.error(
    'No .env.test found. Copy .env.test.example to .env.test and point it at your local Postgres first.',
  )
  process.exit(1)
}

config({ path: '.env.test', override: true })

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname
  } catch {
    return ''
  }
})()
if (!['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) {
  console.error(
    `.env.test DATABASE_URL must point at a local database, got host: ${host || '(unparseable)'}`,
  )
  process.exit(1)
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('Usage: node scripts/with-test-env.mjs <command> [args...]')
  process.exit(1)
}

const child = spawn(command, args, { stdio: 'inherit', shell: true, env: process.env })
child.on('exit', (code) => process.exit(code ?? 1))
