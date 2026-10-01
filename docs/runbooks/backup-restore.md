# Backup and restore runbook (F014)

## The short version

| | |
|---|---|
| What is backed up | The whole `public` schema of the production database: every table this app owns, including logins (better-auth `users`, `sessions`, `accounts`), students, papers, answers, marks and the question bank. |
| How often | Every day at 02:00 IST (`.github/workflows/backup.yml`), plus on demand (Actions > Backup > Run workflow). |
| Where | GitHub Actions artifacts named `prepplan-backup-<run number>`, kept **30 days**. |
| Encryption | AES-256 (OpenSSL, PBKDF2 200k). Unreadable without `BACKUP_PASSPHRASE`. |
| Verified | **Every run** restores the backup into a scratch Postgres 17 and checks every table's row count. A backup that can't be restored fails the run, and GitHub emails the owner. |
| Worst-case data loss (RPO) | Up to 24 hours: everything since the last 02:00 backup. |
| Time to restore (RTO) | About 30 minutes for the current size (a 7 MB backup restores in under 15 s; most of the time is creating a project and switching the app over). |
| Point-in-time recovery | **None.** The Supabase project is on the Free plan, which keeps no restorable backups and no PITR. PITR to any second needs Supabase Pro plus the PITR add-on. Until then, the daily backup above is the only copy. |

## One-time setup (owner)

1. Choose a passphrase of 20+ characters. **Store it in two places outside GitHub** (a password
   manager and on paper). If it's lost, every backup is unreadable. If it leaks, anyone with the
   artifacts can read children's data.
2. GitHub repo > Settings > Secrets and variables > Actions > New repository secret:
   - `PROD_DATABASE_URL`: the production `DATABASE_URL` (Supabase session pooler, port 5432)
   - `BACKUP_PASSPHRASE`: the passphrase from step 1
3. Actions > **Backup** > **Run workflow**. It should finish green with an artifact attached.
   That run is the first verified restore of real production data.

## Restoring

Needs Postgres 17 tools (`pg_restore`, `psql`) and `openssl`. On the owner's Windows machine
they're in `C:\Program Files\PostgreSQL\17\bin` (run from Git Bash with
`export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"`).

1. **Download** the backup: Actions > Backup > the run you want (the last green one before the
   problem) > Artifacts > `prepplan-backup-N`. Unzip it to get `prepplan-<time>.dump.enc` and
   `.counts`.
2. **Make an empty target database.** Never restore over the live one: the script refuses it.
   - *Production is lost or corrupted:* create a new Supabase project (region Mumbai,
     `ap-south-1`) and use its session-pooler connection string.
   - *Recovering a few rows or one table:* use a scratch local database:
     `psql <local-url>/postgres -c "create database restore_check"`.
3. **Restore and verify:**
   ```
   TARGET_DATABASE_URL='postgresql://...' BACKUP_PASSPHRASE='...' \
     bash scripts/db-restore.sh prepplan-<time>.dump.enc
   ```
   It ends with `restore verified: all N tables present with the backup's row counts`.
4. **Switch the app over** (full-restore case only): in Vercel, set `DATABASE_URL` to the new
   project's connection string and **Redeploy**. Everyone signs in again. `BETTER_AUTH_SECRET`
   stays the same; changing it would also make stored scan photos unreadable (F097).
5. **Recovering a few rows:** copy them from `restore_check` into production with
   `INSERT ... SELECT` over a `dblink`, or export/import the rows. Check what will change before
   running anything against production.

## Things that can quietly stop backups

- **GitHub disables scheduled workflows** in a repository with no activity for 60 days. A push,
  or re-enabling the workflow under Actions, restarts it.
- **The Supabase Free plan pauses a project** after a period of inactivity. A paused database
  can't be backed up; the run fails and emails the owner. Resume the project in Supabase.
- **A changed database password** (Supabase > Database settings) must also be updated in the
  `PROD_DATABASE_URL` secret.

## Drill

Monthly, or after any schema change: run the workflow by hand and confirm it's green. Once a
quarter, do steps 1-3 on the owner's machine into a scratch database, so restoring has been
practised by a person and not only by CI. The first local drill (on the test database, all 59
tables verified) was run on 2026-10-01.
