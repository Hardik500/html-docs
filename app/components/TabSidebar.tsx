import { useRef, useState, useEffect, useMemo } from "react";
import { MAX_DOC_BYTES } from "~/lib/limits";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface TabItem {
  id: string;
  slug: string;
  name: string;
  position: number;
  content_type: "html" | "markdown" | "pdf" | "doc";
}

interface SortableTabProps {
  tab: TabItem;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}

function SortableTab({
  tab,
  isActive,
  onSelect,
  onRename,
  onDelete,
  canDelete,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tab.id });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function startEditing() {
    setDraft(tab.name);
    setEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename() {
    const name = draft.trim();
    if (name && name !== tab.name) onRename(tab.id, name);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { setEditing(false); }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer text-sm font-medium transition-colors ${
        isActive ? "bg-card text-ink shadow-sm" : "text-muted hover:bg-card hover:text-body-strong"
      }`}
    >
      {!editing && (
        <span
          {...attributes}
          {...listeners}
          className="absolute left-0 inset-y-0 flex items-center px-1 cursor-grab active:cursor-grabbing text-subtle opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 pointer-events-none group-hover:pointer-events-auto"
          aria-label="Drag to reorder"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
        </span>
      )}
      {tab.content_type === "markdown" && !editing && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 rounded text-primary bg-primary/10">MD</span>
      )}
      {tab.content_type === "pdf" && !editing && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 rounded text-red-500 bg-red-500/10">PDF</span>
      )}
      {tab.content_type === "doc" && !editing && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 rounded text-blue-500 bg-blue-500/10">DOC</span>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          maxLength={200}
          className="flex-1 text-sm rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary min-w-0 border bg-paper text-ink border-hairline"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          className="flex-1 text-left truncate focus:outline-none"
          onClick={() => onSelect(tab.id)}
          onDoubleClick={startEditing}
        >
          {tab.name}
        </button>
      )}

      {!editing && (
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={startEditing}
            className="p-1 rounded transition-colors text-subtle hover:text-ink hover:bg-strong"
            title="Rename"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete(tab.id)}
              className="p-1 rounded transition-colors text-subtle hover:text-red-500 hover:bg-red-500/10"
              title="Delete tab"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface TabSidebarProps {
  tabs: TabItem[];
  activeTabId: string;
  /** Map from tab id → raw html/markdown content used for full-text search. */
  tabContents?: Record<string, string>;
  onSelect: (id: string) => void;
  onReorder: (tabs: TabItem[]) => void;
  onAdd: (type: "html" | "markdown" | "doc") => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDropFiles?: (files: Array<{ name: string; html: string; content_type: "html" | "markdown" | "pdf" | "doc" }>) => void;
}

/** Strip HTML tags so we search visible text, not markup. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Find the first occurrence of `needle` in `haystack` and return a short
 * surrounding snippet with the match position for highlighting.
 */
function findSnippet(
  haystack: string,
  needle: string
): { before: string; match: string; after: string } | null {
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return null;
  const RADIUS = 40;
  const start = Math.max(0, idx - RADIUS);
  const end = Math.min(haystack.length, idx + needle.length + RADIUS);
  return {
    before: (start > 0 ? "…" : "") + haystack.slice(start, idx),
    match: haystack.slice(idx, idx + needle.length),
    after: haystack.slice(idx + needle.length, end) + (end < haystack.length ? "…" : ""),
  };
}

export default function TabSidebar({
  tabs,
  activeTabId,
  tabContents = {},
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDelete,
  onDropFiles,
}: TabSidebarProps) {
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(256);

  // Strip HTML once per content change — not on every keypress.
  const strippedContents = useMemo(
    () => Object.fromEntries(
      Object.entries(tabContents).map(([id, html]) => [id, stripHtml(html)])
    ),
    [tabContents]
  );

  // Recompute search results only when query or stripped content changes.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return tabs.flatMap((tab) => {
      const nameMatch = tab.name.toLowerCase().includes(q.toLowerCase());
      if (tab.content_type === "pdf") {
        return nameMatch ? [{ tab, snippet: null as ReturnType<typeof findSnippet> }] : [];
      }
      const plain = strippedContents[tab.id] ?? "";
      const snippet = findSnippet(plain, q);
      return nameMatch || snippet ? [{ tab, snippet }] : [];
    });
  }, [tabs, strippedContents, searchQuery]); // default slightly wider than w-56
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const delta = e.clientX - resizeStartX.current;
      setSidebarWidth(Math.max(180, Math.min(480, resizeStartWidth.current + delta)));
    }
    function onMouseUp() {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function handleResizeStart(e: React.MouseEvent) {
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(tabs, oldIndex, newIndex).map((t, i) => ({
      ...t,
      position: i,
    }));
    onReorder(reordered);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files || []);
    const droppedFiles: Array<{ name: string; html: string; content_type: "html" | "markdown" | "pdf" | "doc" }> = [];

    for (const file of files) {
      const isHtml = file.type === "text/html" || file.name.endsWith(".html");
      const isMd = file.name.endsWith(".md") || file.name.endsWith(".markdown");
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const isDocx =
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.name.toLowerCase().endsWith(".docx");

      if (!isHtml && !isMd && !isPdf && !isDocx) continue;

      try {
        if (isPdf) {
          // Cap at 2 MB — base64 inflates to ~2.7 MB, keeping the total
          // save payload well under Vercel's 4.5 MB serverless limit.
          if (file.size > 2 * 1024 * 1024) {
            setDropError(`"${file.name}" is too large — PDF must be under 2 MB`);
            setTimeout(() => setDropError(null), 5000);
            continue;
          }
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const name = file.name.replace(/\.pdf$/i, "");
          droppedFiles.push({ name, html: base64, content_type: "pdf" });
        } else if (isDocx) {
          const { default: mammoth } = await import("mammoth/mammoth.browser");
          const arrayBuffer = await file.arrayBuffer();
          const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
          if (new TextEncoder().encode(html).length > MAX_DOC_BYTES) {
            setDropError(`"${file.name}" is too large after conversion — must be under 2.8 MB`);
            setTimeout(() => setDropError(null), 5000);
            continue;
          }
          const name = file.name.replace(/\.docx$/i, "");
          droppedFiles.push({ name, html, content_type: "doc" });
        } else {
          const content = await file.text();
          const name = file.name.replace(/\.(html|md|markdown)$/i, "");
          droppedFiles.push({ name, html: content, content_type: isHtml ? "html" : "markdown" });
        }
      } catch {
        setDropError(`Couldn't read "${file.name}"`);
        setTimeout(() => setDropError(null), 5000);
      }
    }

    if (droppedFiles.length > 0 && onDropFiles) {
      onDropFiles(droppedFiles);
    }
  }

  return (
    <div
      className={`relative flex flex-col h-full shrink-0 z-10 border-r bg-surface border-hairline transition-colors ${
        dragOver ? "bg-primary/5 border-primary" : ""
      }`}
      style={{ width: sidebarWidth }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-primary/40 transition-colors"
        title="Drag to resize"
      />
      <div className="px-4 py-3 flex items-center justify-between border-b border-hairline">
        <span className="text-[11px] font-bold uppercase tracking-widest text-subtle">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onAdd("html")}
            disabled={tabs.length >= 20}
            className="text-xs font-medium disabled:opacity-40 transition-colors flex items-center gap-1 px-2 py-1 rounded text-primary bg-primary/10 hover:bg-primary/20"
            title="Add HTML tab"
          >
            <span>+</span> HTML
          </button>
          <button
            onClick={() => onAdd("markdown")}
            disabled={tabs.length >= 20}
            className="text-xs font-medium disabled:opacity-40 transition-colors flex items-center gap-1 px-2 py-1 rounded text-primary bg-primary/10 hover:bg-primary/20"
            title="Add Markdown tab"
          >
            <span>+</span> MD
          </button>
          <button
            onClick={() => onAdd("doc")}
            disabled={tabs.length >= 20}
            className="text-xs font-medium disabled:opacity-40 transition-colors flex items-center gap-1 px-2 py-1 rounded text-primary bg-primary/10 hover:bg-primary/20"
            title="Add Doc tab"
          >
            <span>+</span> Doc
          </button>
        </div>
      </div>

      {/* Search input */}
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tabs…"
            className="w-full pl-6 pr-6 py-1 text-xs rounded-md border bg-paper text-ink border-hairline placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-subtle hover:text-ink"
              aria-label="Clear search"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 flex flex-col">
        {searchResults !== null ? (
          // ── Search results mode ──────────────────────────────────────────
          searchResults.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-subtle text-center">
              No results for "{searchQuery.trim()}"
            </p>
          ) : (
            searchResults.map(({ tab, snippet }) => (
              <button
                key={tab.id}
                onClick={() => { onSelect(tab.id); setSearchQuery(""); }}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                  tab.id === activeTabId
                    ? "bg-card text-ink shadow-sm"
                    : "text-muted hover:bg-card hover:text-body-strong"
                }`}
              >
                <div className="font-medium truncate text-[12px]">{tab.name}</div>
                {snippet && (
                  <div className="text-[10px] text-subtle mt-0.5 leading-snug line-clamp-2">
                    {snippet.before}
                    <mark className="bg-primary/20 text-primary rounded-sm px-px">{snippet.match}</mark>
                    {snippet.after}
                  </div>
                )}
              </button>
            ))
          )
        ) : (
          // ── Normal drag-to-reorder mode ──────────────────────────────────
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tabs.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                  canDelete={tabs.length > 1}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {/* Drop error */}
        {dropError && (
          <div className="mx-3 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/30">
            <p className="text-[10px] text-red-500 font-medium leading-tight">{dropError}</p>
          </div>
        )}

        {/* Drag & Drop Instructions — hidden during search */}
        {!searchQuery && tabs.length < 20 && (
          <div className={`mt-auto px-3 py-2 rounded-lg border border-dashed transition-all ${
            dragOver
              ? "border-primary bg-primary/8 text-primary"
              : "border-hairline bg-surface text-muted hover:border-primary/50 hover:text-body-strong"
          }`}>
            <p className="text-[10px] text-center font-medium">
              {dragOver ? "Drop files here" : "Drag HTML, MD, PDF or DOCX files"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
