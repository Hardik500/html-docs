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
    <div className="flex items-center gap-1 px-3 pt-2 overflow-x-auto shrink-0 scrollbar-hide border-b bg-surface border-hairline">
      {tabs.map((tab) => {
        const isActive = tab.slug === activeSlug;
        return (
          <Link
            key={tab.id}
            to={`/d/${docId}/${tab.slug}`}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-md transition-all relative ${
              isActive
                ? "bg-paper text-ink"
                : "text-muted hover:text-body-strong hover:bg-card"
            }`}
          >
            {tab.name}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-sm bg-primary" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
