# Round 2 addendum — physics-based fold navigation, and version-link deployment pattern

Decided: 2026-09-10 (same day as the original round 2 scoping, added after the user tried the live
site further)

## Context

After the initial round 2 scope was written (see `2026-09-10_round2-direction.md`), the user used
the live site more and came back with a specific, strongly-felt direction that wasn't yet captured:
real physics-based navigation. This addendum documents that and a related deployment decision.

## What was decided

- **Physics-based fold navigation is the user's favorite direction and the flagship of round 2.**
  The user described wanting: sophisticated easing "math" for the folds, origami/gravity feel, spin
  on a hard swipe into/out of folds, and an organic ease-to-stop rather than the current fixed CSS
  transition. This is now **direction E** in `execution-spec-round2.md`, promoted to goal 0
  (evaluated and weighted above directions A–D, not just added alongside them).
- **The user offered old Flash/ActionScript physics formulas as possible reference material.**
  Decided: if supplied, Astra should treat them as math to reimplement in JS (spring constants,
  friction/damping values, velocity-to-rotation mapping) — never attempt to port ActionScript syntax
  directly, since it doesn't run in a browser. If nothing is supplied by the time this is built,
  proceed with standard, well-documented spring/momentum physics (the same family used by iOS
  scroll physics, Framer Motion, react-spring) rather than waiting.
- **Hard swipes may travel multiple rooms, not just one room with springier easing.** Confirmed
  explicitly — this is a real momentum system, not a re-skinned fixed-step transition. This changes
  round 1's reversibility contract for this specific interaction, so the spec defines a new,
  explicit reversibility rule for multi-room travel (see direction E's own section) rather than
  silently reusing the old one.
- **No new physics/animation library by default** (no GSAP, Matter.js, react-spring) — hand-rolled
  spring/friction math in `requestAnimationFrame` keeps round 1's "no new heavy dependency" rule
  intact. Astra can still justify a small, focused utility if the tradeoff is named explicitly.

## Separate decision: how round 2 gets deployed

- **The user wants to keep round 1 live and comparable, not overwritten.** Directly asked: would
  round 2 need a duplicate repo, or just a different `index.html`? Decided: neither — same repo, a
  new branch (e.g. `redesign/v2-fold-physics`), deployed to a `/v2/` subpath under the existing
  `gh-pages` branch, additive rather than force-pushed over the root. This exactly matches the
  pattern already established for Circus's `mom-film-site` (Version 1 stays at the root, Version 2
  previews at `/v2/` until separately approved) — same convention, new project.
- `VERSION_LINKS.md` in the repo was updated the same session to document this pattern explicitly,
  including the exact `--base` value to pass to `scripts/build-static-export.mjs` for a `/v2/`
  build, so Astra doesn't have to re-derive the deployment mechanics from scratch.
- The root URL only becomes Version 2 when the user explicitly approves that separately — finishing
  round 2's build is not itself authorization to replace what's live.

## Where the full detail lives

`execution-spec-round2.md`'s "Goal 0", "E. Physics-based fold navigation" section, and "Deployment:
round 1 stays live, round 2 ships as a separate preview URL" section have the complete technical
specification. This file is the distilled *why* and *what was asked for*, not a duplicate of the
spec's content.
