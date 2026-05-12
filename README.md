<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1bRJHLbhbTyGMwXcWLjdUYBq7ley_tVMZ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
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
