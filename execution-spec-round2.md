# Ephemera Museum — round 2 execution specification

Planned: 2026-09-10
Status: ready for Astra to evaluate; no website code changed in this planning pass
Depends on: `execution-spec.md` (round 1, shipped). Read that first — this spec assumes the
folded-paper museum, three-view render window, and deterministic room generator already exist
and are working. Round 2 does not replace round 1's architecture; it deepens it.

## Where round 1 landed

Live at https://brooklynpostcards.github.io/ephemera-experience/. Source on `main` at
https://github.com/brooklynpostcards/ephemera-experience, deployed as a static export (see
`VERSION_LINKS.md` and `scripts/build-static-export.mjs` in that repo) because the app turned out
to have no server/database need despite being built on Cloudflare Workers tooling. Walked through
and confirmed working: movement, turning, inspection, keyboard/wheel/touch, mobile layout,
reversibility.

## What round 2 is for

Round 1 proved the constrained-rendering architecture and the folded-paper material language. It
did not yet make each of the 72 objects feel individually worth arriving at — everything looks the
same distance away, the label is just a cleaned filename, and there is no moment of discovery
built into approaching a piece. Round 2's job is to add that weight without abandoning what already
works.

**This is an evaluate-first handoff, not a mandate.** Astra should read this, read the live site
and the round 1 spec, and decide: adopt some or all of these directions, propose different ones
that better serve the same goals, or report back with notes if a direction conflicts with
something round 1 already learned the hard way. The goals below are fixed; the specific
mechanisms are not.

## Goals, in priority order

1. **Make arriving at an object feel like a small discovery**, not just a load. The user
   specifically raised "pixelating the ephemera until you click on it" as one possible direction —
   evaluate it, but the actual goal is the feeling, not that specific mechanic. Any mechanic that
   makes the reveal feel earned (focus pull, unfold, develop-like transition, obscured-then-clear)
   is in scope.
2. **Smoother, more confident navigation.** Round 1's movement works but is plain. Look for
   friction points during actual use (side-wall spoilers of upcoming objects, no way to jump back
   to a remembered piece, inspect mode being a dead end you can only exit rather than continue
   browsing from).
3. **More visible variation across the 72 rooms.** Currently only an accent color rotates per
   room; the fold/wall treatment is otherwise identical everywhere. Strengthen the sense that this
   is 72 distinct places, not one room redecorated 72 times.
4. **A way to show the archive has range without breaking the walking metaphor as primary.** No
   map existed in round 1 by design — keep that decision unless it's actively working against
   goal 1 or 2. If some kind of overview is worth adding, it should feel like a secondary mode
   (a drawer, an index card pulled from a pocket) rather than a competing home screen.

## Constraints used as the creative engine

Carried forward from round 1, still binding:

- Follow `D:/arm/CLAUDE.md`: planning stays in `arm`; the real checkout and media stay in the
  mirrored `arm_data` tree on the external drive labeled `folders`.
- Use the 72 existing JPGs in `public/exhibits/`. Create no image duplicates or derivatives unless
  a specific direction below calls for a lightweight, generated-at-render CSS/canvas effect (e.g.
  a blur or pixelation filter applied to the existing image, not a new baked asset).
- Keep rendering bounded: still no full map of 72 rooms constructed or retained at once. Any
  overview/index feature must not defeat this — e.g. render it from lightweight metadata (title,
  index, accent) rather than mounting 72 live image elements.
- No 3D engine, no video, no new heavy dependency. CSS and, if a direction genuinely needs it, an
  `<canvas>` filter (e.g. for a pixelation reveal) are acceptable; justify any new dependency
  against what CSS alone cannot do first.
- Preserve exact reversibility of the core walk (forward/back must return to the same exhibit,
  room, and facing) unless a specific new interaction (like a jump-to-object index) explicitly
  changes that contract — and if it does, define its own reversibility rule rather than leaving it
  undefined.
- Work on desktop, touch screens, keyboard-only use, and reduced-motion settings. A pixelation or
  focus-pull reveal must degrade to a simple crossfade or instant reveal under reduced motion, not
  just skip the reduced-motion checks round 1 already built.
- Do not invent dates, locations, provenance, or descriptions the archive doesn't have. If object
  presentation is strengthened, it should deepen how existing data (filename, sequence, palette)
  is presented — not fabricate backstory.
- Astra execution still stops as soon as the weekly model-usage meter reaches 50% used, and must
  not begin or continue if the baseline is already at or above 50%. Record baseline and latest
  reading as in round 1.

### Deliberate creative constraints (new for round 2)

- The reveal mechanic (if pursued) must read as *developing* or *uncovering*, in keeping with the
  archive's material language (paper, tape, registration ink) — not a generic loading-spinner
  substitute. A pixelation effect should feel like a photograph resolving or a photocopy sharpening,
  not a stock "image loading" placeholder.
- Any per-room visual variation must stay legible as the same museum. Vary fold angle, wall
  texture, or accent placement — don't let rooms diverge so far they look like different apps.
- If an index/overview is built, it must not become the primary way people experience the site.
  Walking stays the default and the more prominent affordance; the index is a lookup tool.
- One memorable interaction is enough. Round 1 shipped "approach to inspect." Round 2 should add at
  most one new signature interaction beyond navigation smoothing — resist stacking multiple
  gimmicks that dilute each other.

## Specific directions to evaluate (not a checklist — pick, combine, or reject)

### A. Obscured-until-engaged reveal

- On arrival in a room, the framed object could render pixelated, blurred, or partially obscured
  (e.g. behind a torn-paper mask) and resolve to clear on click/tap/Enter — the existing "approach
  to inspect" trigger already exists; this would change what that trigger reveals rather than
  adding a new control.
- Evaluate whether this should apply to every room every time (risks becoming a chore by object 30)
  or only on first encounter of a given object (requires tracking which of the 72 have been seen —
  acceptable as sessionStorage/localStorage, not a backend).
- Consider whether the *un-obscuring* itself is the "process" moment the user described, e.g. a
  scan-line sweep, a slow pixel-block coarsen-to-fine, or a torn-paper reveal consistent with the
  fold/tape material language — versus a plain opacity fade, which is closer to what already exists
  for reduced motion and wouldn't add anything new.

### B. Navigation smoothing

- Inspect mode currently only exits back to the room. Consider allowing forward/back navigation
  *while inspecting*, so browsing doesn't require repeatedly opening and closing.
- Side-wall previews currently show the adjacent object clearly before the user arrives. Consider
  obscuring those previews (silhouette, blur, or just the accession-slip label without the image)
  so arriving is still a reveal, consistent with direction A.
- Look for any input lag or dead-feeling transitions from actual use and tighten them; this is a
  polish pass as much as a feature pass.

### C. Per-room variation

- Derive additional visual parameters (fold angle, wall grain, tape placement, corner wear) from
  the existing stable hash of `depth + facing + seed` rather than only the accent color. Reuse the
  existing deterministic approach — do not introduce `Math.random()` at render.

### D. Lightweight index/overview

- If pursued: a slide-out drawer or pull-tab (visually: an index card or ledger pulled partway out)
  listing all 72 objects by title/number, letting the user jump directly to a room. Must not
  pre-render 72 images — text/number list only, with maybe the current accent color per entry.
- Selecting an entry should animate as a normal `move`-style transition to that depth, not a hard
  cut, to preserve the sense of a continuous place.

## Motion & navigation techniques to evaluate

These came out of deliberately questioning the obvious approach (hand-coded transform/opacity
transitions on the room elements, which is what round 1 already does) before generating
alternatives. They're offered as techniques, not requirements — Astra should judge each against
round 1's real constraints (bounded three-view render, no new heavy dependency, reduced-motion
fallback, deterministic per-room hash) rather than adopting all of them.

- **Native View Transitions API** (`document.startViewTransition`, no library) for the room-to-room
  swap. Lets the browser interpolate old/new DOM state with a declarative `::view-transition-*`
  rule instead of hand-choreographed transform math, and degrades to an instant swap automatically
  where unsupported — which also satisfies the reduced-motion fallback requirement for free in
  browsers that support `prefers-reduced-motion` inside the transition. Worth evaluating as a
  replacement for or supplement to the current fold transition, not necessarily instead of it.
- **Stepped (flip-book) motion instead of continuous easing.** CSS `steps()` timing on a short
  keyframe sequence reads as a hand-flipped stack of paper rather than a smooth slide — arguably
  more honest to the archive's material language than continuous easing, and a real alternative
  worth comparing side by side with round 1's current `ease` curve rather than assumed inferior.
- **CSS-only pixelation/resolve, no canvas.** Scale the framed `<img>` down (via a CSS custom
  property driving `width`/`height` or `transform: scale()`) with `image-rendering: pixelated`,
  then animate it back to full resolution with `image-rendering: auto` on reveal. This gets a
  "photo developing" look without a canvas dependency or per-pixel JS work — evaluate this before
  reaching for canvas, since it may satisfy direction A's goal at lower implementation cost.
- **Velocity-aware pacing.** Round 1's wheel/swipe handlers already capture delta magnitude and
  timing to debounce input; that same data could drive transition duration/easing instead of being
  discarded after the debounce decision — a fast flick producing a snappier fold, a slow deliberate
  keypress producing a more deliberate unfold. This is a real, low-cost source of per-step variety
  that doesn't require new state or violate the determinism rule (it's driven by the live input
  event, not stored or replayed). Evaluate whether this adds delight or just adds inconsistency
  before committing to it — test both ways.

## Files likely touched

Consistent with round 1's narrow footprint:

- `lib/museum.ts`: extend `RoomDescriptor` with whatever new per-room parameters direction C needs;
  add any "seen" tracking for direction A; add index/lookup helpers for direction D if pursued.
- `app/page.tsx`: reveal-state handling for direction A, inspect-mode navigation for direction B,
  drawer UI for direction D if pursued.
- `app/museum.css`: new visual treatments for A and C; drawer styling for D.
- No new route, worker API, backend, or persistence beyond optional client-side "seen" tracking.

## Validation (in addition to round 1's existing acceptance tests, which must still pass)

- Reduced-motion users get a functional, non-jarring reveal for any new obscure-until-engaged
  mechanic.
- The three-view render/memory invariant from round 1 still holds — check this explicitly if any
  new state (seen-objects list, index data) is added; confirm it doesn't retain per-room DOM or
  grow unbounded over a full walkthrough.
- Any new interaction has full keyboard and screen-reader support to the same standard as round 1's
  existing controls (accessible names, visible focus, no dead-end focus traps in a drawer/overview).
- Confirm on 360px, tablet, and desktop widths again — new UI (drawer, reveal overlay) must not
  break the layouts round 1 already validated.

## Handoff instruction for Astra

Read this file, `execution-spec.md`, `implementation-plan.md`, and `CONTEXT.md` in this workspace
first. Then look at the live site and the current `main` branch of
https://github.com/brooklynpostcards/ephemera-experience. Decide which of directions A–D (or an
alternative that better serves the stated goals) to pursue, in what order, and report back a short
plan before writing code — this round is explicitly open for Astra to push back on any of the above
if something conflicts with what round 1 already learned. If a direction is rejected, say why, so
the reasoning isn't lost.
