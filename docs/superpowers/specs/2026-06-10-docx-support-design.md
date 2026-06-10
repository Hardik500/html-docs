# Docx Support with WYSIWYG Editing — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Let users drop `.docx` files into a document and edit the imported content with a
Google Docs-style WYSIWYG editor. Also let users create blank WYSIWYG tabs from
scratch. Docx is an import format only — content lives on as HTML and is shared
as a web page like every other tab type.

## Decisions

| Question | Decision |
|---|---|
| Docx fate after upload | Converted to HTML once at import (mammoth); original binary not kept |
| WYSIWYG scope | Only `doc` tabs; HTML/markdown tabs keep the Monaco code editor |
| Export back to .docx | Not supported (can be added later) |
| Embedded images | Inline base64, with a raised 2.8 MB per-tab limit for `doc` tabs |
| Editor library | TipTap (ProseMirror) with a custom slim Tailwind toolbar |
| Blank doc tabs | Yes — "Doc" option in the sidebar "+" menu |

## Data Model

- `tabs.content_type` gains a fourth value: `'doc'`. The column is unconstrained
  TEXT (migration 0005), so **no DB migration is needed**.
- Content is stored in the existing `tabs.html` column as an HTML *fragment*
  (mammoth output / TipTap `getHTML()`), mirroring how markdown tabs store raw
  markdown source.
- Size limit for `doc` tabs: `MAX_DOC_BYTES = 2_800_000` (same as PDF), enforced
  in the save action alongside the existing per-type checks. HTML/markdown tabs
  keep the 500 KB limit.

## Import Flow (client-side)

In `TabSidebar`'s drop handler (`app/components/TabSidebar.tsx`):

1. Accept files matching `.docx` extension or the docx MIME type.
2. Read as ArrayBuffer; convert with `mammoth` (browser build)
   `convertToHtml` — images become inline base64 `<img>` tags by default.
3. Create a tab with `content_type: 'doc'`, named after the file (extension
   stripped), via the existing `onDropFiles` pathway.
4. Errors are surfaced, not swallowed:
   - Conversion failure → user-visible error ("Couldn't convert <name>").
   - Converted HTML over 2.8 MB → user-visible error naming the file.

## Blank Doc Tabs

- `onAdd` in `TabSidebar` / `handleAddTab` in the edit route accept `"doc"` as
  a type; the "+" menu shows Doc alongside HTML and MD.
- New blank doc tabs are seeded with `<h1>Tab N</h1><p></p>` so the existing
  title auto-derivation keeps working.

## Editing UX (`app/routes/d.$docId.edit.tsx`)

When the active tab is a `doc` tab:

- The Monaco pane **and** the preview iframe are replaced by one full-width
  TipTap editor — the WYSIWYG view is its own preview.
- The Code/Split/View layout toggle and the HTML/MD type toggle are hidden.
- Toolbar (slim, Tailwind, matching app styling): bold, italic, underline,
  strikethrough, headings (H1–H3), bullet/ordered lists, blockquote, link,
  undo/redo.
- TipTap extensions: StarterKit, Underline, Link, Image, Table/TableRow/
  TableCell/TableHeader. Imported tables render and are editable in place;
  no table-creation UI in v1.
- The editor content area uses the same prose styles as published view, so
  what you edit is what readers see.
- `editor.onUpdate` → `editor.getHTML()` → existing `handleHtmlChange`
  pipeline (dirty marking, 1 s debounced autosave, title auto-derivation from
  the first heading).
- The TipTap editor component is lazy-loaded like Monaco, so non-doc editing
  pays no bundle cost.

## Rendering

- New helper `docToHtml(fragment)` (in `app/lib/`, sharing `PROSE_STYLE` with
  `markdown.ts`) wraps the stored fragment in a full HTML document.
- Treat `doc` like `markdown` minus the marked-parse step in:
  - `PreviewIframe` (dashboard thumbnails + any remaining preview surfaces)
  - published view route `d.$docId.$tabSlug` / `raw.$docId.$tabSlug`
  - dashboard previews
- Sidebar tab rows get a "DOC" badge alongside the existing MD/PDF badges.
- Full-text search in the sidebar already operates on raw tab content, which
  is text for `doc` tabs — works without changes.

## Out of Scope (deliberate)

- Export/download as .docx
- Image upload/paste inside the WYSIWYG editor
- Converting `doc` tabs to/from HTML or markdown
- Separate blob storage for images
- Table creation/structure editing UI

## New Dependencies

`mammoth`, `@tiptap/react`, `@tiptap/starter-kit`,
`@tiptap/extension-underline`, `@tiptap/extension-link`,
`@tiptap/extension-image`, `@tiptap/extension-table` (+ row/cell/header).

## Testing

- Unit: `docToHtml` wrapping; save-action size-limit enforcement for `doc`
  tabs (follow existing patterns in `test/`).
- Manual: drop a real .docx with headings/lists/table/image → edit in
  WYSIWYG → autosave → published view renders identically; blank doc tab
  creation and renaming; oversized/corrupt docx shows the error.
