import { Form, redirect, Link } from "react-router";
import type { Route } from "./+types/_index";

export const meta: Route.MetaFunction = () => [
  { title: "html-docs — Share AI-generated HTML instantly" },
  {
    name: "description",
    content:
      "Paste your AI-generated HTML and get an instant shareable link. No signup required.",
  },
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-indigo-500/20 blur-[120px] rounded-full pointer-events-none" />

      <nav className="border-b border-white/5 bg-gray-950/50 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="text-white font-bold text-xs font-mono">&lt;/&gt;</span>
          </div>
          <span className="font-semibold text-sm tracking-wide text-gray-200">html-docs</span>
        </div>
        <Link
          to="/dashboard"
          className="text-sm font-medium text-gray-400 hover:text-gray-100 transition-colors"
        >
          Dashboard
        </Link>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-20 z-10">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 mb-4 drop-shadow-sm">
            Share HTML docs instantly
          </h1>
          <p className="text-gray-400 text-lg">
            Paste any HTML — AI-generated or hand-crafted — and get a shareable
            link in seconds. No sign-up required.
          </p>
        </div>

        <Form method="post" action="/docs" className="w-full max-w-3xl">
          <div className="bg-gray-900/80 backdrop-blur-sm border border-white/10 rounded-xl p-2 shadow-2xl shadow-black/50 focus-within:ring-1 focus-within:ring-indigo-500/50 focus-within:border-indigo-500/50 transition-all duration-300">
            <textarea
              name="html"
              rows={12}
              placeholder="<!DOCTYPE html>&#10;<html>&#10;  <head><title>My Doc</title></head>&#10;  <body>&#10;    <h1>Hello world</h1>&#10;  </body>&#10;</html>"
              className="w-full bg-transparent p-4 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none resize-y min-h-[200px]"
              required
            />
            <div className="mt-2 flex flex-col sm:flex-row items-center gap-3 border-t border-white/5 pt-3 px-2 pb-1">
              <input
                name="title"
                type="text"
                placeholder="Document title (optional)"
                className="w-full sm:flex-1 bg-transparent px-2 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
              />
              <button
                type="submit"
                className="w-full sm:w-auto bg-white text-black hover:bg-gray-200 font-medium px-6 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Create <span className="text-gray-500">→</span>
              </button>
            </div>
          </div>
        </Form>

        <p className="mt-8 text-sm text-gray-500">
          Anonymous docs are auto-deleted after 30 days.{" "}
          <Link to="/dashboard" className="text-indigo-400 hover:text-indigo-300 transition-colors">
            Sign in
          </Link>{" "}
          to keep them forever.
        </p>
      </div>
    </main>
  );
}
