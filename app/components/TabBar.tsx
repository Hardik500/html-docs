import { Link } from "react-router";

interface Tab {
  id: string;
  slug: string;
  name: string;
  position: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeSlug: string;
  docId: string;
}

export default function TabBar({ tabs, activeSlug, docId }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-white/5 bg-gray-950 px-3 pt-2 overflow-x-auto shrink-0 scrollbar-hide">
      {tabs.map((tab) => {
        const isActive = tab.slug === activeSlug;
        return (
          <Link
            key={tab.id}
            to={`/d/${docId}/${tab.slug}`}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-md transition-all relative ${
              isActive
                ? "bg-white/5 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
            }`}
          >
            {tab.name}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-sm shadow-[0_-2px_8px_rgba(99,102,241,0.5)]" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
