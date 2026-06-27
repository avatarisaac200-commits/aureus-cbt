# Codex Prompt — Inject Scholar! Splash Screen into Vite + React 19

## Context

I have a Vite + React 19 app. I need you to inject a premium animated splash/loading screen that displays while the app initialises. The finished HTML reference file is `splash-screen.html` in the project root (or wherever I place it). Use it as the single source of truth for all styles and markup.

---

## Tasks

### 1. Detect asset file extensions

In `src/assets/` (or whichever assets folder exists in this project), there will be three image files:

- `Main.<ext>` — the primary Scholar! logo
- `partner1.<ext>` — first partner logo
- `partner2.<ext>` — second partner logo

The extension may be `.png`, `.svg`, `.webp`, or `.jpg`. Detect whichever extension is present for each file and use the correct one in the import statements below.

---

### 2. Create `src/components/SplashScreen.jsx`

Convert the HTML reference into a React component. Rules:

- Copy **all CSS** from the `<style>` block in `splash-screen.html` into a new file `src/components/SplashScreen.css` and import it at the top of the component.
- Import the three logo files using Vite's static asset imports:
  ```js
  import mainLogo   from '../assets/Main.<ext>'
  import partner1   from '../assets/partner1.<ext>'
  import partner2   from '../assets/partner2.<ext>'
  ```
- The component accepts a single prop: `onDone: () => void`
- Use a `useRef` on the root `#splash` div.
- Use a `useEffect` that fires once on mount. After **3 500 ms**, add the CSS class `exiting` to the ref, then after a further **800 ms** (matching the `fadeOut` animation duration) call `onDone()`.
- Wire the Skip button's `onClick` to do the same thing immediately: add `exiting`, wait 800 ms, call `onDone()`.
- The `wordmark` div has been removed — the logo image itself contains the app name, so do not render any text app name
- Do **not** use `useState` for the exit — manipulate the class directly via the ref so there is zero re-render during the animation.
- Return the exact same HTML structure as `splash-screen.html`, replacing:
  - The `<img class="logo-img">` `src` attribute → `{mainLogo}`
  - The first `<img class="partner-img">` `src` → `{partner1}`
  - The second `<img class="partner-img">` `src` → `{partner2}`
- Keep all `aria-*` and `role` attributes intact.

The component signature:

```jsx
// src/components/SplashScreen.jsx
import './SplashScreen.css'
import mainLogo  from '../assets/Main.<ext>'
import partner1  from '../assets/partner1.<ext>'
import partner2  from '../assets/partner2.<ext>'
import { useEffect, useRef } from 'react'

export default function SplashScreen({ onDone }) {
  const splashRef = useRef(null)

  useEffect(() => {
    const exit = () => {
      splashRef.current?.classList.add('exiting')
      setTimeout(onDone, 800)
    }
    const timer = setTimeout(exit, 3500)
    return () => clearTimeout(timer)
  }, [onDone])

  const handleSkip = () => {
    splashRef.current?.classList.add('exiting')
    setTimeout(onDone, 800)
  }

  return (
    <div id="splash" ref={splashRef} role="status" aria-label="Loading Scholar!">
      {/* paste inner JSX here, converting class → className, onclick → onClick={handleSkip} on the button */}
    </div>
  )
}
```

---

### 3. Update `src/App.jsx`

- Import `useState` from React and `SplashScreen` from `./components/SplashScreen`.
- Add a state variable: `const [appReady, setAppReady] = useState(false)`
- Wrap the existing return so that when `appReady` is `false`, only `<SplashScreen onDone={() => setAppReady(true)} />` is rendered.
- When `appReady` is `true`, render the existing app content as before.
- Do not alter any existing logic, routes, or providers — just gate them behind the `appReady` flag.

Example shape (preserve existing JSX inside the `appReady` branch):

```jsx
import { useState } from 'react'
import SplashScreen from './components/SplashScreen'
// ... existing imports unchanged

export default function App() {
  const [appReady, setAppReady] = useState(false)

  if (!appReady) {
    return <SplashScreen onDone={() => setAppReady(true)} />
  }

  return (
    // ... existing app JSX unchanged
  )
}
```

---

### 4. Full-page styles

In `src/index.css` (or the global stylesheet), ensure the following rules exist so the splash fills the viewport with no scrollbars:

```css
html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden; /* only while splash is showing — React removes it once appReady flips */
}
```

If `overflow: hidden` on `body` would break the rest of the app, scope it to a class instead and add/remove it alongside the `appReady` flag.

Also, in `SplashScreen.css`, uncomment (or add) the full-page variant rule:

```css
#splash {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  box-shadow: none;
}
```

---

### 5. Do not change

- Any existing routes, pages, or components.
- Any existing CSS variables or theme files.
- The Vite config.
- Any environment files.

---

## Asset paths cheatsheet

| Variable   | File to look for in `src/assets/`              |
|------------|------------------------------------------------|
| `mainLogo` | `Main.png` OR `Main.svg` OR `Main.webp`        |
| `partner1` | `partner1.png` OR `partner1.svg` OR `partner1.webp` |
| `partner2` | `partner2.png` OR `partner2.svg` OR `partner2.webp` |

If none of those extensions exist, flag it and ask which file to use.

---

## Reference file

`splash-screen.html` — contains the complete, self-contained HTML + CSS implementation. Treat its styles and markup as final. Do not redesign; only convert to React.
