# Ephemera Museum — quick links

- [Version 1: current public site](https://brooklynpostcards.github.io/ephemera-experience/)
- [Version 1 source (main branch)](https://github.com/brooklynpostcards/ephemera-experience)
- [Version 2: Task 20 preview](https://brooklynpostcards.github.io/ephemera-experience/v2/)
- [Version 2 source checkpoint (`b18c9b0`)](https://github.com/brooklynpostcards/ephemera-experience/tree/redesign/v2-fold-physics)
- [Deployed build source (gh-pages branch)](https://github.com/brooklynpostcards/ephemera-experience/tree/gh-pages)

Version 2 is still in progress. The public link is a Task 20 direction/feel checkpoint for the
physics-based fold navigation, not a finished or approved replacement for Version 1.

## What's deployed

Version 1 is a static export of the `main` branch's production build (see
`scripts/build-static-export.mjs`). The app itself has no server or database
needs, so the export freezes the rendered HTML and rewrites the build's
root-absolute asset paths to work under GitHub Pages' `/ephemera-experience/`
subpath.

- `main`: source code, editable and reviewable normally.
- `gh-pages`: build output only. Holds Version 1 at the root path
  (`/ephemera-experience/`) and the Task 20 Version 2 preview under `/v2/`.
  Don't hand-edit either deployment.

## To redeploy Version 1 after a change on `main`

```text
npm run build
node scripts/build-static-export.mjs --base=/ephemera-experience
```

Then push the contents of `static-export/` to the `gh-pages` branch, replacing what's at the root.

## Deploying round 2 — additive, not a replacement

The user wants Version 1 to stay live and comparable against Version 2, matching the pattern
already used for Circus's `mom-film-site` (its own `VERSION_LINKS.md`: Version 1 stays at the root,
Version 2 previews at `/v2/` until separately approved). Apply the same pattern here:

1. Build round 2 on its own branch off `main` (e.g. `redesign/v2-fold-physics`).
2. Run the static export with a `/v2/`-suffixed base so its asset paths resolve correctly there:
   `node scripts/build-static-export.mjs --base=/ephemera-experience/v2`
3. Merge that output into the `gh-pages` branch under a `/v2/` subfolder, **alongside** the existing
   root content — do not force-push over what's already at the root. The root Version 1 build and
   the new `/v2/` Version 2 build coexist as sibling folders in the same `gh-pages` branch.
4. Add the new Version 2 preview URL and source branch to this file, above, without removing the
   Version 1 entry.
5. The root URL only becomes Version 2 if the user explicitly approves replacing it later — that is
   a separate, deliberate step, not an automatic consequence of round 2 being finished.
