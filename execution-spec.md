# Ephemera Museum — execution specification

Planned: 2026-09-09
Status: ready for Astra implementation; no website code changed in this planning pass

## Problem reframing

The goal is not to simulate a large building. The goal is to make a finite archive feel like a
place that can be explored indefinitely, while keeping disk use, download size, memory, and mobile
GPU work very small.

How might we make 72 small photographed objects feel like an endless physical museum when only the
previous, current, and next views may exist at once?

## Constraints used as the creative engine

### Fixed constraints

- Follow `D:/arm/CLAUDE.md`: planning stays in `arm`; the real checkout and media stay in the
  mirrored `arm_data` tree on the external drive labeled `folders`.
- Use the 72 existing JPGs in the website's `public/exhibits/` folder. They total 5.74 MB. Create no
  image duplicates or derivatives in this pass.
- Render at most three spatial views and three exhibit images at once: previous, current, next.
- Generate adjacent views from the current state. Never create, fetch, or retain a complete map.
- Use responsive HTML, CSS, and React already present in the project. Add no 3D/game dependency.
- Preserve exact reversibility: forward followed by back must return to the same exhibit, room, and
  facing.
- Work on desktop, touch screens, keyboard-only use, and reduced-motion settings.
- Astra execution stops as soon as the weekly model-usage meter reaches 50% used. It must not begin
  or continue execution if the meter is already at or above 50%.

### Deliberate creative constraints

- The museum is made from folded paper, card, tape, staples, crop marks, and registration ink. A
  CSS-perspective scene should feel like the correct medium for ephemera rather than an imitation
  of photorealistic architecture.
- No generic white-cube gallery, fake marble, stock museum imagery, floating glass panels, or neon
  game HUD.
- No continuous animation loop. Motion occurs only in response to a visitor action, using CSS
  transitions. This lowers CPU/GPU use and gives each move the rhythm of turning a page.
- No minimap. Orientation comes from room numbers, facing marks, and the ability to undo any move.
- One primary object per view. Side walls may hint at the previous and next works, but must not load
  more images.
- Filenames may be cleaned into labels, but the interface must not invent dates, locations,
  provenance, or descriptions that are absent from the archive.
- One memorable interaction: approaching a work shifts it from an object in a room to a clean,
  nearly full-screen inspection view; backing away restores the room without changing position.

## Alternatives considered

1. **Conventional endless corridor.** Clearest walking metaphor, but CSS-only perspective risks
   looking like a generic game mockup and makes turning mostly decorative.
2. **Rotating archival cabinet.** Very light and intimate, with drawers generated on demand, but it
   does not fully deliver the requested walk-through.
3. **Folded-paper labyrinth — chosen.** Each step unfolds the next room like a paper construction.
   It preserves walking and turning, uses the archive's material language, and makes constrained
   rendering part of the concept.

The cabinet idea survives as the inspection mode: a selected object moves forward as if removed
from a drawer or display case.

## Visitor flow

### Arrival

- Open inside Room 001 with the first exhibit already visible.
- Show the title `EPHEMERA`, the room number, a restrained facing mark, and concise controls.
- Do not show a splash screen, marketing hero, tutorial modal, progress gate, or account prompt.
- On first visit only, a small instruction line fades after the visitor moves: `Move: arrows / WASD
  · Inspect: Enter`.

### Movement

- `ArrowUp`, `W`, the forward button, upward wheel intent, or upward swipe: advance one room.
- `ArrowDown`, `S`, the back button, downward wheel intent, or downward swipe: return one room.
- `ArrowLeft`/`A` and `ArrowRight`/`D`: turn the current view 90 degrees.
- `Enter`, `Space`, or tapping the framed work: enter/leave inspection mode.
- `Escape`: leave inspection mode.
- Lock input during the travel transition and debounce wheel input so one gesture causes one move.
- Do not hijack browser gestures at page edges unnecessarily.

### Inspection

- Keep the complete image visible with `object-fit: contain`; never crop the artwork.
- Display only the cleaned filename label and sequence number.
- Offer a clear close/back control and preserve keyboard focus when returning to the room.
- If an image fails, retain the frame and show `Image unavailable` plus its label; movement remains
  functional.

## Procedural world model

Use a compact serializable state:

```ts
type Position = {
  depth: number;       // signed step count; may grow in either direction
  facing: 0 | 1 | 2 | 3;
  seed: number;        // fixed for the visit
};
```

No rooms array and no graph are stored. Pure functions derive every result:

```ts
describeRoom(depth, facing, seed) -> RoomDescriptor
buildWindow(position, offset = -1) -> recursively emits offsets -1, 0, 1, then stops
```

`RoomDescriptor` contains only values needed to render one view: stable key, exhibit index, cleaned
label, palette index, fold direction, frame treatment, and doorway direction. It contains no image
bytes and no retained DOM reference.

### Deterministic exhibit order

- Use one immutable, flat runtime array containing only the 72 public image URLs. Measured as compact
  JSON, the complete URL array is about 2.32 KB. Do not duplicate titles or metadata in it: derive a
  display label from the filename when the room descriptor is created.
- Treat the ICM hierarchy as the authoring and source-of-truth structure, not as a nested client-side
  data model. The routed archive remains under `arm_data/archives/08_ephemera/`; the website's
  curated small display set remains under `public/exhibits/`. A future build-time manifest generator
  may walk category folders if the curated set is subdivided, but the browser should still receive
  one compact ordered list.
- An array entry is only a URL string; it does not fetch or decode its image. The three-view window
  determines which images the browser actually mounts.
- Generate an offset from the visit seed.
- Walk the 72-image manifest with a step coprime to 72, such as 35, so the sequence visits every
  image before repeating.
- Normalize negative depths with mathematical modulo.
- Derive visual variation from a stable integer hash of `depth + facing + seed`, never from
  `Math.random()` during render.
- After 72 rooms the artworks repeat, but palette, fold, and facing context may vary. Labels always
  remain attached to the correct file.

### Three-view invariant

- Mount exactly offsets `[-1, 0, 1]` around the current depth.
- Current view is interactive. Adjacent views are hidden from accessibility APIs and cannot receive
  focus.
- Only the next image gets eager preload. The other adjacent view is available for reversal but may
  retain its already decoded image.
- On transition completion, update depth once; React reconciliation removes the far view and derives
  the new adjacent view.
- Never append rooms to a history collection. Browser history is not updated for individual steps.

## Visual system

### Spatial composition

- Full-viewport stage with a centered room plane and shallow CSS perspective.
- Three paper planes form the back and side walls. Seams, fibers, fold shadows, tape, crop marks, and
  one offset registration color create depth with CSS backgrounds and borders.
- Doorway is a negative-space fold in the current wall. During travel the current plane scales past
  the viewer while the next unfolds into place.
- The framed artifact remains the highest-contrast element. Architecture stays quiet enough that
  object color and wear dominate.

### Palette and type

- Base: carbon black, aged newsprint, bone white.
- One registration accent selected per room from cyan, vermilion, or safety yellow.
- Use the existing local/system font stack; do not add font files or remote font dependencies.
- Labels resemble accession slips: compact uppercase for room data, readable mixed case for object
  names. Regular controls remain at least 14 px; primary labels and instructions at least 16 px.

### Responsive behavior

- Desktop: deeper perspective, visible side folds, compact control rail along the lower edge.
- Tablet: shallower perspective and wider frame; keep turns and movement equally prominent.
- Mobile portrait: back wall occupies most of the screen, side folds narrow, controls become a
  thumb-reachable five-button cluster above safe-area insets.
- Mobile landscape: artwork and controls share the horizontal field without covering each other.
- At 200% text zoom, metadata may wrap below the frame and the room remains navigable.

## Motion grammar

- Travel: 420–560 ms ease with one unfold and one depth move; no bounce.
- Turn: 260–360 ms hinged paper rotation.
- Inspect: 220–300 ms frame approach and background dim.
- Reduced motion: no perspective travel or rotation; use a 120–180 ms opacity change.
- Cancel timers/listeners on unmount. Do not run `requestAnimationFrame` while idle.

## Component and file plan

Keep the implementation narrow:

- `app/page.tsx`: client component, immutable 72-URL array, pure generator functions, input state,
  recursive three-view builder, and semantic scene markup.
- `app/globals.css`: theme tokens, paper room construction, spatial transforms, transitions,
  responsive layouts, focus states, and reduced-motion rules.
- `app/layout.tsx`: site-specific title and description.
- `public/exhibits/*.jpg`: unchanged source set.
- No new dependency, media, persistence layer, route, worker API, or analytics.

If `page.tsx` becomes difficult to review above roughly 450 lines, extract only pure world-generation
types/functions and the exhibit manifest into `lib/museum.ts`. Do not split components merely to
produce a conventional folder hierarchy.

## Execution order for Astra

1. Read `D:/arm/CLAUDE.md`, the routed `CONTEXT.md`, `implementation-plan.md`, and this specification.
2. Record the weekly model-usage baseline. Stop and alert the user as soon as weekly usage reaches
   50% used; do not begin or continue execution if the baseline is already at or above 50%.
3. Confirm the real checkout is `D:/arm_data/factories/website/ephemera-experience/`, the 72 exhibit
   files exist, and `app/page.tsx` is absent. Do not initialize a second project.
4. Create the first coherent slice: Room 001, one real exhibit, forward/back controls, paper visual
   tokens, and responsive full-viewport layout.
5. Start the existing development command, make one successful local request, and open the first
   meaningful preview according to the Sites workflow.
6. Add deterministic generation, three-view recursion, turns, inspection, keyboard/wheel/touch
   controls, and failure handling.
7. Update metadata and run the production build. Fix build failures only; avoid an unbounded polish
   pass.
8. Test the invariants below. Do not push or publish until the user explicitly begins that separate
   step after reviewing the local result.
9. Record implementation state and latest weekly usage. Stop immediately if the cutoff is reached.

## Acceptance tests

### Generation and memory

- Exactly three `.museum-room` elements exist after initial render and after 30 moves.
- No more than three exhibit `<img>` elements exist at any time.
- No stored room/map/history collection grows when walking.
- Depth `0 -> 1 -> 2 -> 1 -> 0` returns the exact initial filename, style descriptor, and facing.
- Every one of the 72 manifest entries appears once before the first artwork repeats.

### Interaction

- Buttons, arrows/WASD, wheel, and swipe each cause one discrete move.
- Rapid wheel events do not skip multiple rooms during a locked transition.
- Left then right returns to the original facing.
- Enter opens inspection; Escape closes it; focus returns to the framed work.
- A deliberately invalid image path shows the fallback and does not stop movement.

### Responsive and accessible behavior

- Verify 360x640, 768x1024, and 1440x900 layouts.
- Artwork remains fully visible at each size and in inspection mode.
- Controls do not collide with safe areas or essential text.
- Keyboard focus is always visible; interactive elements have accessible names.
- With reduced motion enabled, travel contains no large scaling or rotation.
- Adjacent rooms are hidden from screen readers and contain no tabbable control.

### Build and footprint

- Production build completes with no missing route or asset errors.
- No new package dependency is present.
- No new image, video, model, font, or generated binary is present.
- Report final source delta and deployed/static asset size before any Git push.

## Failure pivots

- If CSS perspective is visually unstable on mobile, reduce to two hinged planes while preserving
  the same generator and three-view window; do not add a rendering engine.
- If the recursive render helper harms clarity or triggers lint/compiler issues, retain recursion in
  descriptor generation and render its fixed three-item result normally. The bounded generation
  behavior matters more than a clever JSX implementation.
- If input modalities conflict, keep buttons and keyboard as the reliable core, then restore wheel
  and swipe one at a time with tests.
- After a handful of repeated failures in the same category, stop direct retries and check official
  framework/browser documentation before changing architecture, following the problem-solver rule.

## Self-check before execution

1. **Could deterministic infinity make the archive feel repetitive?** Yes after 72 works. The first
   pass accepts this because it proves the spatial system with every available small image. Future
   archive expansion changes only the manifest.
2. **Does “responsive HTML” forbid React?** The existing website is a React/Vinext project, and the
   requested outcome is responsive browser markup. React generates ordinary semantic HTML and
   avoids adding a 3D dependency. This stays within the stated constraint.
3. **What remains unverified?** The exact visual quality and touch feel cannot be established from
   files alone. Astra must show the first meaningful local preview and validate the specified
   viewport sizes before Git work begins.
