# html-docs

**Write once, publish from the browser.** `html-docs` is a full-stack workspace for creating, previewing, organizing, and sharing HTML, Markdown, rich-text documents, and PDFs.

Open the landing page, edit the sample document, and publish a shareable link without creating an account. Sign in when you want a dashboard to manage your documents.

## Features

- **Instant HTML preview** — edit HTML in Monaco and see the result beside the code.
- **Multiple documents** — organize each document into up to 20 named, searchable, reorderable tabs.
- **Multiple content types** — work in HTML, Markdown, a TipTap rich-text editor, or view imported PDFs.
- **File import** — drag and drop `.html`, `.md`, `.markdown`, `.docx`, and `.pdf` files into a document. DOCX files are converted to editable HTML with Mammoth.
- **Fast workflow** — previews update while typing and changes are saved automatically after a short pause.
- **Flexible publishing** — share the entire document or publish only the current tab.
- **Useful exports** — download HTML, Markdown, DOCX, or use the browser's print dialog to save a PDF. Imported PDFs can be downloaded directly.
- **Anonymous or signed-in** — create and edit without signing in, or use a Supabase magic link to manage documents in a dashboard.
- **Dark and light themes** — the app theme also propagates to supported previews.
- **Responsive editor** — switch among code, split, and preview layouts on desktop; use the compact tab bar on smaller screens.

## How it works

1. Open the landing page and edit the sample HTML.
2. Select **Share This Document**. A document and its first HTML tab are created in PostgreSQL.
3. Keep editing with autosave, or add more tabs from the sidebar.
4. Select **Publish** to copy a link to the current tab or the complete document.
5. Open the link in a private/incognito window to see exactly what a recipient sees.
6. Sign in to access the document dashboard and manage documents created while signed in.

Public view links are viewable by anyone. Anonymous edit access is kept in a document-scoped, `HttpOnly` cookie, so the creating browser can continue editing from the same browser.

## Tech stack

| Layer | Technology |
| --- | --- |
| App | React 19, React Router 7, TypeScript |
| Build | Vite 8, Tailwind CSS 4 |
| Database | PostgreSQL via `pg` |
| Authentication | Supabase Auth with email magic links and SSR cookies |
| Editors | Monaco, TipTap |
| Conversion | Marked, Mammoth, Turndown, `html-to-docx` |
| Testing | Vitest |

## Quick start

### Prerequisites

- Node.js 22.12+
- npm
- A PostgreSQL database
- A Supabase project for authentication
- A Supabase **direct** database connection string

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Supabase and the database

In the Supabase dashboard:

1. Open **Project Settings → Data API** and copy the project's URL and anon key.
2. Open **Connect** and copy the PostgreSQL **direct connection** URL.
3. Under **Authentication → URL Configuration**:
   - Set the local Site URL to `http://localhost:5173`.
   - Add `http://localhost:5173/auth/callback` to the allowed redirect URLs.
   - For production, add the production origin and `/auth/callback` URL too.

Create the local environment file:

```bash
cp .env.example .env
```

Set these values in `.env`:

```dotenv
DATABASE_URL=postgresql://...
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=...
IP_HASH_SALT=use-a-long-random-value
APP_URL=http://localhost:5173
```

Generate a rate-limit salt with:

```bash
openssl rand -hex 16
```

`DATABASE_URL` must be the direct connection, not the Supabase transaction-pooler URL. Keep all credentials server-side; only the app server needs the environment variables.

### 3. Run database migrations

The database user must be able to reference Supabase's `auth.users` table.

```bash
node --env-file=.env db/migrate.js
```

Migrations are tracked in `schema_migrations`, and already-recorded files are skipped. The migration command currently applies `db/migrations/*.sql` through `0008`; add future migrations to the list in `db/migrate.js` and keep each migration retry-safe.

### 4. Start the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server with HMR |
| `npm run build` | Build the client and SSR server into `build/` |
| `npm start` | Run the production build from `build/server/index.js` |
| `npm test` | Run the Vitest suite once |
| `npm run typecheck` | Generate React Router types and run TypeScript |
| `npm run desktop:dev` | Build the web app and launch the Electron desktop client |
| `npm run desktop:dist` | Build the desktop installer for the current platform |
| `npm run desktop:verify` | Verify the packaged Electron archive and runtime configuration |

## Desktop app

The Electron client runs the existing React Router server locally on a
random loopback port. It uses an account-scoped PGlite workspace in the OS
user-data directory, so documents can be created and edited without a hosted
server or network connection. The first account uses the legacy local workspace
when present; later accounts receive separate workspaces. The hosted web app
continues to use PostgreSQL and Supabase as before.

```bash
npm run desktop:dev
```

The desktop runtime is local/offline-first and syncs when configured. To
enable cloud sync, set `HTML_DOCS_REMOTE_URL` in `.env` before running
`npm run desktop:dev`, or
run `npm run desktop:dist` so the generated desktop package receives the
configured remote URL. The desktop sign-in flow opens the hosted magic-link
page in the system browser and returns an opaque desktop session to the app.
The dashboard shows sync state, pending work, and a conflict center with
keep-local/keep-hosted resolution. Native open/save dialogs are also enabled.

Do not put `DATABASE_URL` or privileged Supabase credentials in the desktop
package. The desktop client only receives an opaque sync session token.

For packaging, `electron-builder.yml` contains Windows NSIS and macOS DMG/ZIP
targets. A platform build must run on that platform; the current development
host can validate packaging with:

```bash
npx electron-builder --dir --linux --config electron-builder.yml
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string, including migrations |
| `DATABASE_CA_CERT_PATH` | Optional | Path to a PEM CA certificate when the database host is not in the system trust store |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key used for SSR authentication |
| `APP_URL` | Yes | Public application origin used for magic-link callbacks |
| `HTML_DOCS_REMOTE_URL` | Desktop | Hosted origin used by the Electron client for cloud sync |
| `IP_HASH_SALT` | Production | Secret salt used before storing hashed client IPs in rate-limit keys |
| `NODE_ENV` | Production | Enables production behavior and required-variable validation |
| `PORT` | Optional | Production server port; Fly.io config sets `8080` |

For desktop sign-in, add the following URL to Supabase Auth → URL Configuration → Redirect URLs:

```text
https://your-hosted-origin.example.com/desktop/auth/callback
```

## Limits and security boundaries

- A new landing-page document is limited to 1 MB of HTML.
- HTML and Markdown tabs are limited to 500 KB each; rich-text and PDF tabs are limited to 2.8 MB each.
- Imported PDF files must be smaller than 2 MB before Base64 encoding.
- Documents can contain at most 20 tabs.
- Anonymous creation is limited to 50 documents per IP per UTC day.
- Save requests are limited to 30 per document per minute; magic-link requests have separate email- and IP-based limits.
- HTML and Markdown editor/public previews render in sandboxed iframes without same-origin privileges. TipTap document tabs intentionally use the structured in-shell `DocEditor`/`EditorContent` path and require controlled parsing/rendering for pasted or imported content. Dashboard thumbnails use a separate sandboxed `srcDoc` path. Direct navigation to `/raw/:docId/:tabSlug` currently returns executable HTML in the application origin with a restrictive CSP but no response-level browser sandbox, so it requires separate security review.
- Edit authorization is checked on the server. Authentication cookies are `HttpOnly`.

The app does not sanitize HTML into a restricted component model. Treat published content as executable web content and review the iframe/CSP behavior before hosting untrusted users at scale.

## Project structure

```text
app/
  components/          Editors, previews, tabs, sharing, downloads, theme
  lib/                 Auth, database, CSP, limits, rate limits, conversions
  routes/              React Router loaders, actions, and pages
db/
  migrate.js           Migration runner
  migrations/          Ordered SQL migrations
  schema.sql           Legacy reference schema
test/                  Conversion, limits, and CSP tests
fly.toml               Fly.io deployment and health-check configuration
Dockerfile             Multi-stage Node 22 production image
```

Key routes:

| Route | Purpose |
| --- | --- |
| `/` | Landing-page editor and anonymous document creation |
| `/dashboard` | Signed-in document management |
| `/d/:docId/edit` | Document editor |
| `/d/:docId/:tabSlug` | Public document viewer |
| `/raw/:docId/:tabSlug` | Sandboxed source rendered for the viewer |
| `/download/:docId/:tabSlug` | Export endpoint |
| `/healthz` | Health check |

## Testing

```bash
npm test
npm run typecheck
node test/csp-check.mjs
```

The Vitest suite covers the configured unit and integration behavior, including conversion, limits, auth, local database, document, and desktop-sync areas. `test/csp-check.mjs` is a separate manual report-only analyzer; it is not part of `npm test`, does not fail on findings, and does not replace browser verification. No browser E2E suite is currently configured.

## Deployment

The app is a stateful Node.js SSR service and requires both PostgreSQL connectivity and Supabase Auth.

```bash
npm run build
NODE_ENV=production PORT=3000 npm start
```

The repository includes:

- `fly.toml`, with a release migration command and `/healthz` check.
- A multi-stage `Dockerfile` that runs as a non-root user.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) for platform-specific guidance.

Example Docker run:

```bash
docker build -t html-docs .
docker run --rm --env-file .env -p 3000:3000 -e PORT=3000 html-docs
```

Before deploying, update `APP_URL`, the Supabase Site URL, and the Supabase redirect URL to the production origin.
