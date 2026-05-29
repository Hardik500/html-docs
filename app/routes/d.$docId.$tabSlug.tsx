import { useLoaderData, useNavigate } from "react-router";
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
  doc: { id: string; title: string; editToken: string | null };
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
    doc: { id: doc.id, title: doc.title, editToken: canEdit ? doc.edit_token : null },
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
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Top nav */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="text-sm font-semibold shrink-0 hover:text-indigo-400 transition-colors">
            html-docs
          </a>
          <span className="text-gray-600">/</span>
          <span className="text-sm text-gray-300 truncate">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ShareBox docId={doc.id} tabSlug={activeTab.slug} />
          {canEdit && (
            <a
              href={`/d/${doc.id}/edit?token=${doc.editToken}`}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors"
            >
              Edit
            </a>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <TabBar tabs={tabs} activeSlug={activeTab.slug} docId={doc.id} />

      {/* Iframe */}
      <div className="flex-1 overflow-hidden">
        <iframe
          key={activeTab.slug}
          src={`/raw/${doc.id}/${activeTab.slug}`}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={activeTab.name}
        />
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-4 py-2 text-center text-xs text-gray-600">
        Powered by{" "}
        <a href="/" className="underline hover:text-gray-400">
          html-docs
        </a>
      </footer>
    </div>
  );
}
