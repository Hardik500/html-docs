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
    <div className="group flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-900/20 transition-all duration-200">

      {/* Thumbnail — sandboxed iframe scaled down, fully isolated from parent */}
      <Link to={viewHref} className="block relative bg-white" style={{ height: 150 }}>
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
      <div className="px-3 py-2.5 flex flex-col gap-1 border-t border-gray-800">
        <Link
          to={viewHref}
          className="text-sm font-medium text-gray-100 truncate hover:text-indigo-300 transition-colors"
          title={doc.title}
        >
          {doc.title}
        </Link>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {new Date(doc.last_activity_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {doc.tab_count > 1 && ` · ${doc.tab_count} tabs`}
          </span>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <a href={`/d/${doc.id}/edit`} className="text-xs text-indigo-400 hover:text-indigo-300">Edit</a>
            <Form
              method="post"
              action={`/dashboard/docs/${doc.id}/delete`}
              onSubmit={(e) => { if (!confirm(`Delete "${doc.title}"?`)) e.preventDefault(); }}
            >
              <button type="submit" className="text-xs text-red-500 hover:text-red-400">Delete</button>
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
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-semibold text-lg tracking-tight">html-docs</a>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{email}</span>
          <Form method="post" action="/auth/logout">
            <button type="submit" className="text-sm text-gray-400 hover:text-gray-200">Sign out</button>
          </Form>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">My Documents</h1>
          <a href="/" className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            + New doc
          </a>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <p className="text-lg mb-2">No documents yet</p>
            <p className="text-sm mb-6">Paste HTML on the home page to create your first doc.</p>
            <a href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">Create your first document →</a>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}


