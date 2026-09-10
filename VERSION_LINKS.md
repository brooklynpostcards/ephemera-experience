# Ephemera Museum — quick links

- [Live site](https://brooklynpostcards.github.io/ephemera-experience/)
- [Source repo](https://github.com/brooklynpostcards/ephemera-experience)
- [Deployed build source](https://github.com/brooklynpostcards/ephemera-experience/tree/gh-pages)

## What's deployed

The live site is a static export of the `main` branch's production build (see
`scripts/build-static-export.mjs`). The app itself has no server or database
needs, so the export freezes the rendered HTML and rewrites the build's
root-absolute asset paths to work under GitHub Pages' `/ephemera-experience/`
subpath.

- `main`: source code, editable and reviewable normally.
- `gh-pages`: build output only, force-pushed by the export script — don't
  hand-edit it.

## To redeploy after a change on `main`

```text
npm run build
node scripts/build-static-export.mjs --base=/ephemera-experience
```

Then push the contents of `static-export/` to the `gh-pages` branch.
