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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function handleRename() {
    const name = window.prompt("Rename tab:", tab.name);
    if (name && name.trim()) {
      onRename(tab.id, name.trim());
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 px-2 py-2 rounded cursor-pointer ${
        isActive ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="text-gray-600 cursor-grab active:cursor-grabbing px-1"
        aria-label="Drag to reorder"
      >
        ⠿
      </span>

      <button
        className="flex-1 text-left text-sm truncate"
        onClick={() => onSelect(tab.id)}
      >
        {tab.name}
      </button>

      <div className="hidden group-hover:flex items-center gap-1">
        <button
          onClick={handleRename}
          className="text-gray-500 hover:text-gray-200 text-xs px-1"
          title="Rename"
        >
          ✏
        </button>
        {canDelete && (
          <button
            onClick={() => onDelete(tab.id)}
            className="text-gray-500 hover:text-red-400 text-xs px-1"
            title="Delete tab"
          >
            ✕
          </button>
        )}
      </div>
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
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 w-52 shrink-0">
      <div className="px-3 py-3 border-b border-gray-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Tabs
        </span>
        <button
          onClick={onAdd}
          disabled={tabs.length >= 20}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
          title="Add tab"
        >
          + Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
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
