import { useState, useEffect } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/dashboard";
import { query } from "~/lib/db.server";
import { getUser } from "~/lib/auth.server";
import { createTimer } from "~/lib/perf.server";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { markdownToHtml } from "~/lib/markdown";
import { Modal } from "~/components/Modal";
import { ThemeToggle } from "~/components/ThemeToggle";

interface DocRow {
  id: string;
  title: string;
  view_count: number;
  last_activity_at: string;
  created_at: string;
  tab_count: number;
  first_slug: string | null;
  html: string | null;
  first_tab_content_type: string | null;
}

export const meta: Route.MetaFunction = () => [{ title: "Dashboard — html-docs" }];

// Replaced DocCard with list item inside Dashboard

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTimer("dashboard");
  const user = await getUser(request);
  t.mark("auth");
  if (!user) return redirect("/auth/magic");

  const docsResult = await query<DocRow & { html: string }>(
    `SELECT d.id, d.title, d.view_count, d.last_activity_at, d.created_at,
            COUNT(t.id)::int AS tab_count,
            (SELECT t2.slug FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS first_slug,
            (SELECT t2.content_type FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS first_tab_content_type,
            (SELECT LEFT(t2.html, POSITION('<body' IN lower(t2.html)) + 8000) FROM tabs t2 WHERE t2.doc_id = d.id ORDER BY t2.position ASC LIMIT 1) AS html
     FROM docs d
     LEFT JOIN tabs t ON t.doc_id = d.id
     WHERE d.owner_user_id = $1
     GROUP BY d.id
     ORDER BY d.last_activity_at DESC
     LIMIT 100`,
    [user.id]
  );
  t.mark("db");

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const docs = docsResult.rows.map((doc) => {
    const d = new Date(doc.last_activity_at);
    const html = doc.html && doc.first_tab_content_type !== "pdf"
      ? (doc.first_tab_content_type === "markdown" ? markdownToHtml(doc.html) : doc.html)
      : null;
    return { ...doc, html, last_activity_at: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` };
  });

  t.end();
  return { docs, email: user.email };
}

export default function Dashboard() {
  const { docs, email } = useLoaderData<typeof loader>();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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
    <main className="min-h-screen bg-canvas text-ink">
      <nav className="backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-10 border-b bg-canvas/85 border-hairline">
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-6 h-6 rounded-md flex items-center justify-center shadow-lg transition-all logo-gradient">
              <span className="text-white font-bold text-xs font-mono">&lt;/&gt;</span>
            </div>
            <span className="font-semibold text-sm tracking-wide transition-colors text-body-strong">html-docs</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted">{email}</span>
          <ThemeToggle />
          <Form method="post" action="/auth/logout">
            <button type="submit" className="text-sm font-medium transition-colors text-muted hover:text-ink">Sign out</button>
          </Form>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-ink">My Documents</h1>
          <Form method="post" action="/docs">
            <button type="submit" className="text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer text-white bg-primary hover:bg-primary-dark">
              <span>+</span> New doc
            </button>
          </Form>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-32 border border-dashed rounded-2xl border-hairline bg-surface">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 border shadow-inner bg-card border-hairline">
               <span className="font-mono text-lg text-subtle">&lt;/&gt;</span>
            </div>
            <p className="text-lg font-medium mb-2 text-body-strong">No documents yet</p>
            <p className="text-sm mb-6 max-w-sm mx-auto text-subtle">Click "New doc" to create your first document.</p>
            <Form method="post" action="/docs">
              <button type="submit" className="text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors bg-primary hover:bg-primary-dark">
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
                <div key={doc.id} className={`group flex flex-col rounded-xl shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 relative border bg-paper border-hairline ${openMenuId === doc.id ? 'z-50' : 'z-10'}`}>

                  {/* Thumbnail / Iframe preview */}
                  <Link to={editHref} className="relative aspect-4/5 block rounded-t-xl overflow-hidden border-b bg-canvas border-hairline">
                    {doc.first_tab_content_type === "pdf" ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-surface text-subtle">
                        <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        <span className="text-xs font-bold uppercase tracking-wider text-red-400">PDF</span>
                      </div>
                    ) : doc.html ? (
                      <iframe
                        srcDoc={injectDefaultStyles(doc.html, isDark)}
                        sandbox="allow-scripts"
                        loading="lazy"
                        tabIndex={-1}
                        className="absolute top-0 left-0 w-[200%] h-[200%] origin-top-left border-0 pointer-events-none select-none bg-canvas"
                        style={{ transform: "scale(0.5)" }}
                        title={`Preview of ${doc.title}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-mono text-sm bg-surface text-subtle">
                        Empty
                      </div>
                    )}
                  </Link>

                  {/* Card Footer / Details */}
                  <div className="p-4 flex flex-col flex-1 relative rounded-b-xl bg-paper">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <Link to={editHref} className="font-semibold transition-colors line-clamp-1 flex-1 text-body-strong hover:text-primary">
                        {doc.title}
                      </Link>

                      {/* Action Menu (3-dot) */}
                      <div className="relative doc-menu-container">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setOpenMenuId(openMenuId === doc.id ? null : doc.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all p-1 -mr-1 rounded-md text-subtle hover:text-ink hover:bg-card"
                          aria-label="Document options"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>

                        {openMenuId === doc.id && (
                          <div className="absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl py-1 z-50 border bg-paper border-hairline">
                            <Link to={viewHref} target="_blank" className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm transition-colors text-body hover:bg-surface">
                              <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Preview
                            </Link>
                            <button onClick={(e) => {
                              e.preventDefault();
                              setRenameModalDoc(doc);
                              setOpenMenuId(null);
                            }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm transition-colors text-body hover:bg-surface">
                              <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              Rename
                            </button>
                            <div className="h-px my-1 mx-2 bg-hairline" />
                            <button onClick={(e) => {
                              e.preventDefault();
                              setDeleteModalDoc(doc);
                              setOpenMenuId(null);
                            }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm transition-colors text-red-500 hover:bg-red-500/10">
                              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2">
                        <span className="text-xs flex items-center gap-1 text-subtle">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          {doc.last_activity_at}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {doc.tab_count > 1 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border text-muted bg-surface border-hairline" title={`${doc.tab_count} tabs`}>
                            {doc.tab_count} tabs
                          </span>
                        )}
                        <span className="text-[10px] font-medium flex items-center gap-1 text-muted" title={`${doc.view_count} views`}>
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
              <label htmlFor="rename-title" className="block text-sm font-medium mb-2 text-muted">
                Document Title
              </label>
              <input
                type="text"
                id="rename-title"
                name="title"
                defaultValue={renameModalDoc.title}
                className="w-full rounded-lg px-4 py-2 focus:outline-none focus:ring-2 transition-all border bg-paper border-hairline text-ink"
                autoFocus
                required
              />
            </div>
            <div className="px-6 py-4 flex items-center justify-end gap-3 border-t bg-surface border-hairline">
              <button
                type="button"
                onClick={() => setRenameModalDoc(null)}
                className="px-4 py-2 text-sm font-medium transition-colors text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-primary hover:bg-primary-dark"
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
              <p className="text-body">
                Are you sure you want to delete <span className="font-semibold text-ink">"{deleteModalDoc.title}"</span>?
              </p>
              <p className="text-sm mt-2 text-subtle">
                This action cannot be undone. All tabs and history will be permanently lost.
              </p>
            </div>
            <div className="px-6 py-4 flex items-center justify-end gap-3 border-t bg-surface border-hairline">
              <button
                type="button"
                onClick={() => setDeleteModalDoc(null)}
                className="px-4 py-2 text-sm font-medium transition-colors text-muted hover:text-ink"
              >
                Cancel
              </button>
              <Form method="post" action={`/dashboard/docs/${deleteModalDoc.id}/delete`} onSubmit={() => setDeleteModalDoc(null)}>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-red-600 hover:bg-red-700"
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


