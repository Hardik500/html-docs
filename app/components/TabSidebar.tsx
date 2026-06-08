import { useRef, useState, useEffect } from "react";
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
  content_type: "html" | "markdown";
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
  onSelect: (id: string) => void;
  onReorder: (tabs: TabItem[]) => void;
  onAdd: (type: "html" | "markdown") => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDropFiles?: (files: Array<{ name: string; html: string; content_type: "html" | "markdown" }>) => void;
}

export default function TabSidebar({
  tabs,
  activeTabId,
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDelete,
  onDropFiles,
}: TabSidebarProps) {
  const [dragOver, setDragOver] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256); // default slightly wider than w-56
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
    const droppedFiles: Array<{ name: string; html: string; content_type: "html" | "markdown" }> = [];

    for (const file of files) {
      const isHtml = file.type === "text/html" || file.name.endsWith(".html");
      const isMd = file.name.endsWith(".md") || file.name.endsWith(".markdown");
      if (!isHtml && !isMd) continue;
      try {
        const content = await file.text();
        const name = file.name.replace(/\.(html|md|markdown)$/i, "");
        droppedFiles.push({ name, html: content, content_type: isHtml ? "html" : "markdown" });
      } catch {
        // Silently skip files that can't be read
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 flex flex-col">
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

        {/* Drag & Drop Instructions */}
        {tabs.length < 20 && (
          <div className={`mt-auto px-3 py-2 rounded-lg border border-dashed transition-all ${
            dragOver
              ? "border-primary bg-primary/8 text-primary"
              : "border-hairline bg-surface text-muted hover:border-primary/50 hover:text-body-strong"
          }`}>
            <p className="text-[10px] text-center font-medium">
              {dragOver ? "Drop files here" : "Drag HTML or MD files"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
