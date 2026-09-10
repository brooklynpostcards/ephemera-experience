#!/usr/bin/env node
// Produces a plain static export in `static-export/` from the vinext/Cloudflare
// production build. The app is fully client-rendered (no D1/R2 bindings, no
// server-only logic) so the SSR shell it emits is safe to freeze as static
// HTML and serve from GitHub Pages instead of a Workers runtime.
//
// GitHub Pages project sites serve from a `/<repo>/` subpath, but the vinext
// build emits root-absolute asset paths (`/_next/...`, `/exhibits/...`) in
// both the HTML and the compiled client JS bundle (image src strings are
// baked in at build time). Pass --base=/ephemera-experience to rewrite those
// absolute paths to the subpath before publishing; omit it for a root deploy
// (e.g. a custom domain).
import { spawn } from 'node:child_process';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const distClient = new URL('./dist/client/', root);
const wranglerConfig = new URL('./dist/server/wrangler.json', root);
const outDir = new URL('./static-export/', root);
const port = 8788;

const baseArg = process.argv.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.slice('--base='.length).replace(/\/$/, '') : '';

async function rewriteBasePaths(dir) {
  if (!base) return;
  const rewritable = /\.(html|js|mjs|css|json)$/;
  const targets = ['/_next/', '/exhibits/', '/favicon.svg'];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = new URL(entry.name, dir.href.endsWith('/') ? dir : `${dir}/`);
    if (entry.isDirectory()) {
      await rewriteBasePaths(new URL(`${entry.name}/`, dir));
    } else if (rewritable.test(entry.name)) {
      let text = await readFile(path, 'utf8');
      for (const target of targets) {
        text = text.split(`"${target}`).join(`"${base}${target}`);
        text = text.split(`'${target}`).join(`'${base}${target}`);
        text = text.split('`' + target).join('`' + base + target);
      }
      await writeFile(path, text);
    }
  }
}

async function waitForServer(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

if (!existsSync(distClient)) {
  console.error('dist/client not found — run `npm run build` first.');
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await cp(distClient, outDir, { recursive: true });

const wrangler = spawn('npx', ['wrangler', 'dev', '--config', wranglerConfig.pathname.slice(1), '--port', String(port)], {
  cwd: root,
  shell: true,
});

try {
  await waitForServer(`http://127.0.0.1:${port}/`);
  const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  await writeFile(new URL('./index.html', outDir), html);
} finally {
  wrangler.kill();
}

await rewriteBasePaths(outDir);

// GitHub Pages ignores dotfiles (like _next) by default without this.
await writeFile(new URL('./.nojekyll', outDir), '');

console.log(`Static export written to ${outDir.pathname}${base ? ` (base: ${base})` : ''}`);
