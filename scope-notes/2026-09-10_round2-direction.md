# Round 2 direction — decisions from chat

Decided: 2026-09-10

## Context

Round 1 (the folded-paper museum walkthrough) shipped and was verified live at
https://brooklynpostcards.github.io/ephemera-experience/. This session's job was to figure out what
a second round of changes should do, now that the site could actually be navigated and evaluated as
a real experience rather than just a spec.

## What was decided

- **Go ahead with a second round covering all four improvement areas raised**: making arrival at an
  object feel like a discovery, smoother navigation, more per-room visual variation, and some way to
  browse/jump without a full map. None were dropped.
- **Keep the folded-paper concept.** Explicitly confirmed — round 2 deepens the existing material
  language, it does not replace it with a different visual system.
- **"Pixelating the ephemera until you click on it" was raised as one possible mechanic**, alongside
  "something that shows the process" and "smoother navigation" — these were offered as directions to
  explore, not as fixed requirements. The underlying goal (arrival feels earned, not just loaded) is
  the fixed part; the specific mechanic is explicitly open for Astra to accept, adapt, or replace.
- **Constraints should be designed to unlock maximum creativity for the model doing the build**, not
  written as a narrow checklist. This is why `execution-spec-round2.md` is structured as goals +
  real constraints + several evaluatable directions, rather than a fixed feature list — matching how
  round 1's own spec was built (constraints as the creative engine, not obstacles).
- **This is a look-first handoff to Astra**, not an immediate build order. Astra should read the
  round 2 spec, look at the live site and the current GitHub repo, and decide to either proceed with
  (some/all of) the proposed directions or come back with notes on why not, before writing code.
- Before finalizing the spec, a deliberate pass was run to avoid defaulting to the obvious "just
  animate the transform harder" approach to motion — this surfaced the View Transitions API,
  stepped/flip-book timing, CSS-only pixelation (no canvas), and velocity-aware pacing as techniques
  worth Astra's evaluation. These are documented in the spec's own "Motion & navigation techniques"
  section, not repeated here.

## What this does not decide

- Which specific directions (A–D in the round 2 spec) Astra should actually build, or in what order.
  That choice is deliberately left open for Astra's own evaluation against the live site.
- Whether "collecting" ever becomes functional (tied to the NFT collection) rather than cosmetic —
  still an open question tracked in this workspace's `CONTEXT.md`, untouched by this round.

## Where the full detail lives

`execution-spec-round2.md` (this workspace, mirrored to the real checkout in `arm_data`) has the
complete goals, constraints, evaluatable directions, and motion-technique options. This file is the
distilled *why* behind that spec, not a duplicate of its content.
