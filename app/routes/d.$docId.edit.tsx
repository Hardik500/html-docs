import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useLoaderData, useFetcher, redirect, Link } from "react-router";
import type { Route } from "./+types/d.$docId.edit";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";
import { newTabId, newEditToken } from "~/lib/ids";
import { slugify, dedupeSlug } from "~/lib/slug";
import { extractTitle, deriveTitle } from "~/lib/titleExtract";
import TabSidebar, { type TabItem } from "~/components/TabSidebar";

const Editor = lazy(() => import("~/components/Editor"));
const PreviewIframe = lazy(() => import("~/components/PreviewIframe"));

const MAX_HTML_BYTES = 500_000; // 500 KB per tab
const MAX_TABS = 20;

// ── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId } = params;

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
    tokenFromCookie === doc.edit_token;

  if (!authorized) throw new Response("Forbidden", { status: 403 });

  const tabsResult = await query<TabItem & { html: string }>(
    "SELECT id, slug, name, position, html FROM tabs WHERE doc_id = $1 ORDER BY position ASC",
    [docId]
  );

  // Derive better names server-side so the first render is already correct —
  // no client-side flash or "reload to see name" UX.
  const GENERIC = /^(untitled.*|tab \d+)$/i;
  let titleDerived = false;

  const docTitle = (() => {
    if (doc.title && !GENERIC.test(doc.title.trim())) return doc.title;
    const derived = extractTitle(tabsResult.rows[0]?.html ?? "", "");
    if (derived) { titleDerived = true; return derived; }
    return doc.title;
  })();

  const tabs = tabsResult.rows.map((tab) => {
    if (!GENERIC.test(tab.name.trim())) return tab;
    const derived = extractTitle(tab.html, "");
    if (derived) { titleDerived = true; return { ...tab, name: derived }; }
    return tab;
  });

  return {
    doc: { id: doc.id, title: docTitle, editToken: doc.edit_token },
    tabs,
    userId: userId ?? null,
    isOwner: Boolean(userId && userId === doc.owner_user_id),
    titleDerived,
  };
}

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ params, request }: Route.ActionArgs) {
  const { docId } = params;

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
    tokenFromCookie === doc.edit_token;

  if (!authorized) throw new Response("Forbidden", { status: 403 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_100_000) throw new Response("Payload too large", { status: 413 });

  const body = await request.json() as {
    intent: string;
    title?: string;
    tabs?: Array<{ id?: string; slug?: string; name: string; position: number; html?: string; _delete?: boolean }>;
  };

  if (body.intent === "save") {
    // Update doc title
    if (body.title) {
      await query("UPDATE docs SET title = $1, last_activity_at = now() WHERE id = $2", [body.title.slice(0, 500), docId]);
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
        const name = (tab.name || "New Tab").slice(0, 200);
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
        const name = (tab.name || extractTitle(html, "Tab")).slice(0, 200);
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
  const { doc, tabs: initialTabs, userId, isOwner, titleDerived } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [docTitle, setDocTitle] = useState(doc.title);
  const [tabs, setTabs] = useState<(TabItem & { html: string })[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]?.id ?? "");
  const [previewHtml, setPreviewHtml] = useState(initialTabs[0]?.html ?? "");
  // If the loader derived a better title server-side, it hasn't been persisted yet.
  const [saved, setSaved] = useState(!titleDerived);
  const [saving, setSaving] = useState(false);
  const [layout, setLayout] = useState<"split" | "code" | "preview">("split");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true while a fetch is in flight — checked in the completion effect.
  const isSavingRef = useRef(false);
  // true if changes arrived after the last save() call started.
  // Reset at the top of save(); set by markDirty().
  // When a save completes and this is true, we keep saved=false so the
  // autosave loop immediately schedules another save for the new changes.
  const newChangesRef = useRef(titleDerived); // titleDerived = already unsaved

  // When true, user has manually edited the doc title — HTML changes stop driving it.
  const docTitleLockedRef = useRef(false);

  /** Mark state as dirty. Always use this instead of bare setSaved(false). */
  function markDirty() {
    newChangesRef.current = true;
    setSaved(false);
  }

  // Per-tab auto-name tracking. Map<tabId, lastAutoDerivedName | "\0" (locked)>.
  // A tab is "locked" once the user renames it manually.
  const tabAutoNamesRef = useRef<Map<string, string>>(
    new Map(initialTabs.map((t) => [t.id, t.name]))
  );

  // @monaco-editor/react captures `onChange` once on mount and never updates it,
  // so `handleHtmlChange` is always the stale closure from the first render.
  // Keep these refs current every render so the stale closure reads correct values.
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Keep current docTitle/tabs accessible inside the stale autoSave closure.
  const docTitleRef = useRef(docTitle);
  docTitleRef.current = docTitle;
  const tabsForSaveRef = useRef(tabs);
  tabsForSaveRef.current = tabs;

  function save() {
    if (isSavingRef.current) return; // already in flight, skip
    newChangesRef.current = false;   // snapshot: no new changes yet
    isSavingRef.current = true;
    setSaving(true);
    fetcher.submit(
      { intent: "save", title: docTitleRef.current, tabs: tabsForSaveRef.current } as unknown as Record<string, string>,
      { method: "POST", encType: "application/json", action: `/d/${doc.id}/edit` }
    );
  }

  // Fires on every fetcher state transition (including failures where fetcher.data
  // doesn't change — the old approach only watched fetcher.data and would get stuck
  // in "Saving..." forever on network errors or server errors).
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!isSavingRef.current) return;
    isSavingRef.current = false;
    setSaving(false);

    const data = fetcher.data as { ok?: boolean; createdTabs?: Array<{ tempId: string; id: string; slug: string }> } | undefined;
    if (data?.ok) {
      // Only mark clean if no new edits arrived while the request was in flight.
      // If newChangesRef is true, keep saved=false so autosave retries immediately.
      if (!newChangesRef.current) setSaved(true);
      // Swap client-side "new:..." temp IDs for real IDs the server assigned.
      if (data.createdTabs?.length) {
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
      }
    } else {
      // Request failed — mark unsaved so the autosave loop retries.
      setSaved(false);
    }
  }, [fetcher.state, fetcher.data]);

  // Auto-save logic
  useEffect(() => {
    if (!saved && !saving) {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => {
        save();
      }, 1000); // 1s debounce
    }
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [tabs, docTitle, saved, saving]);

  function handleHtmlChange(html: string) {
    // Always read from refs — this function may be a stale closure captured by
    // Monaco on mount (@monaco-editor/react never refreshes its onChange listener).
    const currentTabId = activeTabIdRef.current;
    const currentTabs = tabsRef.current;

    // Bail if HTML hasn't actually changed — Monaco fires onChange whenever the
    // editor value prop changes (e.g. on tab switch via setValue), causing spurious
    // dirty marks and saves even though the user made no real edit.
    const currentTab = currentTabs.find((t) => t.id === currentTabId);
    if (currentTab && currentTab.html === html) return;

    markDirty();
    const newDerived = deriveTitle(html);

    // Compute auto-name decision outside any state-setter callback (StrictMode
    // double-invokes setter callbacks, which would corrupt ref mutations).
    const last = tabAutoNamesRef.current.get(currentTabId);
    const activeT = currentTabs.find((t) => t.id === currentTabId);
    const shouldAutoName =
      !!newDerived && last !== "\0" && (last === undefined || activeT?.name === last);

    if (shouldAutoName) {
      tabAutoNamesRef.current.set(currentTabId, newDerived!);
    }

    setTabs((prev) =>
      prev.map((t) =>
        t.id === currentTabId
          ? { ...t, html, ...(shouldAutoName ? { name: newDerived! } : {}) }
          : t
      )
    );

    // If tab name auto-updated AND doc title hasn't been manually locked, sync it.
    if (shouldAutoName && !docTitleLockedRef.current) {
      setDocTitle(newDerived!);
    }

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
    markDirty();
    // Use a temp id with "new:" prefix
    const tempId = `new:${Date.now()}`;
    const slug = dedupeSlug(slugify(name), new Set(tabs.map((t) => t.slug)));
    const html = `<!DOCTYPE html>\n<html>\n<head><title>${name}</title></head>\n<body>\n</body>\n</html>`;
    // Register new tab for auto-naming (name matches the generic title in the HTML).
    tabAutoNamesRef.current.set(tempId, name);
    setTabs((prev) => [...prev, { id: tempId, slug, name, position, html }]);
    setActiveTabId(tempId);
    setPreviewHtml(html);
  }

  function handleReorder(reordered: TabItem[]) {
    markDirty();
    setTabs((prev) =>
      reordered.map((r) => ({ ...r, html: prev.find((t) => t.id === r.id)?.html ?? "" }))
    );
  }

  function handleRename(id: string, name: string) {
    markDirty();
    // Lock this tab — future HTML changes won't override the user's chosen name.
    tabAutoNamesRef.current.set(id, "\0");
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));
  }

  function handleDelete(id: string) {
    if (tabs.length <= 1) return;
    markDirty();
    const filtered = tabs.filter((t) => t.id !== id).map((t, i) => ({ ...t, position: i }));
    setTabs(filtered);
    if (activeTabId === id) { setActiveTabId(filtered[0].id); setPreviewHtml(filtered[0].html); }
  }

  const viewUrl = `/d/${doc.id}/${activeTab?.slug ?? ""}`;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="border-b border-white/5 bg-gray-950/80 backdrop-blur-md px-4 py-3 flex items-center gap-4 shrink-0 z-10">
        <Link to="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all">
            <span className="text-white font-bold text-[10px] font-mono">&lt;/&gt;</span>
          </div>
          <span className="text-sm font-semibold tracking-wide text-gray-300 group-hover:text-white transition-colors">html-docs</span>
        </Link>
        <div className="h-4 w-px bg-white/10 shrink-0"></div>
        <input
          value={docTitle}
          onChange={(e) => {
            const val = e.target.value;
            setDocTitle(val);
            markDirty();
            // User is manually editing — lock so HTML changes stop driving it.
            docTitleLockedRef.current = true;
          }}
          onBlur={save}
          className="flex-1 bg-transparent text-gray-200 text-sm font-medium focus:outline-none border-b border-transparent focus:border-indigo-500/50 px-1 min-w-0 transition-colors placeholder-gray-600"
          placeholder="Untitled document"
        />
        <div className="flex items-center gap-3 shrink-0">
          {!saved && !saving && <span className="text-xs font-medium text-yellow-500/80 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500/80"></span>Unsaved</span>}
          {saving && <span className="text-xs font-medium text-indigo-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>Saving...</span>}
          {saved && !saving && <span className="text-xs font-medium text-gray-500 flex items-center gap-1">Saved</span>}

          <div className="hidden sm:flex bg-gray-900 rounded border border-white/5 p-0.5 ml-2">
            <button onClick={() => setLayout("code")} className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-colors ${layout === "code" ? "bg-white/10 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}>Code</button>
            <button onClick={() => setLayout("split")} className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-colors ${layout === "split" ? "bg-white/10 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}>Split</button>
            <button onClick={() => setLayout("preview")} className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-colors ${layout === "preview" ? "bg-white/10 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}>View</button>
          </div>

          <a href={viewUrl} target="_blank" rel="noopener noreferrer"
            className="hidden sm:flex text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 px-3 py-1.5 rounded-md transition-colors items-center gap-1.5 ml-2">
            Publish <span className="text-gray-400">↗</span>
          </a>
          <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}${viewUrl}`)}
            className="text-xs font-medium text-gray-400 hover:text-white px-2 py-1.5 rounded-md transition-colors">
            Copy link
          </button>
          {!isOwner && (
            <Link to="/auth/magic" className="text-xs font-medium text-indigo-400 hover:text-indigo-300 ml-2">
              Sign in to claim →
            </Link>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden flex-col sm:flex-row">
        <div className="hidden sm:block h-full shrink-0">
          <TabSidebar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={handleTabSelect}
            onReorder={handleReorder}
            onAdd={handleAddTab}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>

        {/* Mobile Tab Bar */}
        <div className="sm:hidden border-b border-white/5 bg-gray-950 flex overflow-x-auto hide-scrollbar">
          {tabs.map(t => (
            <button key={t.id} onClick={() => handleTabSelect(t.id)} className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${t.id === activeTabId ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500'}`}>
              {t.name}
            </button>
          ))}
        </div>

        {/* Monaco editor */}
        {(layout === "split" || layout === "code") && (
          <div className="flex-1 overflow-hidden bg-[#1e1e1e] flex flex-col h-1/2 sm:h-auto border-b sm:border-b-0 border-white/5">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading editor…</div>}>
              <Editor
                value={activeTab?.html ?? ""}
                onChange={handleHtmlChange}
                onBlur={save}
              />
            </Suspense>
          </div>
        )}

        {/* Preview */}
        {(layout === "split" || layout === "preview") && (
          <div className={`flex-1 overflow-hidden bg-white flex flex-col ${layout === "split" ? "sm:border-l border-white/10" : ""}`}>
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading…</div>}>
              <PreviewIframe html={previewHtml} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
