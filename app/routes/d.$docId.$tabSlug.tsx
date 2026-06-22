import { useLoaderData, useNavigate, Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/d.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";
import TabBar from "~/components/TabBar";
import ShareBox from "~/components/ShareBox";
import { ThemeToggle } from "~/components/ThemeToggle";
import DownloadBox from "~/components/DownloadBox";

interface Tab {
  id: string;
  slug: string;
  name: string;
  position: number;
  content_type: "html" | "markdown" | "pdf" | "doc";
}

interface LoaderData {
  doc: { id: string; title: string };
  tabs: Tab[];
  activeTab: Tab;
  canEdit: boolean;
  /** When true, the viewer was opened via a single-tab share link (?solo=1). Hide the TabBar. */
  solo: boolean;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;

  const docResult = await query<{
    id: string;
    title: string;
    edit_token: string;
    owner_user_id: string | null;
  }>("SELECT id, title, edit_token, owner_user_id FROM docs WHERE id = $1", [
    docId,
  ]);

  if (!docResult.rows.length) {
    throw new Response("Document not found", { status: 404 });
  }
  const doc = docResult.rows[0];

  const tabsResult = await query<Tab>(
    "SELECT id, slug, name, position, content_type FROM tabs WHERE doc_id = $1 ORDER BY position ASC",
    [docId]
  );
  const tabs = tabsResult.rows;
  const activeTab = tabs.find((t) => t.slug === tabSlug);

  if (!activeTab) {
    throw new Response("Tab not found", { status: 404 });
  }

  // Increment view count (best-effort, fire-and-forget)
  query(
    "UPDATE docs SET view_count = view_count + 1, last_activity_at = now() WHERE id = $1",
    [docId]
  ).catch(() => {});

  const userId = await getUserId(request);
  const tokenFromCookie =
    request.headers
      .get("cookie")
      ?.match(new RegExp(`anon_edit_${docId}=([^;]+)`))?.[1] ?? null;
  const canEdit =
    (userId && userId === doc.owner_user_id) ||
    tokenFromCookie === doc.edit_token ||
    false;

  const solo = new URL(request.url).searchParams.has("solo");

  return {
    doc: { id: doc.id, title: doc.title },
    // In solo mode, only expose the active tab so the TabBar can't link to others.
    tabs: solo ? [activeTab] : tabs,
    activeTab,
    canEdit: Boolean(canEdit),
    solo,
  } as LoaderData;
}

export const meta: Route.MetaFunction = ({ data }: { data: LoaderData | undefined }) => [
  { title: `${data?.doc.title ?? "Untitled"} — html-docs` },
];

export default function ViewerPage() {
  const { doc, tabs, activeTab, canEdit, solo } = useLoaderData<LoaderData>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Re-sync whenever the theme changes (handles toggle while the iframe is live).
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "html-docs-theme", dark: isDark }, "*");
  }, [isDark]);

  // Open links forwarded from the sandboxed iframe in a new tab.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type !== "html-docs-open-link") return;
      const url = e.data.url;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  function handleIframeLoad() {
    iframeRef.current?.contentWindow?.postMessage({ type: "html-docs-theme", dark: isDark }, "*");
  }

  return (
    <div className="flex flex-col h-screen bg-canvas text-ink">
      {/* Top nav */}
      <header className="backdrop-blur-md px-4 py-3 flex items-center justify-between gap-4 shrink-0 z-10 border-b bg-canvas/90 border-hairline">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="flex items-center gap-2 group shrink-0">
            <div className="w-5 h-5 rounded flex items-center justify-center shadow transition-all logo-gradient">
              <span className="text-white font-bold text-[10px] font-mono">&lt;/&gt;</span>
            </div>
            <span className="text-sm font-semibold tracking-wide transition-colors text-body">html-docs</span>
          </Link>
          <div className="h-4 w-px shrink-0 bg-hairline"></div>
          <span className="text-sm font-medium truncate text-body">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <DownloadBox
            docId={doc.id}
            tabSlug={activeTab.slug}
            tabName={activeTab.name}
            contentType={activeTab.content_type}
          />
          <ShareBox docId={doc.id} tabSlug={activeTab.slug} solo={solo} />
          {canEdit && (
            <Link
              to={`/d/${doc.id}/edit`}
              className="text-xs font-medium text-white px-3 py-1.5 rounded-md transition-colors bg-primary hover:bg-primary-dark"
            >
              Edit
            </Link>
          )}
        </div>
      </header>

      {/* Tab bar — hidden in solo mode so the viewer can only see the shared tab */}
      {!solo && <TabBar tabs={tabs} activeSlug={activeTab.slug} docId={doc.id} />}

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-canvas">
        {activeTab.content_type === "pdf" ? (
          <embed
            key={activeTab.slug}
            src={`/raw/${doc.id}/${activeTab.slug}`}
            type="application/pdf"
            className="w-full h-full border-0"
            title={activeTab.name}
          />
        ) : (
          <iframe
            ref={iframeRef}
            key={activeTab.slug}
            src={`/raw/${doc.id}/${activeTab.slug}`}
            sandbox="allow-scripts"
            className="w-full h-full border-0"
            title={activeTab.name}
            onLoad={handleIframeLoad}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="px-4 py-2 text-center text-xs border-t bg-canvas border-hairline text-subtle">
        Powered by{" "}
        <Link to="/" className="transition-colors text-muted">
          html-docs
        </Link>
      </footer>
    </div>
  );
}
