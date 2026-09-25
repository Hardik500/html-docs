# HTML Docs Repository Guide

## Project

`html-docs` is a full-stack document workspace for writing, previewing, organizing, publishing, syncing, and exporting HTML, Markdown, TipTap rich-text documents, and PDFs.

- Hosted runtime: React 19, React Router 7 in SSR mode, TypeScript, Vite, Tailwind CSS, PostgreSQL, and Supabase Auth.
- Desktop runtime: Electron, a local Express server, and PGlite stored outside the repository.
- Testing: Vitest.
- Runtime: Node.js 22.12+ and npm.

React Router SSR is intentional. Do not switch the app to SPA mode as a shortcut.

## Authoritative Commands

Run commands from the repository root.

```bash
npm ci                    # Reproducible clean install; preferred for CI and verification
npm run dev               # Development server with HMR; this is the local preview
npm test                  # Vitest suite
npm run typecheck         # Generate React Router types, then run strict TypeScript
npm run build             # Build client and SSR server into build/
npm start                 # Serve an existing production build
npm run desktop:dev       # Build web app and launch Electron development client
npm run desktop:dist      # Build desktop package for the current platform
npm run desktop:verify    # Verify the packaged Electron archive/runtime config
```

There is currently no lint script, formatter script, or separate browser-preview command. Do not claim or invent one. Use `npm run typecheck`, targeted tests, and the nearest existing style as the available static checks.

When adding or upgrading dependencies, use npm so `package-lock.json` is updated correctly. Use `npm ci` for clean/reproducible installs.

## Architecture

```text
app/
  components/       React UI, editors, preview, tabs, sharing, exports
  lib/              Auth, database, CSP, limits, conversion, sync, runtime logic
  routes/           React Router pages, loaders, actions, and resource routes
  types/            Ambient declarations
  app.css           Tailwind import, design tokens, global/editor styles
  root.tsx          App shell and root error boundary
  routes.ts         Explicit route registry
db/
  migrate.js        Hosted PostgreSQL migration runner
  migrations/       Ordered hosted migrations
  schema.sql        Legacy reference schema, not the current schema
electron/
  main.cjs          Electron lifecycle and local server startup
  local-server.mjs  Authenticated loopback Express server
  preload.cjs       Narrow Electron bridge
  sync-manager.cjs  Desktop authentication, token storage, and sync
test/               Vitest tests, fixtures, and manual CSP analyzer
public/             Static assets
```

`app/routes.ts` is the route registry; keep it synchronized with route files. Server-only auth, database, CSP, rate-limit, and sensitive conversion code belongs in `.server.ts` modules and must not be imported into client bundles. `~/*` resolves to `app/*`.

Use strict TypeScript, type-only imports where required by `verbatimModuleSyntax`, React function components, Tailwind utilities, and existing theme tokens in `app/app.css`. Follow neighboring files for export style and formatting; formatting is not mechanically enforced. React hooks must remain unconditional; do not copy the existing PDF early-return pattern in `PreviewIframe.tsx`, and fix that transition safely when touching it.

## Databases and Migrations

The hosted PostgreSQL schema and desktop PGlite schema are separate.

- Add hosted schema changes as ordered SQL files under `db/migrations/`.
- Register every new hosted migration in the hard-coded `migrations` array in `db/migrate.js`; adding a SQL file alone does not make it run.
- Do not use `db/schema.sql` as the current production schema.
- For behavior shared by hosted and desktop runtimes, update and test both `db/migrations/` and `app/lib/local-schema.server.ts`.
- Desktop schema changes must advance `LOCAL_SCHEMA_VERSION` and append a versioned entry to `LOCAL_MIGRATIONS` when needed.
- Keep SQL parameterized and migration files retry-safe. `db/migrate.js` currently executes each migration and its `schema_migrations` insert as separate operations rather than one transaction; when changing the runner, use one client/transaction per migration and add failure/retry coverage.

Hosted local migration command:

```bash
node --env-file=.env db/migrate.js
```

Do not run a migration against shared, staging, or production infrastructure unless the user requested it and the target connection is confirmed.

## Security Boundaries

User-authored HTML is executable content by design; the application does not convert it into a safe restricted component model. Treat every rendering path as a separate security boundary:

- Landing/editor previews use `app/components/PreviewIframe.tsx` and must remain sandboxed without `allow-same-origin` unless a reviewed security design explicitly changes that model.
- The public viewer in `app/routes/d.$docId.$tabSlug.tsx` has its own sandboxed iframe that loads `/raw/:docId/:tabSlug`; do not assume it inherits the editor's injected meta CSP.
- `/raw/:docId/:tabSlug` returns authored HTML as a top-level response in the application origin. It is isolated by a `sandbox allow-scripts` directive in `RAW_CSP` with no `allow-same-origin`, so the document loads in an opaque origin. This was verified in a real browser under direct navigation: `window.origin` is `null`, `document.cookie` throws `SecurityError`, `localStorage`/`sessionStorage` throw, and a same-origin `fetch` is refused by `connect-src`. Re-run `node scripts/verify-raw-isolation.mjs <origin> <docId> <tabSlug>` after changing `RAW_CSP`, the `sandbox` flags, or the `/raw` route.
- Dashboard thumbnails use a separate `srcDoc`/sandbox path in `app/routes/dashboard.tsx`. Do not assume they receive the same CSP as `PreviewIframe`; keep this surface covered when policies change.
- TipTap document tabs intentionally render structured rich-text through `DocEditor`/`EditorContent` in the application shell. This is a separate editor boundary, not raw HTML preview. Review TipTap parsing/rendering, pasted or imported content, links, images, and allowed attributes; never replace it with unrestricted raw-HTML injection.
- Never move the raw HTML/Markdown preview path into the privileged application shell.

`app/lib/csp.server.ts` is the single CSP policy source. `test/csp-check.mjs` imports `RAW_CSP` from it rather than keeping a hand-copied mirror, so the two cannot drift; matching semantics live in `test/csp-policy.mjs` and are unit-tested against the real policy in `test/csp-policy.test.ts`. The analyser matches hosts exactly, so a lookalike such as `https://cdnjs.cloudflare.com.evil.test` is rejected rather than treated as allowlisted, and it evaluates the actual target URL of each network call instead of assuming `connect-src` is `'none'`. It exits non-zero when a fixture references a blocked subresource, so it can gate CI.

The analyser is still static only: it cannot validate real response headers or browser enforcement. Keep per-surface coverage for the editor, the public viewer, direct `/raw`, and dashboard thumbnails, and use `scripts/verify-raw-isolation.mjs` for the `/raw` boundary.

Other security invariants:

- Preserve server-side edit authorization, ownership checks, content limits, rate limits, and transactional writes.
- Hosted production auth must use HTTPS and appropriate `Secure`, `HttpOnly`, and `SameSite` protections. The current Supabase wrapper explicitly forces `HttpOnly`, but does not guarantee `Secure`; do not claim that protection until actual production `Set-Cookie` behavior is configured and tested. The Electron loopback token intentionally uses `HttpOnly; SameSite=Strict` over `http://127.0.0.1`; do not add `Secure` unless the local server moves to HTTPS.
- Packaged desktop sync remotes must use HTTPS; only loopback development origins may use HTTP. The current build/runtime validation is incomplete, so do not package or sync against a plaintext remote origin.
- Do not expand the current broad PostgreSQL `rejectUnauthorized: false` exception. Prefer the system trust store or a narrowly scoped CA configuration for any endpoint that genuinely requires it.
- Never commit `.env`, database credentials, Supabase privileged credentials, auth codes, or desktop bearer tokens.
- Never put database or privileged Supabase credentials in the Electron package. `electron/runtime-config.json` may contain the hosted origin only.
- Preserve Electron `contextIsolation`, disabled Node integration, sandboxing, navigation restrictions, and the narrow preload bridge.

## Generated and Historical Paths

Do not hand-edit:

- `node_modules/`
- `build/`
- `.react-router/`
- `release/`
- `electron/runtime-config.json`
- `package-lock.json`

The desktop PGlite database lives under Electron user-data storage outside the repository. Do not edit it during normal development.

Files under `docs/superpowers/` are historical design/planning material, not current project policy. Prefer implemented code and current tests over prose. Use `README.md` and deployment files as secondary references, and correct them when they conflict with verified behavior.

`DEPLOYMENT.md` correctly requires an explicit release/pre-deploy or manual migration command for platforms that do not provide one. The verified Fly.io release migration is `release_command = "node db/migrate.js"` in `fly.toml`; verify the actual target platform configuration before every migration-bearing deployment.

## Verification

Start with the narrowest relevant test, then expand according to risk.

General web or route changes:

```bash
npm test
npm run typecheck
npm run build
```

Electron, packaging, preload, local server, sync, or desktop schema changes:

```bash
npm test
npm run typecheck
npm run desktop:dist
npm run desktop:verify
```

CSP/preview changes also require:

```bash
node test/csp-check.mjs
```

This analyser exits non-zero when a fixture references a blocked subresource, so treat that exit code as a gate. It is still static analysis, so verify the actual response policy and every rendering path. Cover the landing/editor `PreviewIframe`, the public-viewer iframe loading `/raw`, dashboard thumbnails, direct top-level navigation to `/raw/:docId/:tabSlug`, and TipTap rich-text paste/import/rendering behavior.

For the direct-navigation `/raw` boundary, drive a real browser:

```bash
node scripts/verify-raw-isolation.mjs <origin> <docId> <tabSlug>
```

It asserts an opaque origin, unreachable cookies, isolated web storage, a blocked same-origin `fetch`, and no opener access, while confirming the document still renders. It uses a headless Chromium from the Playwright cache; set `CHROME_PATH` to override.

There is no configured browser E2E suite, so use proportionate browser verification for UI, preview, autosave, auth callbacks, and public-view flows.

`npm run desktop:verify` only performs limited package/runtime-config checks; it does not prove Electron isolation, preload safety, navigation restrictions, or runtime behavior. Desktop changes also need a real `npm run desktop:dev` or packaged-app smoke test when feasible.

A task is not complete merely because code compiles. Confirm the requested behavior, run the relevant checks, and report any environment-dependent checks that could not be executed.

## Product and Documentation Accuracy

- Update `README.md` or other current docs when setup, commands, limits, architecture, or behavior changes.
- Do not claim automatic 30-day cleanup, permanent hosted retention, private documents, automatic startup migrations, or other guarantees unless current code and operations prove them.
- `DEMO_SCRIPT.md` is a useful product-demo reference when present, including its warning against unsupported claims.
- Keep changes surgical. Do not refactor unrelated routes, components, migrations, or generated output.
- Preserve existing user work and uncommitted files. Never reset, clean, or overwrite unrelated changes.
