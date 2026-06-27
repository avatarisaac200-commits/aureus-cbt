# Scholar Prep Modes Handoff

## Current Context

This app started as an OAU past-question / CBT practice app. It has recently been rebranded to **Scholar!** with:

- Scholar splash screen
- Scholar logo and app metadata
- Partner logos on splash/auth/main headers
- Google sign-in added to the auth page

The next major product change is **not** three separate branded apps. It is one Scholar app with three in-app prep products/modes.

## Product Goal

When a new or existing user opens the app, they should be able to choose what they want to do:

- **UTME Prep**
- **OAU Prep**: current OG version
- **OAU P-UTME Prep**

Each prep mode should feel tailored to that exam type. The current OAU Prep experience should remain the default/original flow, while UTME Prep and OAU P-UTME Prep can have fewer or different buttons, features, question banks, and exam types.

## Key Requirement

Licensing must be per prep mode.

A user may buy and activate:

- UTME Prep only
- OAU Prep only
- OAU P-UTME Prep only
- any combination of the three

Activating one mode must not unlock the others.

The current global free-access concept may continue to apply to **OAU Prep** only, while UTME Prep and OAU P-UTME Prep can remain restricted unless separately licensed.

## Recommended Flow

Preferred flow after this update:

```text
Splash
-> Auth
-> Prep Selector
-> Selected Prep Dashboard
```

For returning users:

```text
Splash
-> Auth
-> Last Selected Prep Dashboard
```

There should still be a visible way to switch prep mode later, for example from the dashboard header/profile/settings.

## Core Type

Add a central prep mode type:

```ts
type PrepMode = 'utme' | 'oau' | 'putme';
```

Suggested labels:

```ts
const PREP_MODE_LABELS = {
  utme: 'UTME Prep',
  oau: 'OAU Prep',
  putme: 'OAU P-UTME Prep'
};
```

## User Data Model

Move away from a single global subscription for access decisions. Keep old fields temporarily for compatibility, but introduce per-mode licensing.

Suggested user shape:

```ts
{
  lastPrepMode: 'oau',
  licenses: {
    oau?: {
      status: 'active',
      activatedAt: string,
      endsAt?: string,
      key?: string
    },
    utme?: {
      status: 'active',
      activatedAt: string,
      endsAt?: string,
      key?: string
    },
    putme?: {
      status: 'active',
      activatedAt: string,
      endsAt?: string,
      key?: string
    }
  }
}
```

## Access Rules

Create one central function for access decisions. Do not scatter per-mode checks across components.

Example:

```ts
canAccessPrepMode(user, prepMode, accessConfig)
```

Expected behavior:

- `oau`: may use current/global free access until the configured deadline, then requires `licenses.oau`.
- `utme`: requires `licenses.utme` unless admin config marks it free.
- `putme`: requires `licenses.putme` unless admin config marks it free.
- Staff/root-admin should keep full access.

Suggested config:

```ts
prepAccessConfig: {
  oau: {
    freeAccessEnabled: true,
    freeAccessEndsAt: '2026-04-01T23:00:00.000Z'
  },
  utme: {
    freeAccessEnabled: false
  },
  putme: {
    freeAccessEnabled: false
  }
}
```

## License Keys

License keys should include the prep mode they unlock.

Suggested key shape:

```ts
{
  key: 'XXXX-XXXX',
  prepMode: 'utme',
  durationDays: 365,
  status: 'unused',
  usedBy: null,
  usedAt: null
}
```

Activation should update only the relevant license:

```ts
users/{uid}.licenses.utme
```

Do not set one global `subscriptionStatus` as the source of truth for all modes.

## Dashboard Strategy

Do not fork the entire dashboard immediately. Start by passing the selected mode into the current dashboard:

```tsx
<Dashboard prepMode={selectedPrepMode} />
```

Then hide/show features using a config:

```ts
const PREP_MODE_CONFIG = {
  oau: {
    label: 'OAU Prep',
    enabledFeatures: ['tests', 'courses', 'videos', 'reviews', 'community', 'attendance']
  },
  utme: {
    label: 'UTME Prep',
    enabledFeatures: ['tests', 'reviews', 'leaderboard']
  },
  putme: {
    label: 'OAU P-UTME Prep',
    enabledFeatures: ['tests', 'reviews', 'courses']
  }
};
```

This preserves the current OAU app while allowing UTME and P-UTME to be simpler or different.

## Tests And Questions

Questions/tests should be tagged by prep mode:

```ts
{
  title: 'UTME Biology 2024',
  prepMode: 'utme',
  examType: 'utme',
  subject: 'Biology'
}
```

Existing tests/questions that do not have a `prepMode` should be treated as:

```ts
prepMode: 'oau'
```

This avoids breaking the current OAU content.

## Admin Changes Needed

Minimum admin changes:

- Add `prepMode` when creating/editing tests.
- Add `prepMode` when generating license keys.
- Filter tests/questions/analytics by prep mode.
- Allow free-access config per prep mode later.

## MVP Implementation Order

1. Add `PrepMode` type and central prep-mode config.
2. Add `PrepSelector` screen after auth.
3. Store `lastPrepMode` on the user profile.
4. Pass selected prep mode into `Dashboard` and relevant flows.
5. Treat missing test/question `prepMode` as `oau`.
6. Filter visible tests by selected prep mode.
7. Add per-mode license shape to user data.
8. Replace global read-only checks with `canAccessPrepMode`.
9. Update license activation to unlock only one prep mode.
10. Add admin fields for prep mode on tests and license keys.
11. Hide/show dashboard features per prep mode.

## Important Safety Notes

- Keep OAU Prep behavior intact as much as possible.
- Avoid duplicating the whole app for UTME and P-UTME.
- Centralize access checks so licensing bugs are easier to reason about.
- Preserve old subscription fields during migration until all logic has moved to per-mode licenses.
- Build after each meaningful step with:

```bash
npm.cmd run build
```

