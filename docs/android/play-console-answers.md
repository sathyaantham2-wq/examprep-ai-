# Google Play Console: answers for ExamPrep AI (F131)

Drafted 2026-09-30 from the code, not from memory. Every "Yes" below has a source in the repo.
If what the app collects changes, update this file, `src/lib/legal.ts` and the Play form together.

**Before submitting, resolve the open items at the bottom.** Two of them block approval.

---

## App content

| Section | Answer |
|---|---|
| Privacy policy URL | `https://<domain>/privacy` |
| Ads | **No**, the app contains no ads |
| App access | Some features need sign-in. Give reviewers a test **parent** and a test **student** login (create both on production, with a linked student who has one marked paper) |
| Content rating (IARC) | Category *Education*. No violence, sexual content, profanity, drugs, gambling or user-to-user chat. Users can't talk to each other; the leaderboard shows random nicknames only. Expect **Everyone / 3+** |
| Target audience | **Includes under 13** (ages 9–12 and 13–15, plus 16–17). This puts the app under the **Families Policy** |
| Appeals to children? | Yes |
| News app / Government app / Financial features / Health | No / No / No / No |
| Data safety | See below |
| Account deletion URL | `https://<domain>/delete-account` |

### Families Policy checks

- No ads SDKs and no third-party analytics SDKs. The Android app contains only `androidx.browser` +
  `android-browser-helper`, so there's nothing to declare.
- No precise location. The app never asks for location.
- The only runtime permission requested is notifications (Android 13+). The camera is used through
  the browser's file picker, not an app permission.
- Children's data goes to AI providers for marking. See open item 3.

---

## Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all user data encrypted in transit?** Yes (HTTPS only).
**Do you provide a way for users to request that their data is deleted?** Yes, in-app (Settings)
and at `/delete-account`. See open item 1.

"Shared" means given to a third party for *their own* use. Vercel, Supabase, the AI providers and
Make.com act for us as service providers, so under Google's definitions **nothing is shared**.

| Data type | Collected | Shared | Optional? | Purposes | Source in code |
|---|---|---|---|---|---|
| Personal info › **Name** | Yes | No | Required | App functionality, Account management | `users.name`, `students.name` |
| Personal info › **Email address** | Yes | No | Required | Account management, Developer communications | `users.email`, weekly summary email |
| Personal info › **User IDs** | Yes | No | Required | App functionality, Account management | account uuid |
| Photos and videos › **Photos** | Yes, **processed ephemerally** | No | Optional | App functionality | `api/attempts/$id/answer-image.ts`: sent to AI, text kept, photo not stored |
| App activity › **App interactions** | Yes | No | Required | Analytics, App functionality | `product_events`, audit log |
| App activity › **Other user-generated content** (answers, reports, disputes) | Yes | No | Required | App functionality | `attempt_answers`, `question_reports` |
| App info and performance › **Crash logs** | Yes | No | Required | App functionality | `error_log` (self-hosted) |
| App info and performance › **Diagnostics** | Yes | No | Required | App functionality | error context, browser |
| Device or other IDs | Yes (IP address + browser of each session) | No | Required | Fraud prevention, security | better-auth `session` table |

Not collected: location, contacts, financial info, health, messages, audio, files/docs, calendar,
web browsing history, installed apps.

---

## Store listing

**App name** (30 chars max): `ExamPrep AI: Practice Papers`

**Short description** (80 max):
> Syllabus-exact practice papers, marked question by question, with what to fix.

**Full description:**
> ExamPrep AI makes practice question papers that match your child's NCERT textbook exactly, chapter by chapter, for CBSE Classes 6 to 10.
>
> After each paper, every answer is marked question by question, and ExamPrep AI tells you something a score alone never shows: which marks were lost because a topic wasn't understood, and which were lost because of how the answer was written (a missing step, a missing unit, stopping too early).
>
> • Papers for Maths, Science and Social Science, built only from the chapters you choose
> • Answer on the phone, or print the paper and photograph handwritten answers
> • Marks with a reason for each one. You can ask for any mark to be checked again
> • A topic tracker that shows what's improving and what needs more practice
> • Adaptive practice that focuses on weak topics without skipping the rest
> • A weekly summary for parents
>
> Made for students and their parents. No ads. Leaderboards are optional and use random nicknames, never real names.

**Telugu full description (optional localized listing, te-IN):**
> ExamPrep AI మీ పిల్లల NCERT పాఠ్యపుస్తకానికి సరిగ్గా సరిపోయే ప్రాక్టీస్ ప్రశ్నాపత్రాలను అధ్యాయం వారీగా తయారుచేస్తుంది. ఇది CBSE 6 నుండి 10వ తరగతి వరకు.
>
> ప్రతి పేపర్ తర్వాత ప్రతి జవాబు ప్రశ్న వారీగా మార్క్ చేయబడుతుంది. ఏ మార్కులు విషయం అర్థం కాక పోయాయి, ఏవి జవాబు రాసే విధానం వల్ల (ఒక స్టెప్ వదిలేయడం, యూనిట్ మర్చిపోవడం, ముందే ఆపేయడం) పోయాయి అనేది ExamPrep AI స్పష్టంగా చెబుతుంది.
>
> • గణితం, సైన్స్, సోషల్ సైన్స్. మీరు ఎంచుకున్న అధ్యాయాల నుంచే పేపర్లు
> • ఫోన్‌లోనే జవాబు రాయవచ్చు, లేదా ప్రింట్ తీసి చేతిరాత జవాబుల ఫోటో పంపవచ్చు
> • ప్రతి మార్కుకు కారణం చూపిస్తుంది. ఏ మార్కునైనా మళ్ళీ చెక్ చేయమని అడగవచ్చు
> • ఏ టాపిక్ మెరుగవుతోంది, దేనికి ఇంకా ప్రాక్టీస్ కావాలో చూపే ట్రాకర్
> • తల్లిదండ్రులకు వారపు సారాంశం
>
> ప్రకటనలు లేవు. లీడర్‌బోర్డ్ ఐచ్ఛికం, అందులో నిజమైన పేర్లు కాకుండా యాదృచ్ఛిక నిక్‌నేమ్‌లు మాత్రమే ఉంటాయి.

**Category:** Education. **Tags:** Education, Exam prep.
**Contact email:** required, the same address as `SUPPORT_EMAIL` (open item 2).

**Graphics still needed:** 512×512 icon (use `public/icon-512.png`), 1024×500 feature graphic, and
at least 2 phone screenshots (take them from a real signed-in account after launch data exists;
don't use test fixtures with fake names).

---

## Open items: owner decisions

1. **Blocker: student self-deletion.** Play requires that anyone who can create an account can
   delete it. A student who signs up alone gets her own household with role `student`, and
   `POST /api/privacy/delete` only allows `parent`/`admin`. `/delete-account` currently tells her to
   contact us, which Play accepts only if requests are actually honoured. The better fix is in-app
   deletion for a student who is alone in her own household (no linked guardian); a linked student
   still goes through her parent. This needs the owner's go-ahead, because deletion is irreversible.
2. **Blocker: support email.** Play needs a contact address, and `/privacy` and `/delete-account`
   need one too. Set `SUPPORT_EMAIL` in `src/lib/legal.ts`.
3. **Risk: AI data use.** Production uses Google Gemini (24 calls in `ai_jobs`, all Gemini). If
   that is Gemini's **free** tier, Google's terms allow it to use submitted content to improve its
   products. That content is children's answers and handwriting photos. A paid Gemini API tier
   doesn't do this. Recommendation: switch to a paid tier before launch.
4. **Legal review.** `/privacy` is accurate to the code, but like the consent notice in
   `src/lib/consent.ts` it hasn't been reviewed by a lawyer. The DPDP Act has specific rules for
   children's data (verifiable parental consent).
