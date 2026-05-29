import { Form, Link } from "react-router";
import type { Route } from "./+types/_index";
import { useState, lazy, Suspense, useEffect, useRef } from "react";
import PreviewIframe from "~/components/PreviewIframe";

const Editor = lazy(() => import("~/components/Editor"));

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 flex items-center justify-center min-h-screen p-4">
  <div class="text-center p-8 bg-slate-900 rounded-2xl shadow-2xl border border-white/10 max-w-sm w-full transition-transform hover:scale-105">
    <h1 class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 text-4xl font-bold mb-4">Hello, world!</h1>
    <p class="text-slate-400">Edit this code on the left and see changes instantly.</p>
  </div>
</body>
</html>`;

export const meta: Route.MetaFunction = () => [
  { title: "html-docs — Share HTML instantly" },
  {
    name: "description",
    content:
      "Create, edit, and share HTML directly in your browser. Get an instant shareable link with no signup required.",
  },
];

export default function Landing() {
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [previewHtml, setPreviewHtml] = useState(DEFAULT_HTML);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewHtml(html);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [html]);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col relative overflow-hidden font-sans selection:bg-indigo-500/30">
      {/* Sophisticated Background */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-40 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/20 via-purple-500/10 to-transparent blur-[100px] rounded-full" />
      </div>

      {/* Grid pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNykiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent_80%)] pointer-events-none" />

      <nav className="border-b border-white/5 bg-gray-950/60 backdrop-blur-xl px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-white/10">
            <span className="text-white font-bold text-sm font-mono">&lt;/&gt;</span>
          </div>
          <span className="font-semibold text-sm tracking-wide text-gray-200">html-docs</span>
        </div>
        <div className="flex items-center gap-6">
          <Link
            to="/dashboard"
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/dashboard"
            className="text-sm font-medium bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-lg transition-all border border-white/5"
          >
            Dashboard
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 pt-24 pb-32 z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            No sign-up required
          </div>
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-gray-200 to-gray-500 mb-6 drop-shadow-sm">
            Share HTML docs <br className="hidden sm:block" /> at the speed of thought.
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            The fastest way to write, preview, and share HTML components.
            Perfect for sharing AI-generated code, templates, or quick experiments.
          </p>

          <Form method="post" action="/docs" className="flex justify-center">
            <input type="hidden" name="html" value={html} />
            <button
              type="submit"
              className="group relative inline-flex items-center justify-center gap-3 bg-white text-gray-950 font-semibold px-8 py-4 rounded-full text-lg transition-all hover:scale-105 hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] focus:ring-4 focus:ring-white/20 outline-none"
            >
              Share This Document
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </button>
          </Form>
        </div>

        {/* Hero Product Mockup */}
        <div className="w-full max-w-5xl mx-auto relative group mt-8">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative bg-gray-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col h-[500px]">
            {/* Mac Window Bar */}
            <div className="h-12 border-b border-white/10 bg-gray-950/50 flex items-center px-4 gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <div className="mx-auto bg-white/5 rounded-md px-4 py-1 flex items-center gap-2 text-xs text-gray-400 border border-white/5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                html-docs.com/d/abc-123
              </div>
            </div>
            {/* Editor / Preview Split */}
            <div className="flex-1 flex overflow-hidden">
              <div className="w-1/2 border-r border-white/10 bg-[#1e1e1e] flex flex-col relative overflow-hidden">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading editor...</div>}>
                  <Editor value={html} onChange={setHtml} />
                </Suspense>
              </div>
              <div className="w-1/2 bg-white relative">
                <PreviewIframe html={previewHtml} title="Landing Preview" />
              </div>
            </div>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="mt-32 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 transition-colors hover:bg-white/[0.04]">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-200 mb-2">Instant Previews</h3>
            <p className="text-gray-400 text-sm leading-relaxed">See your changes in real-time. The editor and preview are side-by-side for an ultra-fast feedback loop.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 transition-colors hover:bg-white/[0.04]">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4 text-purple-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-200 mb-2">One-Click Sharing</h3>
            <p className="text-gray-400 text-sm leading-relaxed">Copy the URL and share it with anyone. They'll see exactly what you see, perfectly rendered.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 transition-colors hover:bg-white/[0.04]">
            <div className="w-10 h-10 rounded-lg bg-pink-500/20 flex items-center justify-center mb-4 text-pink-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-200 mb-2">Secure & Private</h3>
            <p className="text-gray-400 text-sm leading-relaxed">Anonymous docs are auto-deleted after 30 days. Sign in to keep them forever and manage them in your dashboard.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
