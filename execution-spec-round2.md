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

0. **Physics-based fold navigation with real weight — the flagship direction for this round.**
   After using the live site, the user specifically asked for swipe navigation driven by genuine
   spring/momentum physics: the fold tracks the gesture, a hard flick carries through with momentum
   and can spin/overshoot before settling, motion eases to a natural stop rather than a fixed CSS
   transition. See direction E below for the full specification — this is not one option among
   several, it's the direction the user is most excited about and should be evaluated first and
   given the most weight if Astra has to prioritize within a usage-limited session.
1. **Make arriving at an object feel like a small discovery**, not just a load. The user
   specifically raised "pixelating the ephemera until you click on it" as one possible direction —
   evaluate it, but the actual goal is the feeling, not that specific mechanic. Any mechanic that
   makes the reveal feel earned (focus pull, unfold, develop-like transition, obscured-then-clear)
   is in scope.
2. **Smoother, more confident navigation.** Round 1's movement works but is plain. Look for
   friction points during actual use (side-wall spoilers of upcoming objects, no way to jump back
   to a remembered piece, inspect mode being a dead end you can only exit rather than continue
   browsing from). Direction E above substantially serves this goal too — they're complementary,
   not competing.
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
  keypress producing a more deliberate unfold. Superseded by the full physics-based navigation
  section below if that direction is pursued; kept here as the minimal fallback version if it
  isn't — even just reusing captured velocity for duration/easing is a real, low-cost improvement
  on its own.

## E. Physics-based fold navigation (user-prioritized — "I love this direction")

The user, after using the live site, specifically asked for swipe navigation with real weight:
sophisticated easing, origami/fold physics, spin-on-hard-swipe, and a smooth organic settle rather
than a fixed-duration transition. This came with an explicit offer to supply old Flash/ActionScript
physics formulas (spring easing, momentum/friction curves) as reference material if useful — treat
any such formulas the user provides as **math to reimplement in JS, not code to port directly**;
ActionScript itself doesn't run in a browser, but the underlying spring-constant/friction/damping
values translate directly. If the user hasn't supplied anything by the time this is picked up,
proceed with standard spring/momentum physics (the same family of formulas behind iOS scroll
physics, Framer Motion's spring, react-spring, etc.) — well-documented, no need to wait.

This is a bigger, more central change than directions A–D and the other motion techniques above —
treat it as the flagship interaction of round 2 if pursued, not one option among many.

### What "real weight" means here, concretely

- Fold rotation should be driven by a spring simulation (position, velocity, spring stiffness,
  damping) advancing every frame during the gesture and after release — not a CSS `transition`
  with a fixed duration and easing curve. A CSS transition can approximate an ease-out but cannot
  produce genuine momentum (a fast flick traveling further, gesture velocity carrying into the
  release) or a natural spring settle (slight overshoot and correction) the way a real physics step
  can.
- **During the gesture**: the fold should track the pointer/touch 1:1 (or with light resistance
  near travel limits), not just play a canned animation once a swipe is detected — the user should
  feel like they're physically turning the page, not triggering a video clip.
- **On release**: velocity at release time determines what happens next — a slow drag settles back
  or completes the fold with a gentle ease; a hard flick carries through with momentum, decelerating
  under friction, potentially overshooting the target room and springing back (the "it spins if you
  swipe hard enough" effect), then coming to rest. This needs real per-frame simulation
  (`requestAnimationFrame`, not CSS) to compute correctly — CSS custom properties cannot receive a
  per-frame numeric velocity input.
- **Multi-room travel on a hard flick is in scope** (confirmed with the user) — a sufficiently fast
  swipe can carry past one room into two or three, not just a springier version of a fixed one-room
  step. This changes round 1's reversibility contract and needs its own definition, not silent
  reuse of the old one:
  - Define reversibility for multi-room travel explicitly: a flick that lands on depth `N` must be
    undoable by a symmetric flick (or equivalent input) back to the exact original depth, facing,
    and object — not merely "close enough." Land on a whole-number room depth always; never leave
    the user stopped mid-fold between two rooms.
  - The physics can carry through several rooms' worth of visual fold motion during one continuous
    gesture, but the underlying state model should still only ever *commit* to one final integer
    depth per gesture — avoid needing to retain more than the current three-view window's worth of
    descriptors even while flying through intermediate ones during the animation. Generate
    intermediate descriptors transiently for the visual pass-through, discard them once the gesture
    resolves, exactly as `buildWindow` already does for the settled state.
- **Spin**: evaluate as a rotational flourish tied to release velocity exceeding some threshold —
  keep it earned (only on a genuinely hard flick) rather than happening on every interaction, or it
  stops reading as weight and starts reading as a gimmick.

### Constraints specific to this direction

- No physics/animation library dependency by default (no GSAP, no Matter.js, no react-spring) —
  hand-rolled spring/friction math in a `requestAnimationFrame` loop is well-understood and keeps
  the "no new heavy dependency" rule intact. If Astra concludes a small, focused physics utility
  (not a general engine) is genuinely justified, name the specific tradeoff rather than reaching for
  one by default.
- Must still fully respect `prefers-reduced-motion`: reduced-motion users get the existing (or a
  simplified) instant/crossfade transition, never the spring simulation — this is not optional
  polish, it's the same accessibility contract round 1 already established for every other motion.
- Must work across mouse (click-drag or wheel-as-proxy), touch (swipe with real velocity from
  pointer events), and keyboard (which has no natural "velocity" — define a sensible default, e.g.
  keyboard always behaves like a moderate, non-hard flick, never triggering multi-room spin).
- Must not defeat the three-view bounded render invariant even during multi-room fly-through
  animation — see the reversibility bullet above.
- Performance: the simulation must stay smooth (60fps target) on mobile GPUs given the existing
  CSS-perspective paper planes already in play; if combining full spring physics with the existing
  fold rendering causes jank on real mobile hardware, that's a legitimate reason to simplify (fewer
  simultaneously animated planes, cheaper per-frame math) rather than a reason to abandon the
  direction outright — report back with what was tried.

### If the user supplies ActionScript reference material

Read it for the actual formulas (spring constant, damping/friction coefficients, easing curve
shapes, velocity-to-rotation mapping) and reimplement the logic natively in JS/TypeScript. Do not
attempt to transpile or directly port ActionScript syntax — the goal is the *feel* the formulas
were tuned to produce, translated into a `requestAnimationFrame`-driven spring model, not a literal
code port.

### Reference formulas already gathered (2026-09-10)

Two real formula families cover what "spin if you swipe hard enough" and "organic real weight"
each need — both are the well-known canonical source material this style of interaction has used
since actual Flash/AS3 era animation, so there's no need to wait on the user tracking down old
personal files:

- **Overshoot/spin shape — Robert Penner's `easeOutBack` and `easeOutElastic`** (the original
  source of these curves; ubiquitous in every modern animation library because of it). Already
  fetched into plain JS (from a verified port at `github.com/bcherny/penner`, not paraphrased):

  ```js
  // easeOutBack — the overshoot-then-settle curve for a hard-flick spring-back
  function easeOutBack(t, b, c, d, s = 1.70158) {
    return c * ((t = t / d - 1) * t * ((s + 1) * t + s) + 1) + b;
  }

  // easeOutElastic — a springier, multi-wobble settle if a single overshoot isn't enough
  function easeOutElastic(t, b, c, d) {
    let a = c, p = d * 0.3, s;
    if (t === 0) return b;
    if ((t /= d) === 1) return b + c;
    if (a < Math.abs(c)) { a = c; s = p / 4; }
    else { s = p / (2 * Math.PI) * Math.asin(c / a); }
    return a * Math.pow(2, -10 * t) * Math.sin((t * d - s) * (2 * Math.PI) / p) + c + b;
  }
  // t = elapsed time, b = start value, c = change in value, d = duration, s = overshoot amount
  ```

  These are fixed-duration curves, not per-frame velocity simulations — useful directly for the
  release/settle phase (once release velocity has picked a target depth and an overshoot amount),
  less suited to the drag-tracking phase, which needs the model below instead.

- **Momentum/friction shape — the standard velocity-decay model** used across essentially every
  "throw and it coasts to a stop" interaction (iOS scroll physics, drag-and-throw AS3 tutorials,
  etc.), same shape regardless of era or platform:

  ```js
  // Per animation frame, after release at some initial velocity:
  velocity *= friction;        // friction constant, e.g. 0.92–0.97 — tune by feel
  position += velocity;
  if (Math.abs(velocity) < STOP_THRESHOLD) {
    // hand off to easeOutBack/easeOutElastic above to settle exactly on the target room
  }
  ```

  Use this for the coast phase after release velocity is known (from pointer/touch delta ÷ time),
  and use it to decide *how far* the flick should carry (higher release velocity → more frames of
  coast before crossing the stop threshold → more rooms traveled) before handing off to the
  overshoot easing above for the final settle onto a whole-number room depth.

Together: **drag** (1:1 tracking) → **release** (velocity computed from recent pointer deltas) →
**coast** (friction-decay loop determines how many rooms are crossed) → **settle** (`easeOutBack`/
`easeOutElastic` brings it to rest exactly on the resolved target depth, with the overshoot/spin
only visible here). This is a complete, implementable model without needing any AS3 files — if the
user does find and supply old personal reference formulas later, compare against this baseline and
adopt whichever tuning constants (friction value, overshoot `s`, spring stiffness) feel better,
rather than starting from scratch.

### Proprietary source guardrail

The user mentioned Aescripts' "Ease and Wizz" (a commercial, paid After Effects plugin bundling
its own motion-preset library) as a possible reference point. **Do not use its actual
implementation, code, preset values, or UI as a source** — it's a licensed proprietary product, not
free reference material, and reverse-engineering or copying its specific formulas would be copying
someone else's commercial IP. The general animation *principles* it's built on (overshoot,
anticipation, bounce, ease families) are standard, decades-old animation vocabulary that's fine to
draw from in the abstract — same vocabulary the Penner equations above already cover — but nothing
should be sourced from that plugin specifically. If the user's own found ActionScript snippets turn
out to be simple/personal scripts (not extracted from a paid tool), those are fine to use as
reference the normal way this section already describes.

## Files likely touched

Consistent with round 1's narrow footprint:

- `lib/museum.ts`: extend `RoomDescriptor` with whatever new per-room parameters direction C needs;
  add any "seen" tracking for direction A; add index/lookup helpers for direction D if pursued; add
  the spring/momentum simulation state and multi-room-commit logic for direction E if pursued
  (likely its own small module, e.g. `lib/fold-physics.ts`, rather than inlined into `page.tsx`,
  given its size and how independently testable pure physics math is).
- `app/page.tsx`: reveal-state handling for direction A, inspect-mode navigation for direction B,
  drawer UI for direction D if pursued, and replacing/extending the current `navigate` function's
  fixed-duration `setTimeout` transition with the `requestAnimationFrame`-driven spring loop for
  direction E.
- `app/museum.css`: new visual treatments for A and C; drawer styling for D; direction E likely
  needs its transform values driven from JS per-frame rather than a CSS `transition`, so expect the
  relevant room/fold rules to move from declarative CSS transitions to JS-set transform values
  during an active gesture, falling back to the existing CSS transition for reduced-motion.
- No new route, worker API, backend, or persistence beyond optional client-side "seen" tracking.

## Validation (in addition to round 1's existing acceptance tests, which must still pass)

- Reduced-motion users get a functional, non-jarring reveal for any new obscure-until-engaged
  mechanic, and get the existing (or simplified) fixed transition rather than the spring simulation
  for direction E.
- The three-view render/memory invariant from round 1 still holds — check this explicitly if any
  new state (seen-objects list, index data, in-flight physics state) is added; confirm it doesn't
  retain per-room DOM or grow unbounded over a full walkthrough, including during multi-room
  fly-through animation under direction E.
- Any new interaction has full keyboard and screen-reader support to the same standard as round 1's
  existing controls (accessible names, visible focus, no dead-end focus traps in a drawer/overview).
- Confirm on 360px, tablet, and desktop widths again — new UI (drawer, reveal overlay) must not
  break the layouts round 1 already validated.
- Direction E specifically: a hard flick that travels multiple rooms is exactly reversible (a
  symmetric flick/input returns to the identical starting depth, facing, and object — see the
  reversibility bullet in direction E's own section); the fold always comes to rest on a whole-number
  room depth, never stuck mid-transition; spin only triggers above a real velocity threshold, not on
  ordinary taps/clicks; performance stays smooth on real mobile hardware, not just desktop dev tools.

## Deployment: round 1 stays live, round 2 ships as a separate preview URL

The user explicitly wants to keep the current round 1 site live and compared against, not
overwritten — same pattern already used for Circus's `mom-film-site` (`VERSION_LINKS.md` there:
Version 1 stays at the root, Version 2 previews at `/v2/` until separately approved). Apply the
same pattern here, in the **same repo**, not a duplicate one:

- Build round 2 on its own branch off `main` (e.g. `redesign/v2-fold-physics` — name it for
  whatever direction(s) actually get built).
- Deploy it to a subpath under the existing `gh-pages` branch — `/ephemera-experience/v2/` — instead
  of replacing what's at the root. The existing `scripts/build-static-export.mjs` already takes a
  `--base` argument for exactly this kind of path rewriting; extend its usage (or the base value
  passed to it) to produce output rooted at `/ephemera-experience/v2/` rather than
  `/ephemera-experience/`, then merge that output into the `gh-pages` branch alongside (not instead
  of) what's already there at the root.
- Do not force-push over the existing `gh-pages` root content — this deploy must be additive.
- Update `VERSION_LINKS.md` (already present in the repo, matching the `mom-film-site` convention)
  with the new Version 2 preview URL and source branch, keeping the Version 1 (root) entry intact.
- The root URL (https://brooklynpostcards.github.io/ephemera-experience/) stays Version 1 until the
  user separately approves replacing it — round 2 being "done" does not mean it goes live at the
  root automatically.

## Handoff instruction for Astra

Read this file, `execution-spec.md`, `implementation-plan.md`, and `CONTEXT.md` in this workspace
first. Then look at the live site and the current `main` branch of
https://github.com/brooklynpostcards/ephemera-experience. Decide which of directions A–E (or an
alternative that better serves the stated goals) to pursue, in what order — direction E (physics-
based fold navigation) is the user's top priority and should be evaluated first — and report back a
short plan before writing code. This round is explicitly open for Astra to push back on any of the
above if something conflicts with what round 1 already learned. If a direction is rejected, say why,
so the reasoning isn't lost. Ship round 2 per the deployment section above — a new preview URL
alongside the existing live site, not a replacement of it.
