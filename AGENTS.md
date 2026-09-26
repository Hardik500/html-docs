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
npm run copy:monaco       # Re-copy the Monaco editor assets into public/monaco
npm run desktop:dev       # Build web app and launch Electron development client
npm run desktop:dist      # Build desktop package for the current platform
npm run desktop:verify    # Verify the packaged Electron archive/runtime config
```

There is currently no lint script, formatter script, or separate browser-preview command. Do not claim or invent one. Use `npm run typecheck`, targeted tests, and the nearest existing style as the available static checks.

`npm run dev` and `npm run build` both run `scripts/copy-monaco.mjs` first. It copies the AMD assets out of the installed `monaco-editor` package into the gitignored `public/monaco/`, which the editor loads from `/monaco/vs` via `loader.config()` in `app/components/Editor.tsx`. This is deliberate: the loader previously fetched ~1 MB across 14 requests from cdn.jsdelivr.net, putting a third-party DNS + TLS handshake on the critical path of opening a document. Two things to preserve:

- Import `loader` from `@monaco-editor/react`, not from `@monaco-editor/loader` directly. Under SSR the direct import resolves to the CommonJS build, whose default export is an object, so `loader.config` is undefined and the edit route fails SSR with HTTP 500.
- Do not delete `public/monaco/` without re-running the build; nothing regenerates it at runtime.

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
public/             Static assets (public/monaco/ is generated — see below)
```

`app/routes.ts` is the route registry; keep it synchronized with route files. Server-only auth, database, CSP, rate-limit, and sensitive conversion code belongs in `.server.ts` modules and must not be imported into client bundles. `~/*` resolves to `app/*`.

Use strict TypeScript, type-only imports where required by `verbatimModuleSyntax`, React function components, Tailwind utilities, and existing theme tokens in `app/app.css`. Follow neighboring files for export style and formatting; formatting is not mechanically enforced. React hooks must remain unconditional; do not copy the existing PDF early-return pattern in `PreviewIframe.tsx`, and fix that transition safely when touching it.

## Database Round Trips

The hosted database is remote, so **statement count on a request path is latency**. A single `SELECT 1` against the hosted pooler measured ~194 ms round trip from a European client (~224 ms TCP connect), which is 3-4x a same-region round trip. Every extra statement on a hot path is a user-visible stall.

Rules that follow from this:

- Issue independent queries with `Promise.all`, never sequentially. Both document loaders and the save action's pre-flight checks already do this.
- Never loop a statement per row. The save action batches tab inserts/updates/deletes through `UNNEST(...)` so it costs a constant ~7 statements whether the document has 1 tab or 20. Keep it that way: a per-tab loop here costs ~200 ms per tab per autosave.
- Fold related writes into one statement rather than two round trips. `recordDocumentChange()` in `app/lib/sync.server.ts` bumps the revision and appends the sync-feed row in a single data-modifying CTE, and optionally folds in a title update.
- `withTransaction()` still issues an explicit `BEGIN`/`COMMIT`; that is two unavoidable round trips. Do not try to remove them by giving up the row lock or the revision guard.

`PERF_LOG=1` makes `app/lib/perf.server.ts` emit one parseable line per request, e.g. `[perf] edit auth=2ms q_doc=11ms total=13ms`. Use it to confirm a change actually reduced work, and prefer counting statements (for example with `pg_stat_statements`) over inferring it from timings.

## Document Content Types and Google Docs

Per-tab content is HTML, Markdown, PDF, or TipTap `doc`. `app/lib/doc.ts` documents that a `doc` tab holds an **HTML fragment**, and `validateTabContent()` now rejects a complete document for `contentType: "doc"` with a message pointing the caller at `"html"`, because `docToHtml()` would otherwise nest a second `<html>` inside `<body>`.

`app/lib/googleDocs.ts` normalizes Google Docs, Sheets, and Word export markup on the **agent write path only** (`prepareAgentTabContent()` in `app/lib/document-input.ts`, used by `create_document`, `update_document`, and `update_tab`): the `<b id="docs-internal-guid-…">` wrapper is removed, presentational inline CSS is dropped, and `font-weight`/`font-style`/`text-decoration` are promoted to `<strong>`/`<em>`/`<u>`. It is a no-op for content that is not Google-shaped, and it recovers a Webpage export's `<title>` for use as the document and tab name.

Two deliberate limits, both worth preserving:

- It is **not** applied to content typed in the web editor. Authored HTML must never be rewritten behind the user's back, so `validateSaveTabs()` is left alone and the MCP layer adapts its `content`/`contentType` arguments to the validator's `html`/`content_type` shape.
- It does **not** unwrap a full HTML document. Full documents render correctly in the preview and at `/raw`; only the `doc` content type is broken by them, and that is rejected at validation time instead.

The MCP tool descriptions in `app/routes/mcp.ts` document the `contentType` contract (`CONTENT_TYPE_GUIDE`). Keep that guidance in sync with the validators; an agent that has to guess produces a document that looks fine in the editor and is broken on export.

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
- Dashboard thumbnails are served by `app/routes/thumb.$docId.$tabSlug.tsx` and framed with `sandbox="allow-scripts"`, which gives them the same opaque origin the old `srcDoc` version had. The difference is that the policy now arrives as a real `RAW_CSP` response header rather than being inherited from the app shell, so the frame is sandboxed by `RAW_CSP` and not by `APP_CSP`. That route is **owner-only** — unlike `/raw`, which is public because that is how shared links work — so do not relax it into a second public read surface. Its content is a body-truncated slice of the first tab, converted for its content type exactly as `/raw` does. `test/thumb-route.test.ts` covers the auth, ownership, content-type, PDF, and CSP behaviour; `loading="lazy"` only works because the HTML is served from a URL instead of inlined.
- TipTap document tabs intentionally render structured rich-text through `DocEditor`/`EditorContent` in the application shell. This is a separate editor boundary, not raw HTML preview. Review TipTap parsing/rendering, pasted or imported content, links, images, and allowed attributes; never replace it with unrestricted raw-HTML injection.
- Never move the raw HTML/Markdown preview path into the privileged application shell.

`app/lib/csp.server.ts` is the single CSP policy source. `test/csp-check.mjs` imports `RAW_CSP` from it rather than keeping a hand-copied mirror, so the two cannot drift; matching semantics live in `test/csp-policy.mjs` and are unit-tested against the real policy in `test/csp-policy.test.ts`. The analyser matches hosts exactly, so a lookalike such as `https://cdnjs.cloudflare.com.evil.test` is rejected rather than treated as allowlisted, and it evaluates the actual target URL of each network call instead of assuming `connect-src` is `'none'`.

`node test/csp-check.mjs` is a gate: every fixture must match the expectation it declares, in **both** directions, and it exits non-zero otherwise.

- A fixture declares its intent with an HTML marker: `<!-- csp-expect: blocked -->` or `<!-- csp-expect: allowed -->` (the default for a new fixture).
- An `allowed` fixture fails if anything it references is blocked.
- A `blocked` fixture fails if anything it references is *allowed* (a bypass regression), and also if nothing it references is blocked (the fixture has silently decayed into a no-op).
- A malformed marker value is an error, not a silent fallback to `allowed`.

Treat that exit code as meaningful. It used to be permanently red, because every blocked finding counted as a failure — which is the same as having no gate at all. Give a new fixture the marker matching its intent, and expect the negative fixtures to object if you relax the policy.

The app-shell headers in `app/root.tsx` are applied through a `headers` export, because React Router only honours loader response headers for resource routes; returning a `Response` from that loader silently discarded them. Verify with `curl -I <origin>/ | grep -i content-security-policy` — if that grep comes up empty, the policy is not being sent. `APP_CSP` sets `object-src 'none'`, so no shell surface may use `<embed>` or `<object>`; that is why PDFs preview through a same-origin `<iframe src="/raw/...">`. `test/app-shell-headers.test.ts` enforces both.

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
- `public/monaco/` (gitignored; regenerated by `scripts/copy-monaco.mjs` on `predev`/`prebuild`)

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

This analyser exits non-zero when a fixture does not match its declared expectation, so treat that exit code as a gate. It is still static analysis, so verify the actual response headers (`curl -I`) and browser enforcement for every rendering path. Cover the landing/editor `PreviewIframe`, the public-viewer iframe loading `/raw`, the owner-only `/thumb` dashboard thumbnails, direct top-level navigation to `/raw/:docId/:tabSlug`, the PDF previews on both the editor and the public viewer, and TipTap rich-text paste/import/rendering behavior.

For the direct-navigation `/raw` boundary, drive a real browser:

```bash
node scripts/verify-raw-isolation.mjs <origin> <docId> <tabSlug>
```

It asserts an opaque origin, unreachable cookies, isolated web storage, a blocked same-origin `fetch`, and no opener access, while confirming the document still renders. It uses a headless Chromium from the Playwright cache; set `CHROME_PATH` to override.

There is no configured browser E2E suite, so use proportionate browser verification for UI, preview, autosave, auth callbacks, and public-view flows.

`npm run desktop:verify` only performs limited package/runtime-config checks; it does not prove Electron isolation, preload safety, navigation restrictions, or runtime behavior. Desktop changes also need a real `npm run desktop:dev` or packaged-app smoke test when feasible.

A task is not complete merely because code compiles. Confirm the requested behavior, run the relevant checks, and report any environment-dependent checks that could not be executed.

## Continuous Integration

Two workflows with different purposes:

- `.github/workflows/ci.yml` — every push to `main`, every pull request, and manual dispatch. Fast: `npm ci`, the CSP gate, `npm test`, `npm run typecheck`, `npm run build`, then a check that `build/client/monaco/vs/loader.js` exists. That last step matters because a green build that ships no editor assets still renders a blank editor pane.
- `.github/workflows/desktop.yml` — packaging only, path-filtered, across Linux/macOS/Windows. It re-runs `csp-check`, `npm test`, and `npm run typecheck` itself rather than depending on CI, so an installer is never produced from an unverified tree.

The CSP gate is a separate named step in both, deliberately not folded into `npm test`: its exit code is the signal, and a step that always reports success would hide it. If you add a check that must block a merge, put it in `ci.yml` as its own step and run it locally first. No step reads a `.env`, so a check that needs real credentials will fail in CI rather than quietly pass — keep it that way.

`PreviewIframe` is imported **statically** by both `_index.tsx` and `d.$docId.edit.tsx`. Do not make it `lazy()`: it renders immediately on both routes, so splitting it added a round trip to the critical path without deferring anything, and Vite warns `[INEFFECTIVE_DYNAMIC_IMPORT]` because `_index.tsx` already imports it statically. Measured over 5 cold runs each, the static import moved the preview from a 240 ms median to 52 ms with identical request count and bytes. `Editor` (Monaco) and `DocEditor` (TipTap) are genuinely lazy and should stay that way.

## Product and Documentation Accuracy

- Update `README.md` or other current docs when setup, commands, limits, architecture, or behavior changes.
- Do not claim automatic 30-day cleanup, permanent hosted retention, private documents, automatic startup migrations, or other guarantees unless current code and operations prove them.
- `DEMO_SCRIPT.md` is a useful product-demo reference when present, including its warning against unsupported claims.
- Keep changes surgical. Do not refactor unrelated routes, components, migrations, or generated output.
- Preserve existing user work and uncommitted files. Never reset, clean, or overwrite unrelated changes.
