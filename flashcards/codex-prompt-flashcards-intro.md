# Prompt for Codex: Add the "Introducing Flashcards" welcome animation

Copy everything below into Codex.

---

I want to add a one-time welcome animation to my app that announces a new "Flashcards" feature. Here's what I need:

**What it is:**
A full-screen overlay that appears automatically the first time someone opens the app after this feature launches. It shows a short, delightful animation of cards fanning out and the top card flipping over to reveal the message "Introducing Flashcards," a one-line description of what the feature does, and two buttons: "Try it now" (takes them to the flashcards feature) and "Maybe later" (just closes the overlay).

**When it should appear:**
- It should show automatically the moment someone logs in or opens the app, without them having to click anything.
- It should only ever show once per person. Once they've seen it and closed it (by either button, or by clicking outside it, or pressing Escape), it should never appear again for that person, even if they log out and back in or open the app on a different day.
- It should not show for people who create a new account after the feature has already been out for a while — only treat it as a "welcome to something new" moment, not a permanent onboarding step. If that's tricky to determine, it's fine to simply show it once to everyone the first time they log in after this change goes live, and never again after that.
- It should appear above everything else on the screen and briefly pause interaction with the rest of the app while it's showing, but people should always be able to dismiss it early if they don't want to watch the whole thing.

**How it should look and feel:**
- A dark, calm backdrop behind the animation so the cards are the focus.
- A small stack of index-card-style cards that fans out gently when the overlay appears, like someone spreading a hand of cards.
- The top card then flips over to reveal the announcement, with a small folded-corner detail on the card to reinforce that it's a "flashcard."
- The tone should feel warm and a little playful, not corporate. Short, friendly copy — no jargon.
- Motion should feel smooth and quick, roughly 1–2 seconds total before it settles, not long or distracting.
- If someone's device is set to reduce motion, skip the animated movement and just show the finished, flipped card immediately — no one should feel forced to sit through motion they've asked to avoid.

**Interaction details:**
- "Try it now" closes the overlay and takes the person to the flashcards feature.
- "Maybe later" simply closes the overlay and returns them to whatever they were doing.
- Clicking outside the card or pressing Escape should also close it, same as "Maybe later."
- Closing it in any way should be remembered as "this person has seen the announcement," so it truly never shows again for them.

**Where it fits in the app:**
- This should be global — it needs to live at the top level of the app (wherever the main layout or app shell is) so it can appear no matter which page someone lands on after logging in, not just one specific screen.
- It shouldn't interfere with anything else that already runs on login (loading data, other welcome messages, etc.) — it should just layer on top and get out of the way once dismissed.

**Extras that would be nice but aren't required:**
- A subtle glow or shimmer behind the cards while they settle, to add a bit of delight without feeling like confetti or a generic celebration effect.
- Keyboard accessibility (can be dismissed and navigated without a mouse) and a screen-reader-friendly announcement of the title and buttons.

Please implement this in a way that fits naturally with the existing structure and styling of the app, matching whatever design language it already uses, rather than introducing a totally new visual style.
