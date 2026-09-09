# Ephemera Walkthrough — implementation plan

Planned: 2026-09-09

## Workspace routing

The external volume is `D:` and its label is `folders`. Begin at `D:/arm/CLAUDE.md` and follow its
Ephemera website route to `D:/arm/factories/website/ephemera-experience/` for project context and
planning. Under the mirror rule documented there, use the sibling
`D:/arm_data/factories/website/ephemera-experience/` as the real website checkout and
`D:/arm_data/archives/08_ephemera/` as the source archive. Do not place the website or media inside
the git-tracked `arm/` planning tree.

## Intended result

Build a single-page, responsive 3D walkthrough from lightweight HTML, CSS, and React. The visitor
moves through an apparently continuous sequence of exhibit rooms. The site never constructs or
loads a complete museum map: it derives each room from its position and keeps only the previous,
current, and next room mounted.

The first version uses the 72 small JPGs already present in `public/exhibits/` (5.74 MB total;
about 82 KB each). It creates no additional image derivatives and does not change the source
archive.

## Experience

- Open directly inside the first exhibit room, with no marketing page in front of it.
- Show a framed ephemera object, room number, object title, and minimal movement instructions.
- Move forward or backward with on-screen arrows, keyboard arrows/WASD, mouse wheel, or horizontal
  touch swipe.
- Turn left or right to inspect alternate walls before advancing.
- Animate each step as a short camera move through a doorway into the next generated room.
- Allow the visitor to return to the exact previous room and view. Navigation is deterministic.
- Respect reduced-motion preferences by replacing travel animation with a short crossfade.
- On small screens, enlarge touch targets, reduce perspective depth, preserve the artwork's full
  aspect ratio, and keep controls clear of browser safe areas.

## Lightweight architecture

Use one client component and one stylesheet. Do not add Three.js, a game engine, 3D models, video,
canvas textures, or generated artwork. CSS transforms (`perspective`, `translate3d`, and rotations)
provide spatial depth; semantic HTML provides the walls, frame, doorway, labels, and controls.

Represent navigation with a small state tuple:

```text
position = { roomIndex, facing, visitSeed }
```

`describeRoom(roomIndex, facing, visitSeed)` calculates the exhibit image, wall treatment, frame
shape, lighting tone, and adjacent room references. It uses a seeded deterministic function, so
backtracking regenerates the same room without storing a map.

`buildWindow(position)` recursively requests only three descriptors:

```text
describe previous -> describe current -> describe next -> stop
```

The render window contains at most three room elements and three image elements. After a completed
step, discard the room now two positions behind, shift the window, and generate one new adjacent
descriptor. Preload only the next image. Revoke or remove superseded image references immediately.

Cycle through the 72-image manifest with a coprime step and seeded offset so nearby rooms do not
feel alphabetically ordered. The sequence may continue indefinitely while remaining reversible;
after all 72 objects, the layout varies while object attribution stays accurate.

## Files for the Astra execution pass

1. Restore `app/page.tsx` as the client-side walkthrough and keep the exhibit manifest there or in
   one very small adjacent module.
2. Replace the starter theme in `app/globals.css` with the full-screen CSS-perspective museum,
   responsive controls, focus states, and reduced-motion behavior.
3. Update `app/layout.tsx` metadata to `Ephemera Museum` and describe the interactive archive.
4. Keep the existing 72 files in `public/exhibits/`; do not copy or recompress them.
5. Preserve the existing Sites project ID and current Vinext structure.

## Validation

- Production build completes.
- Only three rooms and no more than three exhibit images are mounted after repeated movement.
- Moving forward twice and backward twice restores the original object and facing.
- Keyboard, wheel, buttons, and swipe each advance exactly one step per gesture.
- Layout remains usable at 360 px, tablet width, and desktop width; artwork never crops.
- Focus is visible, controls have accessible names, and reduced-motion mode avoids simulated travel.
- Missing image data produces a labeled empty frame without breaking navigation.
- Total added source should remain small; no new media or dependency is introduced.

## Usage cutoff for execution

At the start of the Astra pass, record the account's weekly model-usage percentage. Stop Astra and
alert the user as soon as the weekly usage meter reaches 50% used. Do not begin or continue work if
the meter is already at or above 50%. Report the baseline, latest reading, code state, and remaining
validation work before stopping.
