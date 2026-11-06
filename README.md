# The Golden Girls Book Club

A private website for the club: next meeting, date poll, book and place suggestions
(with AI review summaries), secret ranked-choice voting, potluck sign-ups and comments.

- **Live site:** https://golden-girls-book-club.web.app
- **Firebase project:** `golden-girls-book-club` (Firebase console: https://console.firebase.google.com/project/golden-girls-book-club)
- **Member guide:** "Golden Girls Book Club App Guide" (shared separately)

---

## For the club admin (no coding needed)

### Passwords

There are two shared passwords, kept in Google Cloud **Secret Manager** (never in this code):

| Secret | What it's for |
| --- | --- |
| `MEMBER_PASSWORD` | Everyone uses this to get in |
| `ADMIN_PASSWORD` | Unlocks the admin controls |
| `ANTHROPIC_API_KEY` | Lets the app ask Claude for review summaries |
| `BALLOT_KEY` | A random key that keeps ballots anonymous. Never change it during an open vote. |

**To change a password** (for example if it leaked):

1. Open Terminal in this folder.
2. Run `firebase functions:secrets:set MEMBER_PASSWORD` (or `ADMIN_PASSWORD`) and type the new password when asked.
3. Run `firebase deploy --only functions` so the app picks it up (about 5 minutes).

People who are already signed in stay signed in; new sign-ins need the new password.

### Anthropic (Claude) API key and costs

- Get or replace a key at https://console.anthropic.com → **API Keys**. Store it with
  `firebase functions:secrets:set ANTHROPIC_API_KEY`, then `firebase deploy --only functions`.
- Each review summary costs roughly 10–25 cents. Each book or place is looked up once and
  saved for 90 days, and each member can do at most 25 lookups a day.
- Watch spending at https://console.anthropic.com → **Usage**. You can set a monthly limit there.
- The model is set in `functions/.env` (`REVIEW_MODEL`, currently `claude-opus-5-5`).
  `claude-sonnet-5-5` costs about half as much.

### Firebase costs

The project is on the Blaze (pay-as-you-go) plan. A club this size normally stays within the
free allowances, so the Firebase bill should be $0 or close to it. Set a budget alert in
Google Cloud: **Billing → Budgets & alerts**.

---

## For whoever updates the app

### What's in this folder

| Folder / file | What it is |
| --- | --- |
| `web/` | The website (React + TypeScript, built with Vite) |
| `functions/` | Server code (Cloud Functions). Every change to data goes through here. |
| `functions/src/reviews/` | The review-summary "provider" (Claude today; others can be added) |
| `firestore.rules` | Database security rules: members can only read; nobody can read ballots or PINs |
| `tests/` | Automated tests (vote counting, who-can-do-what, security rules) |

### One-time setup on a new computer

1. Install **Node.js 22** (https://nodejs.org) and **Java 21** (needed by the local test servers).
2. Install the Firebase tools: `npm install -g firebase-tools`, then `firebase login`.
3. In this folder: `npm --prefix functions install`, `npm --prefix web install`, `npm --prefix tests install`.
4. Create `functions/.secret.local` with **test** values (this file is never committed):

   ```
   MEMBER_PASSWORD=member
   ADMIN_PASSWORD=admin
   ANTHROPIC_API_KEY=sk-ant-...
   BALLOT_KEY=any-long-random-text
   ```

### Try changes locally (nothing touches the live site)

```bash
# Terminal 1: local database, sign-in and server code
npm --prefix functions run build
firebase emulators:start --only auth,firestore,functions --import=.emulator-data --export-on-exit=.emulator-data

# Terminal 2: the website
cd web && npm run dev
```

Open http://localhost:5173 and use the password `member` or `admin`. As admin, tap
**Load demo data** in the yellow bar for sample members (PIN 1234), books and a vote.

### Run the tests

```bash
cd tests && npm test
```

### Publish an update to the live site

```bash
firebase deploy
```

That uploads the website, server code and security rules (about 5 minutes). Everyone gets the
new version the next time they open or refresh the page. Club data is not affected.

---

## How it works (short version)

- **Sign-in:** the website silently creates an anonymous Firebase session. Entering the club
  password marks that session as member or admin. Name + 4-digit PIN (stored only as a
  scrambled hash) says which member you are.
- **Security:** the browser can only *read* club data, and only after the password. Every
  change goes through a Cloud Function that checks the password role and that the item belongs
  to you. Password and PIN guesses are rate-limited.
- **Secret ballots:** ballots are stored under a scrambled ID made from the member and a secret
  key, with no name or time attached. Nobody can read them through the app, admins included;
  only the counting function does, and it publishes vote totals only.
- **Vote counting:** instant-runoff. Ties for fewest votes are broken by (1) fewer votes in an
  earlier round, (2) ranked lower on more ballots, (3) a random draw, which the results say.
