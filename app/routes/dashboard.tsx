import { useState } from "react";
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

// Replaced DocCard with list item inside Dashboard

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

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const docs = docsResult.rows.map((doc) => {
    const d = new Date(doc.last_activity_at);
    const formatted = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    return { ...doc, last_activity_at: formatted };
  });

  return { docs, email: userResult.rows[0]?.email ?? "" };
}

export default function Dashboard() {
  const { docs, email } = useLoaderData<typeof loader>();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
          <Form method="post" action="/docs">
            <button type="submit" className="bg-white text-black hover:bg-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-lg shadow-white/5 flex items-center gap-2 cursor-pointer">
              <span>+</span> New doc
            </button>
          </Form>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-32 border border-dashed border-white/10 rounded-2xl bg-gray-900/20">
            <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mx-auto mb-4 border border-white/5 shadow-inner">
               <span className="text-gray-500 font-mono text-lg">&lt;/&gt;</span>
            </div>
            <p className="text-lg font-medium text-gray-200 mb-2">No documents yet</p>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">Click "New doc" to create your first document.</p>
            <Form method="post" action="/docs">
              <button type="submit" className="text-white bg-indigo-600 hover:bg-indigo-500 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40">
                Create your first document
              </button>
            </Form>
          </div>
        ) : (
          <div className="bg-gray-900/40 border border-white/5 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 bg-gray-900/80 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <div className="col-span-6 sm:col-span-5">Name</div>
              <div className="hidden sm:block col-span-3">Last Updated</div>
              <div className="hidden sm:block col-span-2 text-right">Views</div>
              <div className="col-span-6 sm:col-span-2 text-right">Actions</div>
            </div>
            <div className="divide-y divide-white/5">
              {docs.map((doc) => {
                const viewHref = doc.first_slug ? `/d/${doc.id}/${doc.first_slug}` : `/d/${doc.id}`;
                return (
                  <div key={doc.id} className="group grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-white/5 transition-colors">
                    <div className="col-span-6 sm:col-span-5 flex flex-col min-w-0">
                      <Link to={viewHref} className="text-sm font-medium text-gray-200 truncate hover:text-indigo-400 transition-colors">
                        {doc.title}
                      </Link>
                      <span className="text-xs text-gray-500 mt-0.5">{doc.tab_count} {doc.tab_count === 1 ? "tab" : "tabs"}</span>
                    </div>
                    <div className="hidden sm:flex col-span-3 items-center">
                      <span className="text-sm text-gray-400">
                        {doc.last_activity_at}
                      </span>
                    </div>
                    <div className="hidden sm:flex col-span-2 justify-end items-center">
                      <span className="text-sm text-gray-400 bg-gray-800/50 px-2 py-0.5 rounded-md border border-white/5">{doc.view_count}</span>
                    </div>
                    <div className="col-span-6 sm:col-span-2 flex items-center justify-end gap-2">
                      {confirmingId === doc.id ? (
                        <>
                          <span className="text-xs text-gray-400 whitespace-nowrap">Sure?</span>
                          <Form method="post" action={`/dashboard/docs/${doc.id}/delete`}>
                            <button type="submit" className="text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-md transition-colors">Yes</button>
                          </Form>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-md transition-colors"
                          >Cancel</button>
                        </>
                      ) : (
                        <>
                          <Link to={`/d/${doc.id}/edit`} className="text-sm font-medium text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-md">Edit</Link>
                          <button
                            onClick={() => setConfirmingId(doc.id)}
                            className="text-sm font-medium text-gray-400 hover:text-red-400 transition-colors bg-white/5 hover:bg-red-500/10 px-3 py-1.5 rounded-md"
                          >Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}


