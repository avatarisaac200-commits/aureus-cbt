<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy the CBT app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Firebase Leaderboard Automation

This project now includes a Cloud Function that keeps `leaderboardPublic` in sync whenever `results` changes.

### One-time setup

1. Install Firebase CLI and login:
   `npm i -g firebase-tools`
   `firebase login`
2. Select your Firebase project in this repo:
   `firebase use <your-project-id>`
3. Install function dependencies:
   `cd functions && npm install`

### Deploy

1. Deploy rules:
   `firebase deploy --only firestore:rules`
2. Deploy functions:
   `firebase deploy --only functions`

### Backfill existing leaderboard data

After deploy, open Admin Dashboard -> Question Bank -> **Rebuild Ranks** once.

## Auri study assistant

Auri is an authenticated, app-wide study companion. Its Gemini API key is stored only as an encrypted Cloudflare Worker secret; never add it to frontend code or source control.

### One-time setup

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. In `workers/classboard`, sign in to Cloudflare and store the key securely when prompted:

   ```powershell
   npx wrangler login
   npx wrangler secret put GEMINI_API_KEY
   ```

   Optional but recommended: add a Groq fallback key. Auri uses it only when Gemini has a network error, rate limit, or server outage.

   ```powershell
   npx wrangler secret put GROQ_API_KEY
   ```

3. Deploy the Worker and copy its `https://...workers.dev` URL:

   ```powershell
   npx wrangler deploy
   ```

4. Set `VITE_AURI_WORKER_URL` to that URL in your Vercel project environment variables, then redeploy the frontend.

The assistant accepts signed-in users only and is unavailable during active exams.

## Classboard On Firebase Spark

If you stay on Firebase `Spark`, do not use Firebase Cloud Functions for the classboard backend.

Use the Cloudflare Worker flow instead:

- setup guide: [docs/cloudflare-worker-classboard.md](./docs/cloudflare-worker-classboard.md)
- worker source: [workers/classboard](./workers/classboard)

This worker handles:

- scheduled announcement publishing
- class session reminders
- web push delivery
- notification fanout into Firestore
