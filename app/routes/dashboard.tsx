import { useState } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/dashboard";
import { query } from "~/lib/db.server";
import { getUserId } from "~/lib/auth.server";
import { Modal } from "~/components/Modal";

interface DocRow {
  id: string;
  title: string;
  view_count: number;
  last_activity_at: string;
  created_at: string;
  tab_count: number;
  first_slug: string | null;
  html: string | null;
}

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — html-docs" }];

// Replaced DocCard with list item inside Dashboard

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (!userId) return redirect("/auth/magic");

  // Single query: correlated subquery for position-ordered first tab slug — no N+1
  const [docsResult, userResult] = await Promise.all([
    query<DocRow & { html: string }>(
      `SELECT d.id, d.title, d.view_count, d.last_activity_at, d.created_at,
              COUNT(t.id)::int AS tab_count,
              (SELECT t2.slug FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS first_slug,
              (SELECT t2.html FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS html
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renameModalDoc, setRenameModalDoc] = useState<typeof docs[0] | null>(null);
  const [deleteModalDoc, setDeleteModalDoc] = useState<typeof docs[0] | null>(null);

  // Close menu when clicking outside
  if (typeof document !== "undefined") {
    document.onclick = (e) => {
      if (!(e.target as Element).closest(".doc-menu-container")) {
        setOpenMenuId(null);
      }
    };
  }

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {docs.map((doc) => {
              const viewHref = doc.first_slug ? `/d/${doc.id}/${doc.first_slug}` : `/d/${doc.id}`;
              const editHref = `/d/${doc.id}/edit`;

              return (
                <div key={doc.id} className={`group flex flex-col bg-gray-900/40 border border-white/5 rounded-xl shadow-xl hover:shadow-2xl hover:border-white/10 transition-all hover:-translate-y-1 relative ${openMenuId === doc.id ? 'z-50' : 'z-10'}`}>

                  {/* Thumbnail / Iframe preview */}
                  <Link to={editHref} className="relative aspect-[4/5] bg-white border-b border-white/5 block rounded-t-xl overflow-hidden">
                    {doc.html ? (
                      <iframe
                        srcDoc={doc.html}
                        sandbox="allow-scripts"
                        loading="lazy"
                        tabIndex={-1}
                        className="absolute top-0 left-0 w-[400%] h-[400%] origin-top-left border-0 pointer-events-none select-none bg-white"
                        style={{ transform: "scale(0.25)" }}
                        title={`Preview of ${doc.title}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-400 font-mono text-sm">
                        Empty
                      </div>
                    )}
                  </Link>

                  {/* Card Footer / Details */}
                  <div className="p-4 flex flex-col flex-1 relative bg-gray-900/40 rounded-b-xl">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <Link to={editHref} className="font-semibold text-gray-200 hover:text-indigo-400 transition-colors line-clamp-1 flex-1">
                        {doc.title}
                      </Link>

                      {/* Action Menu (3-dot) */}
                      <div className="relative doc-menu-container">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setOpenMenuId(openMenuId === doc.id ? null : doc.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-500 hover:text-white transition-all p-1 -mr-1 rounded-md hover:bg-white/5"
                          aria-label="Document options"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>

                        {openMenuId === doc.id && (
                          <div className="absolute right-0 top-full mt-1 w-36 bg-gray-900 border border-white/10 rounded-lg shadow-2xl py-1 z-50">
                            <Link to={viewHref} target="_blank" className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Preview
                            </Link>
                            <button onClick={(e) => {
                              e.preventDefault();
                              setRenameModalDoc(doc);
                              setOpenMenuId(null);
                            }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              Rename
                            </button>
                            <div className="h-px bg-white/10 my-1 mx-2" />
                            <button onClick={(e) => {
                              e.preventDefault();
                              setDeleteModalDoc(doc);
                              setOpenMenuId(null);
                            }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">
                              <svg className="w-4 h-4 text-red-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          {doc.last_activity_at}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {doc.tab_count > 1 && (
                          <span className="text-[10px] font-medium text-gray-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5" title={`${doc.tab_count} tabs`}>
                            {doc.tab_count} tabs
                          </span>
                        )}
                        <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1" title={`${doc.view_count} views`}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          {doc.view_count}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rename Modal */}
      <Modal
        isOpen={!!renameModalDoc}
        onClose={() => setRenameModalDoc(null)}
        title="Rename Document"
      >
        {renameModalDoc && (
          <Form method="post" action={`/dashboard/docs/${renameModalDoc.id}/rename`} onSubmit={() => setRenameModalDoc(null)}>
            <div className="p-6">
              <label htmlFor="rename-title" className="block text-sm font-medium text-gray-400 mb-2">
                Document Title
              </label>
              <input
                type="text"
                id="rename-title"
                name="title"
                defaultValue={renameModalDoc.title}
                className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                autoFocus
                required
              />
            </div>
            <div className="px-6 py-4 bg-gray-950/50 flex items-center justify-end gap-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setRenameModalDoc(null)}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
              >
                Rename
              </button>
            </div>
          </Form>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModalDoc}
        onClose={() => setDeleteModalDoc(null)}
        title="Delete Document"
      >
        {deleteModalDoc && (
          <>
            <div className="p-6">
              <p className="text-gray-300">
                Are you sure you want to delete <span className="font-semibold text-white">"{deleteModalDoc.title}"</span>?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This action cannot be undone. All tabs and history will be permanently lost.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-950/50 flex items-center justify-end gap-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setDeleteModalDoc(null)}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <Form method="post" action={`/dashboard/docs/${deleteModalDoc.id}/delete`} onSubmit={() => setDeleteModalDoc(null)}>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
              </Form>
            </div>
          </>
        )}
      </Modal>
    </main>
  );
}


