# QuizClash

A live, Kahoot-style quiz game for team events. One host screen, players join
from their phones with a PIN, real-time sync via Firebase.

This guide takes you from zero to `quiz.yourteam.com` running for your next
event. Total cost: **$0–15/year** (just the domain — Firebase and Vercel free
tiers comfortably cover a team-sized game).

---

## 0. What you'll end up with

- A Firebase project (free "Spark" plan) doing real-time sync — no server to run or maintain.
- The app deployed on Vercel (free), auto-redeployed whenever you push code changes.
- Your own domain pointed at it, e.g. `quiz.yourteam.com`.

## 1. Create the Firebase project (~5 min)

1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it (e.g. `quizclash`), disable Google Analytics (not needed), create it.
3. In the left sidebar, go to **Build → Firestore Database → Create database**.
   - Choose a region close to your team.
   - Start in **test mode** for now (we'll apply the real rules below).
4. Go to **Project settings** (gear icon) → scroll to **Your apps** → click the
   `</>` (web) icon → register an app (nickname doesn't matter, no hosting needed).
5. Firebase shows you a config object with `apiKey`, `authDomain`, etc. — copy
   these into a `.env` file in this project (copy `.env.example` to `.env` first).
6. Back in Firestore, go to the **Rules** tab and paste in the contents of
   `firestore.rules` from this project, then **Publish**.

## 2. Run it locally

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. Open it in a second tab/phone to test host +
player at once (both need network access to the same Firebase project, which
they'll have automatically).

## 3. Put the code on GitHub

Vercel deploys straight from a Git repo.

```bash
git init
git add .
git commit -m "QuizClash"
```

Create a new repo on https://github.com/new, then:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

## 4. Deploy on Vercel (~5 min)

1. Go to https://vercel.com, sign up/log in with GitHub.
2. **Add New → Project**, import the repo you just pushed.
3. Vercel auto-detects Vite — leave build settings as default.
4. Before deploying, add your Firebase values as **Environment Variables**
   (same names as `.env.example`): `VITE_FIREBASE_API_KEY`, etc.
5. Click **Deploy**. You'll get a live URL like `quizclash-xyz.vercel.app`
   immediately — that already works for a real game if you don't need a
   custom domain yet.

## 5. Buy a domain (if you don't have one)

Any registrar works. Cheap, no-frills options:

- **Cloudflare Registrar** — sells at cost, no markup (cloudflare.com/products/registrar)
- **Namecheap** — cheap, easy UI (namecheap.com)
- **Google Domains successor (Squarespace Domains)**

Search for something like `quizclash.com` or, if you already own a team
domain, you only need a subdomain (`quiz.yourteam.com`) — no purchase needed,
skip to step 6.

## 6. Point the domain at Vercel

1. In your Vercel project → **Settings → Domains** → add your domain
   (e.g. `quiz.yourteam.com` or `quizclash.com`).
2. Vercel shows you either:
   - A **CNAME record** to add (for a subdomain) — go to your registrar's DNS
     settings and add: `CNAME  quiz  →  cname.vercel-dns.com`
   - Or **A/ALIAS records** (for a root domain) — Vercel gives you the exact IP.
3. DNS changes typically propagate in minutes to a few hours. Vercel's
   dashboard shows a green checkmark once it's live with automatic HTTPS.

## 7. Running it for real events

- Same URL every time — no redeploy needed between events.
- Host opens the URL on the big screen/projector, picks **Host a game**,
  builds or reuses a quiz, shares the PIN.
- Everyone else opens the same URL on their phone, picks **Join a game**.
- Want a reusable quiz bank? The easiest low-effort upgrade: save quizzes as
  JSON files in the repo and add a "load quiz" dropdown in `HostSetup` — ask
  me if you want this built out.

## Notes & limits

- **No login system.** Anyone with the link can host or join — fine for an
  internal team tool, not meant for public/adversarial use.
- **Images** are loaded by URL (paste a link), not uploaded — keeps the app
  simple and avoids storage costs.
- **Firestore free tier** covers roughly 50K reads/20K writes per day — a
  team of dozens playing regularly won't come close to that.
- If you later want accounts, persistent quiz libraries, or history across
  events, that's a natural next step (Firebase Auth + a `quizzes` collection)
  — happy to build that when you're ready.
