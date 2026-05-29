import { useRef, useState } from "react";
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
      className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors ${
        isActive ? "bg-white/10 text-white shadow-sm" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
      }`}
    >
      {/* Drag handle — hidden while editing to avoid accidental drags */}
      {!editing && (
        <span
          {...attributes}
          {...listeners}
          className="text-gray-600 group-hover:text-gray-400 cursor-grab active:cursor-grabbing px-1 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Drag to reorder"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
        </span>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          maxLength={200}
          className="flex-1 bg-white/10 text-white text-sm rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          className="flex-1 text-left truncate -ml-1 focus:outline-none"
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
            className="text-gray-500 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
            title="Rename"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete(tab.id)}
              className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-red-400/10 transition-colors"
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
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function TabSidebar({
  tabs,
  activeTabId,
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDelete,
}: TabSidebarProps) {
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

  return (
    <div className="flex flex-col h-full bg-gray-950 border-r border-white/5 w-56 shrink-0 z-10">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
          Files
        </span>
        <button
          onClick={onAdd}
          disabled={tabs.length >= 20}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors flex items-center gap-1 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 rounded"
          title="Add tab"
        >
          <span>+</span> Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
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
      </div>
    </div>
  );
}
