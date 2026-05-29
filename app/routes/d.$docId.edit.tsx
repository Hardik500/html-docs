import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { Route } from "./+types/d.$docId.edit";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";
import { newTabId, newEditToken } from "~/lib/ids";
import { slugify, dedupeSlug } from "~/lib/slug";
import { extractTitle } from "~/lib/titleExtract";
import TabSidebar, { type TabItem } from "~/components/TabSidebar";

const Editor = lazy(() => import("~/components/Editor"));
const PreviewIframe = lazy(() => import("~/components/PreviewIframe"));

const MAX_HTML_BYTES = 1_048_576;
const MAX_TABS = 20;

// ── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId } = params;
  const url = new URL(request.url);
  const tokenFromUrl = url.searchParams.get("token");

  const docResult = await query<{
    id: string; title: string; edit_token: string; owner_user_id: string | null;
  }>("SELECT id, title, edit_token, owner_user_id FROM docs WHERE id = $1", [docId]);

  if (!docResult.rows.length) throw new Response("Document not found", { status: 404 });
  const doc = docResult.rows[0];

  const userId = await getUserId(request);
  const tokenFromCookie =
    request.headers.get("cookie")?.match(new RegExp(`anon_edit_${docId}=([^;]+)`))?.[1] ?? null;

  const authorized =
    (userId && userId === doc.owner_user_id) ||
    tokenFromUrl === doc.edit_token ||
    tokenFromCookie === doc.edit_token;

  if (!authorized) throw new Response("Forbidden", { status: 403 });

  const tabsResult = await query<TabItem & { html: string }>(
    "SELECT id, slug, name, position, html FROM tabs WHERE doc_id = $1 ORDER BY position ASC",
    [docId]
  );

  return {
    doc: { id: doc.id, title: doc.title, editToken: doc.edit_token },
    tabs: tabsResult.rows,
    userId: userId ?? null,
    isOwner: Boolean(userId && userId === doc.owner_user_id),
  };
}

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ params, request }: Route.ActionArgs) {
  const { docId } = params;
  const url = new URL(request.url);
  const tokenFromUrl = url.searchParams.get("token");

  const docResult = await query<{ edit_token: string; owner_user_id: string | null }>(
    "SELECT edit_token, owner_user_id FROM docs WHERE id = $1", [docId]
  );
  if (!docResult.rows.length) throw new Response("Not found", { status: 404 });
  const doc = docResult.rows[0];

  const userId = await getUserId(request);
  const tokenFromCookie =
    request.headers.get("cookie")?.match(new RegExp(`anon_edit_${docId}=([^;]+)`))?.[1] ?? null;

  const authorized =
    (userId && userId === doc.owner_user_id) ||
    tokenFromUrl === doc.edit_token ||
    tokenFromCookie === doc.edit_token;

  if (!authorized) throw new Response("Forbidden", { status: 403 });

  const body = await request.json() as {
    intent: string;
    title?: string;
    tabs?: Array<{ id?: string; slug?: string; name: string; position: number; html?: string; _delete?: boolean }>;
  };

  if (body.intent === "save") {
    // Update doc title
    if (body.title) {
      await query("UPDATE docs SET title = $1, last_activity_at = now() WHERE id = $2", [body.title, docId]);
    }

    const existingSlugs = await query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tabs WHERE doc_id = $1", [docId]
    );
    const slugMap = new Map(existingSlugs.rows.map((r) => [r.id, r.slug]));

    // tempId → { realId, slug } for newly created tabs
    const createdTabs: Array<{ tempId: string; id: string; slug: string }> = [];

    for (const tab of body.tabs ?? []) {
      if (tab._delete && tab.id) {
        await query("DELETE FROM tabs WHERE id = $1 AND doc_id = $2", [tab.id, docId]);
        continue;
      }
      // Detect new tabs: no id, or a client-side "new:..." temp id
      const isNew = !tab.id || tab.id.startsWith("new:");
      if (isNew) {
        const tabId = newTabId();
        const name = tab.name || "New Tab";
        const html = tab.html || "<!DOCTYPE html><html><head><title>" + name + "</title></head><body></body></html>";
        const existingSlugSet = new Set([...slugMap.values()]);
        const slug = dedupeSlug(slugify(name), existingSlugSet);
        slugMap.set(tabId, slug);
        await query(
          "INSERT INTO tabs (id, doc_id, slug, name, position, html) VALUES ($1,$2,$3,$4,$5,$6)",
          [tabId, docId, slug, name, tab.position, html]
        );
        if (tab.id) createdTabs.push({ tempId: tab.id, id: tabId, slug });
      } else {
        const html = tab.html ?? "";
        if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) continue;
        const name = tab.name || extractTitle(html, "Tab");
        await query(
          "UPDATE tabs SET name=$1, position=$2, html=$3, updated_at=now(), version=version+1 WHERE id=$4 AND doc_id=$5",
          [name, tab.position, html, tab.id, docId]
        );
      }
    }
    return { ok: true, createdTabs };
  }

  return { ok: false };
}

// ── Component ─────────────────────────────────────────────────────────────────

export const meta: Route.MetaFunction = ({ data }: { data: ReturnType<typeof loader> extends Promise<infer T> ? T | undefined : never }) => [
  { title: `Edit: ${(data as { doc?: { title?: string } } | undefined)?.doc?.title ?? "Untitled"} — html-docs` },
];

export default function EditPage() {
  const { doc, tabs: initialTabs, userId, isOwner } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [docTitle, setDocTitle] = useState(doc.title);
  const [tabs, setTabs] = useState<(TabItem & { html: string })[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]?.id ?? "");
  const [previewHtml, setPreviewHtml] = useState(initialTabs[0]?.html ?? "");
  const [saved, setSaved] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  function save() {
    fetcher.submit(
      { intent: "save", title: docTitle, tabs } as unknown as Record<string, string>,
      { method: "POST", encType: "application/json" }
    );
    setSaved(true);
  }

  // After a save, swap client-side "new:..." temp IDs for the real IDs the
  // server assigned, so subsequent saves do UPDATE instead of INSERT again.
  useEffect(() => {
    const data = fetcher.data as { ok?: boolean; createdTabs?: Array<{ tempId: string; id: string; slug: string }> } | undefined;
    if (!data?.ok || !data.createdTabs?.length) return;
    const map = new Map(data.createdTabs.map((t) => [t.tempId, t]));
    setTabs((prev) =>
      prev.map((t) => {
        const created = map.get(t.id);
        return created ? { ...t, id: created.id, slug: created.slug } : t;
      })
    );
    setActiveTabId((prev) => {
      const created = map.get(prev);
      return created ? created.id : prev;
    });
  }, [fetcher.data]);

  // Auto-save every 30s
  useEffect(() => {
    const interval = setInterval(() => { if (!saved) save(); }, 30_000);
    return () => clearInterval(interval);
  });

  function handleHtmlChange(html: string) {
    setSaved(false);
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, html } : t));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setPreviewHtml(html), 300);
  }

  function handleTabSelect(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (tab) { setActiveTabId(id); setPreviewHtml(tab.html); }
  }

  function handleAddTab() {
    if (tabs.length >= MAX_TABS) return;
    const position = tabs.length;
    const name = `Tab ${position + 1}`;
    setSaved(false);
    // Use a temp id with "new:" prefix
    const tempId = `new:${Date.now()}`;
    const slug = dedupeSlug(slugify(name), new Set(tabs.map((t) => t.slug)));
    const html = `<!DOCTYPE html>\n<html>\n<head><title>${name}</title></head>\n<body>\n</body>\n</html>`;
    setTabs((prev) => [...prev, { id: tempId, slug, name, position, html }]);
    setActiveTabId(tempId);
    setPreviewHtml(html);
  }

  function handleReorder(reordered: TabItem[]) {
    setSaved(false);
    setTabs((prev) =>
      reordered.map((r) => ({ ...r, html: prev.find((t) => t.id === r.id)?.html ?? "" }))
    );
  }

  function handleRename(id: string, name: string) {
    setSaved(false);
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));
  }

  function handleDelete(id: string) {
    if (tabs.length <= 1) return;
    setSaved(false);
    const filtered = tabs.filter((t) => t.id !== id).map((t, i) => ({ ...t, position: i }));
    setTabs(filtered);
    if (activeTabId === id) { setActiveTabId(filtered[0].id); setPreviewHtml(filtered[0].html); }
  }

  const viewUrl = `/d/${doc.id}/${activeTab?.slug ?? ""}`;
  const editUrl = `/d/${doc.id}/edit?token=${doc.editToken}`;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center gap-3 shrink-0">
        <a href="/" className="text-sm font-semibold text-indigo-400 shrink-0">html-docs</a>
        <input
          value={docTitle}
          onChange={(e) => { setDocTitle(e.target.value); setSaved(false); }}
          onBlur={save}
          className="flex-1 bg-transparent text-gray-200 text-sm focus:outline-none border-b border-transparent focus:border-gray-600 px-1 min-w-0"
          placeholder="Untitled document"
        />
        <div className="flex items-center gap-2 shrink-0">
          {!saved && <span className="text-xs text-yellow-500">Unsaved</span>}
          <button onClick={save} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded transition-colors">
            Save
          </button>
          <a href={viewUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded transition-colors">
            View ↗
          </a>
          <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}${viewUrl}`)}
            className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded transition-colors">
            Copy link
          </button>
          {!isOwner && (
            <a href="/auth/magic" className="text-xs text-indigo-400 hover:text-indigo-300">
              Sign in to claim →
            </a>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <TabSidebar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleTabSelect}
          onReorder={handleReorder}
          onAdd={handleAddTab}
          onRename={handleRename}
          onDelete={handleDelete}
        />

        {/* Monaco editor */}
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading editor…</div>}>
            <Editor
              value={activeTab?.html ?? ""}
              onChange={handleHtmlChange}
              onBlur={save}
            />
          </Suspense>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden border-l border-gray-800">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500 bg-white">Loading…</div>}>
            <PreviewIframe html={previewHtml} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
