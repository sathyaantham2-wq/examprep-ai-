import { Link, createFileRoute } from '@tanstack/react-router'
import { PublicPage } from '../components/public-page'
import { POLICY_LAST_UPDATED, PROCESSORS, SUPPORT_EMAIL } from '../lib/legal'

// F131: the public privacy policy Google Play requires (Families Policy). Readable signed out.
// Facts live in src/lib/legal.ts; see its header before changing anything here.
export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy policy · PrepPlan' }] }),
  component: PrivacyPolicy,
})

function PrivacyPolicy() {
  return (
    <PublicPage title="Privacy policy" updated={POLICY_LAST_UPDATED}>
      <p>
        PrepPlan makes practice question papers for school students, marks their answers,
        and shows a parent which marks were lost for not knowing a topic and which for how the
        answer was written. This policy explains what we collect, why, who else sees it, and how
        to get it back or delete it. It covers the website and the Android app, which is the same
        service.
      </p>

      <h2>Children</h2>
      <p>
        PrepPlan is used by school students, most of them under 18. A student can only sign
        up after confirming that a parent or guardian agrees, and we record that confirmation.
        A parent can link to a student's account and see her papers and results. We never show
        ads, never sell data, and never use it for anything except running and improving this
        service.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, email address and password (stored only as a
          secure hash). If you sign in with Google, we receive your name, email address and
          profile picture from Google.
        </li>
        <li>
          <strong>Student profile:</strong> name, board, class and, if entered, school.
        </li>
        <li>
          <strong>Learning records:</strong> the papers generated, the answers typed or chosen,
          marks, marking notes, which topics need more work, study plans, points, and any
          question she reports or marks she disputes.
        </li>
        <li>
          <strong>Photos of handwritten answers:</strong> a single answer photographed on the
          answer screen is sent to our AI provider to read, and only the text is kept. Photos of a
          whole written paper are kept, encrypted, so the answers read from them can be checked
          side by side with the handwriting. They can only be viewed by the student and her
          household, and are deleted automatically 30 days after upload. The text read from them
          stays as her answers.
        </li>
        <li>
          <strong>Technical records:</strong> the IP address and browser of each signed-in
          session, error reports (the page and what went wrong), and a record of key actions
          such as a paper being generated or marked, so we can fix problems and keep an audit
          trail.
        </li>
      </ul>

      <h2>What we don't do</h2>
      <ul>
        <li>No advertising and no advertising or analytics companies' tracking code.</li>
        <li>We never sell or rent personal data.</li>
        <li>
          Leaderboards are optional and show only a random nickname (like "Swift Falcon 42"),
          never a real name.
        </li>
        <li>AI providers never receive a student's name or email address.</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>
        We use one cookie to keep you signed in. The app also remembers a few settings on your
        own device, such as light/dark theme and whether sounds are on. There are no tracking
        cookies.
      </p>

      <h2>Who else processes data</h2>
      <p>These services handle data for us, only to provide PrepPlan:</p>
      <ul>
        {PROCESSORS.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong> ({p.where}): {p.purpose}
          </li>
        ))}
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep records for as long as the account exists, because a student's progress over
        time is the point of the service. When an account is deleted, its data is removed from
        our database straight away. It may remain in encrypted database backups for a short
        time until they are overwritten. We keep a minimal record that a deletion happened (the
        household name, who asked and when) so we can show it was done.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>
          <strong>See and download:</strong> a parent can download all of the household's data
          from Settings.
        </li>
        <li>
          <strong>Correct:</strong> names and profile details can be changed in the app.
        </li>
        <li>
          <strong>Delete:</strong> see <Link to="/delete-account">how to delete an account</Link>
          .
        </li>
        <li>
          <strong>Withdraw consent:</strong> a parent can withdraw consent at any time by
          deleting the account, or by contacting us.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Data travels encrypted (HTTPS) and is stored in a managed database. Every request is
        checked on our server so that one household can never see another's data, and a student
        can never see an answer key before her attempt is finished and marked.
      </p>

      <h2>Contact us</h2>
      {SUPPORT_EMAIL ? (
        <p>
          For any privacy question or request, email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We reply within 7 days.
        </p>
      ) : (
        <p>Contact details will be added here before the Android app is published.</p>
      )}

      <h2>Changes</h2>
      <p>
        If this policy changes, we will update the date at the top. If a change affects how a
        child's data is used, we will ask for consent again.
      </p>
    </PublicPage>
  )
}
