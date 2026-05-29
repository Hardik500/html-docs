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
    <div className="flex items-center gap-1 border-b border-gray-800 bg-gray-900 px-2 overflow-x-auto shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.slug === activeSlug;
        return (
          <Link
            key={tab.id}
            to={`/d/${docId}/${tab.slug}`}
            className={`px-4 py-2 text-sm whitespace-nowrap rounded-t transition-colors ${
              isActive
                ? "bg-gray-950 text-gray-100 border-t-2 border-indigo-500"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}
