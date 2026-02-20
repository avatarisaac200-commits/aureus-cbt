# Mobile APK Wrapper (Android)

This folder is a separate Capacitor wrapper for the existing web app in the parent directory.
It does not change the current web flow.

## What it does

- Builds the existing web app (`../dist`)
- Copies it into `mobile-app/www`
- Syncs with Capacitor Android project
- Opens Android Studio for APK build

## Prerequisites

- Node.js 18+
- Android Studio (with SDK + build tools)
- Java 17 (recommended for modern Android builds)

## First-time setup

1. Install dependencies in this folder:
   - `cd mobile-app`
   - `npm install`

2. Create Android project once:
   - `npm run add:android`

## Build and open Android project

1. From `mobile-app`:
   - `npm run sync`
   - `npm run open:android`

2. In Android Studio:
   - Wait for Gradle sync
   - Build APK:
     - `Build > Build Bundle(s) / APK(s) > Build APK(s)`

APK output is typically under:
- `mobile-app/android/app/build/outputs/apk/`

## Notes

- Re-run `npm run sync` each time your web app changes.
- This wrapper uses your existing web app as-is.
