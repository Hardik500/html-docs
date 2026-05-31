import { useLoaderData, useNavigate, Link } from "react-router";
import type { Route } from "./+types/d.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";
import TabBar from "~/components/TabBar";
import ShareBox from "~/components/ShareBox";

interface Tab {
  id: string;
  slug: string;
  name: string;
  position: number;
}

interface LoaderData {
  doc: { id: string; title: string };
  tabs: Tab[];
  activeTab: Tab;
  canEdit: boolean;
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
    "SELECT id, slug, name, position FROM tabs WHERE doc_id = $1 ORDER BY position ASC",
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

  return {
    doc: { id: doc.id, title: doc.title },
    tabs,
    activeTab,
    canEdit: Boolean(canEdit),
  } as LoaderData;
}

export const meta: Route.MetaFunction = ({ data }: { data: LoaderData | undefined }) => [
  { title: `${data?.doc.title ?? "Untitled"} — html-docs` },
];

export default function ViewerPage() {
  const { doc, tabs, activeTab, canEdit } = useLoaderData<LoaderData>();

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
          <ShareBox docId={doc.id} tabSlug={activeTab.slug} />
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

      {/* Tab bar */}
      <TabBar tabs={tabs} activeSlug={activeTab.slug} docId={doc.id} />

      {/* Iframe */}
      <div className="flex-1 overflow-hidden bg-canvas">
        <iframe
          key={activeTab.slug}
          src={`/raw/${doc.id}/${activeTab.slug}`}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={activeTab.name}
        />
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
