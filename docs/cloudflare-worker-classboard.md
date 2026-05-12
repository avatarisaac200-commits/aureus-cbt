# Cloudflare Worker Setup For Classboard

This app stays on `Firebase Spark` for Auth + Firestore. The scheduled classboard backend runs on `Cloudflare Workers`.

## What the worker handles

- Scheduled announcement publishing
- 15-minute session reminders
- Web push fanout using saved `pushSubscriptions`
- Writing `notifications` docs into Firestore

## What still stays in Firebase

- Auth
- Firestore data
- Client-side announcement and schedule UI
- Read receipts and notification preferences

## 1. Create a Firebase service account

In Firebase / Google Cloud:

1. Open your project settings
2. Go to `Service accounts`
3. Generate a new private key

You need these values from the JSON:

- `project_id`
- `client_email`
- `private_key`

## 2. Install the worker dependencies

```bash
cd workers/classboard
npm install
```

## 3. Login to Cloudflare

```bash
npx wrangler login
```

## 4. Set Wrangler secrets

Run these inside `workers/classboard`:

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
npx wrangler secret put WEB_PUSH_PUBLIC_KEY
npx wrangler secret put WEB_PUSH_PRIVATE_KEY
npx wrangler secret put WORKER_RUN_SECRET
```

The private key must be pasted exactly as it appears in the service account JSON.

## 5. Set non-secret worker vars

Check [wrangler.toml](../workers/classboard/wrangler.toml):

- `FIREBASE_PROJECT_ID`
- `WEB_PUSH_SUBJECT`

Update them if needed.

## 6. Deploy

```bash
cd workers/classboard
npx wrangler deploy
```

## 7. Optional manual test

```bash
curl -H "Authorization: Bearer YOUR_WORKER_RUN_SECRET" https://YOUR_WORKER_URL/run/all
```

## 8. Frontend env

In the Vite frontend, set:

```env
VITE_WEB_PUSH_PUBLIC_KEY=your_public_vapid_key
```

If your frontend is hosted on Firebase Hosting, put it in your local `.env.local` before build.

## Notes

- The worker reads Firestore through the Google Firestore REST API using your service account.
- Existing `functions/` code can be ignored for classboard if you remain on `Spark`.
- The worker cron schedule is defined in `wrangler.toml`.
