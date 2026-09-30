import { Link, createFileRoute } from '@tanstack/react-router'
import { PublicPage } from '../components/public-page'
import { POLICY_LAST_UPDATED, SUPPORT_EMAIL } from '../lib/legal'

// F131: Google Play requires a web page, reachable without the app, that explains how to delete
// an account and its data. Deletion itself is F098 (/settings, POST /api/privacy/delete).
export const Route = createFileRoute('/delete-account')({
  head: () => ({ meta: [{ title: 'Delete your account · ExamPrep AI' }] }),
  component: DeleteAccount,
})

function DeleteAccount() {
  return (
    <PublicPage title="Delete your account" updated={POLICY_LAST_UPDATED}>
      <p>
        You can delete an ExamPrep AI account and all of its data at any time, from the website
        or the Android app.
      </p>

      <h2>Parents</h2>
      <ol>
        <li>
          <Link to="/">Sign in</Link> with your parent account.
        </li>
        <li>
          Open <strong>Settings</strong>.
        </li>
        <li>
          Under <strong>Delete your account</strong>, type your household's name to confirm, and
          press <strong>Permanently delete my household</strong>.
        </li>
      </ol>
      <p>
        You can first download a copy of everything from the same page (
        <strong>Export your data</strong>).
      </p>

      <h2>Students</h2>
      <p>
        If a parent is linked to your account, ask them to delete it from their Settings. If you
        signed up on your own,{' '}
        {SUPPORT_EMAIL ? (
          <>
            email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from your account's
            email address and we will delete it
          </>
        ) : (
          <>contact us (details below) from your account's email address and we will delete it</>
        )}
        .
      </p>

      <h2>What gets deleted</h2>
      <p>
        Everything that belongs to the household is removed from our database straight away:
        sign-in details, student profiles, papers, answers, marks, study plans, reports and
        points. It may stay in encrypted backups for a short time until they are overwritten.
        We keep only a minimal record that the deletion happened (the household name, who asked
        and when). This can't be undone.
      </p>

      <h2>Deleting some data, not the account</h2>
      <p>
        To remove particular records without closing the account,{' '}
        {SUPPORT_EMAIL ? (
          <>
            email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </>
        ) : (
          'contact us'
        )}{' '}
        and tell us what you want removed.
      </p>

      {!SUPPORT_EMAIL && (
        <p>Contact details will be added here before the Android app is published.</p>
      )}

      <p>
        See also our <Link to="/privacy">privacy policy</Link>.
      </p>
    </PublicPage>
  )
}
