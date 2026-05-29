import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/dashboard";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";

interface DocRow {
  id: string;
  title: string;
  view_count: number;
  last_activity_at: string;
  created_at: string;
  tab_count: number;
  first_slug: string | null;
}

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — html-docs" }];

// Defined before Dashboard so bundlers never hoist it into the wrong chunk
function DocCard({ doc }: { doc: DocRow }) {
  const viewHref = doc.first_slug ? `/d/${doc.id}/${doc.first_slug}` : `/d/${doc.id}`;
  const rawSrc   = doc.first_slug ? `/raw/${doc.id}/${doc.first_slug}` : null;

  return (
    <div className="group flex flex-col bg-gray-900/40 border border-white/5 rounded-2xl overflow-hidden hover:bg-gray-900/60 hover:border-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300">

      {/* Thumbnail — sandboxed iframe scaled down, fully isolated from parent */}
      <Link to={viewHref} className="block relative bg-gray-950 border-b border-white/5" style={{ height: 160 }}>
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          {rawSrc ? (
            <iframe
              src={rawSrc}
              sandbox="allow-scripts"
              loading="lazy"
              tabIndex={-1}
              aria-hidden
              scrolling="no"
              title=""
              style={{
                width: 960,
                height: 600,
                transform: "scale(0.25)",
                transformOrigin: "top left",
                pointerEvents: "none",
                border: "none",
                display: "block",
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-xs bg-gray-100">
              No content
            </div>
          )}
        </div>
        {/* Click shield — sits above the iframe so the <Link> captures the click */}
        <div className="absolute inset-0" />
      </Link>

      {/* Card body */}
      <div className="px-4 py-3 flex flex-col gap-1">
        <Link
          to={viewHref}
          className="text-sm font-medium text-gray-200 truncate hover:text-indigo-400 transition-colors"
          title={doc.title}
        >
          {doc.title}
        </Link>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 font-medium">
            {new Date(doc.last_activity_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {doc.tab_count > 1 && ` · ${doc.tab_count} tabs`}
          </span>
          <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <Link to={`/d/${doc.id}/edit`} className="text-xs font-medium text-gray-400 hover:text-white transition-colors">Edit</Link>
            <Form
              method="post"
              action={`/dashboard/docs/${doc.id}/delete`}
              onSubmit={(e) => { if (!confirm(`Delete "${doc.title}"?`)) e.preventDefault(); }}
            >
              <button type="submit" className="text-xs font-medium text-gray-400 hover:text-red-400 transition-colors">Delete</button>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (!userId) return redirect("/auth/magic");

  // Single query: correlated subquery for position-ordered first tab slug — no N+1
  const [docsResult, userResult] = await Promise.all([
    query<DocRow>(
      `SELECT d.id, d.title, d.view_count, d.last_activity_at, d.created_at,
              COUNT(t.id)::int AS tab_count,
              (SELECT t2.slug FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS first_slug
       FROM docs d
       LEFT JOIN tabs t ON t.doc_id = d.id
       WHERE d.owner_user_id = $1
       GROUP BY d.id
       ORDER BY d.last_activity_at DESC
       LIMIT 100`,
      [userId]
    ),
    query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]),
  ]);

  return { docs: docsResult.rows, email: userResult.rows[0]?.email ?? "" };
}

export default function Dashboard() {
  const { docs, email } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-white/5 bg-gray-950/50 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all">
              <span className="text-white font-bold text-xs font-mono">&lt;/&gt;</span>
            </div>
            <span className="font-semibold text-sm tracking-wide text-gray-200 group-hover:text-white transition-colors">html-docs</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-400">{email}</span>
          <Form method="post" action="/auth/logout">
            <button type="submit" className="text-sm font-medium text-gray-400 hover:text-white transition-colors">Sign out</button>
          </Form>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">My Documents</h1>
          <Link to="/" className="bg-white text-black hover:bg-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-lg shadow-white/5 flex items-center gap-2">
            <span>+</span> New doc
          </Link>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-32 border border-dashed border-white/10 rounded-2xl bg-gray-900/20">
            <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mx-auto mb-4 border border-white/5 shadow-inner">
               <span className="text-gray-500 font-mono text-lg">&lt;/&gt;</span>
            </div>
            <p className="text-lg font-medium text-gray-200 mb-2">No documents yet</p>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">Paste HTML on the home page to create your first document. It takes just seconds.</p>
            <Link to="/" className="text-white bg-indigo-600 hover:bg-indigo-500 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">Create your first document</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}


