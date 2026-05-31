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
    <div className="flex items-center gap-1 px-3 pt-2 overflow-x-auto shrink-0 scrollbar-hide border-b" style={{ backgroundColor: "#f5f0e8", borderColor: "#e6dfd8" }}>
      {tabs.map((tab) => {
        const isActive = tab.slug === activeSlug;
        return (
          <Link
            key={tab.id}
            to={`/d/${docId}/${tab.slug}`}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-md transition-all relative`}
            style={{
              backgroundColor: isActive ? "white" : undefined,
              color: isActive ? "#141413" : "#6c6a64",
            }}
            onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "#252523"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efe9de"; } }}
            onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "#6c6a64"; (e.currentTarget as HTMLElement).style.backgroundColor = ""; } }}
          >
            {tab.name}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-sm" style={{ backgroundColor: "#cc785c" }} />
            )}
          </Link>
        );
      })}
    </div>
  );
}
