import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/_index";
import { useState, lazy, Suspense, useEffect, useRef } from "react";
import PreviewIframe from "~/components/PreviewIframe";
import { getUserId } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (userId) return redirect("/dashboard");
  return {};
}

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
    <main className="min-h-screen flex flex-col relative overflow-hidden font-sans" style={{ backgroundColor: "#faf9f5", color: "#141413", selection: "rgba(204,120,92,0.2)" }}>
      {/* Subtle warm background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-30 pointer-events-none">
        <div className="absolute inset-0 rounded-full blur-[120px]" style={{ background: "radial-gradient(ellipse, rgba(204,120,92,0.15) 0%, rgba(245,240,232,0.1) 60%, transparent 100%)" }} />
      </div>

      {/* Subtle dot grid for light bg */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1' fill='rgba(0,0,0,0.04)'/%3E%3C/svg%3E\")", maskImage: "linear-gradient(to bottom, white, transparent 80%)" }} />

      <nav className="backdrop-blur-xl px-6 py-4 flex items-center justify-between sticky top-0 z-50 border-b" style={{ backgroundColor: "rgba(250,249,245,0.85)", borderColor: "#e6dfd8" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-lg border" style={{ background: "linear-gradient(to bottom right, #cc785c, #a9583e)", borderColor: "rgba(204,120,92,0.3)" }}>
            <span className="text-white font-bold text-sm font-mono">&lt;/&gt;</span>
          </div>
          <span className="font-semibold text-sm tracking-wide" style={{ color: "#252523" }}>html-docs</span>
        </div>
        <div className="flex items-center gap-6">
          <Link
            to="/dashboard"
            className="text-sm font-medium transition-colors"
            style={{ color: "#6c6a64" }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#141413")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#6c6a64")}
          >
            Sign in
          </Link>
          <Link
            to="/dashboard"
            className="text-sm font-medium px-4 py-2 rounded-lg transition-all border"
            style={{ backgroundColor: "#efe9de", borderColor: "#e6dfd8", color: "#252523" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#e8e0d2"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#efe9de"; }}
          >
            Dashboard
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center px-4 pt-24 pb-32 z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-8 border" style={{ backgroundColor: "rgba(204,120,92,0.08)", borderColor: "rgba(204,120,92,0.2)", color: "#cc785c" }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#cc785c" }} />
            No sign-up required
          </div>
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-6" style={{ color: "#141413" }}>
            Share HTML docs <br className="hidden sm:block" /> at the speed of thought.
          </h1>
          <p className="text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10" style={{ color: "#6c6a64" }}>
            The fastest way to write, preview, and share HTML components.
            Perfect for sharing AI-generated code, templates, or quick experiments.
          </p>

          <Form method="post" action="/docs" className="flex justify-center">
            <input type="hidden" name="html" value={html} />
            <button
              type="submit"
              className="group relative inline-flex items-center justify-center gap-3 text-white font-semibold px-8 py-4 rounded-full text-lg transition-all hover:scale-105 outline-none"
              style={{ backgroundColor: "#cc785c" }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#a9583e")}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#cc785c")}
            >
              Share This Document
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </button>
          </Form>
        </div>

        {/* Hero Product Mockup */}
        <div className="w-full max-w-5xl mx-auto relative group mt-8">
          <div className="absolute -inset-1 rounded-2xl blur opacity-20 group-hover:opacity-35 transition duration-1000 group-hover:duration-200" style={{ background: "linear-gradient(to right, #cc785c, #a9583e)" }}></div>
          <div className="relative rounded-2xl border shadow-2xl overflow-hidden flex flex-col h-[500px]" style={{ backgroundColor: "#1f1e1b", borderColor: "rgba(230,223,216,0.15)" }}>
            {/* Mac Window Bar */}
            <div className="h-12 flex items-center px-4 gap-2 border-b" style={{ backgroundColor: "#141413", borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <div className="mx-auto rounded-md px-4 py-1 flex items-center gap-2 text-xs border" style={{ backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)", color: "#8e8b82" }}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                html-docs.com/d/abc-123
              </div>
            </div>
            {/* Editor / Preview Split */}
            <div className="flex-1 flex overflow-hidden">
              <div className="w-1/2 bg-[#1e1e1e] flex flex-col relative overflow-hidden border-r" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <Suspense fallback={<div className="flex items-center justify-center h-full" style={{ color: "#6c6a64" }}>Loading editor...</div>}>
                  <Editor value={html} onChange={setHtml} />
                </Suspense>
              </div>
              <div className="w-1/2 relative" style={{ backgroundColor: "#faf9f5" }}>
                <PreviewIframe html={previewHtml} title="Landing Preview" />
              </div>
            </div>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="mt-32 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
          <div className="p-6 rounded-2xl border transition-colors" style={{ backgroundColor: "#f5f0e8", borderColor: "#e6dfd8" }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#efe9de")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#f5f0e8")}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(204,120,92,0.12)", color: "#cc785c" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "#141413" }}>Instant Previews</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#6c6a64" }}>See your changes in real-time. The editor and preview are side-by-side for an ultra-fast feedback loop.</p>
          </div>
          <div className="p-6 rounded-2xl border transition-colors" style={{ backgroundColor: "#f5f0e8", borderColor: "#e6dfd8" }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#efe9de")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#f5f0e8")}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(93,184,166,0.12)", color: "#5db8a6" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "#141413" }}>One-Click Sharing</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#6c6a64" }}>Copy the URL and share it with anyone. They'll see exactly what you see, perfectly rendered.</p>
          </div>
          <div className="p-6 rounded-2xl border transition-colors" style={{ backgroundColor: "#f5f0e8", borderColor: "#e6dfd8" }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#efe9de")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = "#f5f0e8")}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(232,165,90,0.12)", color: "#e8a55a" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "#141413" }}>Secure & Private</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#6c6a64" }}>Anonymous docs are auto-deleted after 30 days. Sign in to keep them forever and manage them in your dashboard.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
