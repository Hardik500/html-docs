import { Form, redirect } from "react-router";
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
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight">html-docs</span>
        <a
          href="/dashboard"
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Dashboard
        </a>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <h1 className="text-4xl font-bold text-center mb-3">
          Share HTML docs instantly
        </h1>
        <p className="text-gray-400 text-center max-w-lg mb-10">
          Paste any HTML — AI-generated or hand-crafted — and get a shareable
          link in seconds. No sign-up required.
        </p>

        <Form method="post" action="/docs" className="w-full max-w-2xl">
          <textarea
            name="html"
            rows={14}
            placeholder="<!DOCTYPE html>&#10;<html>&#10;  <head><title>My Doc</title></head>&#10;  <body>&#10;    <h1>Hello world</h1>&#10;  </body>&#10;</html>"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            required
          />
          <div className="mt-3 flex items-center gap-3">
            <input
              name="title"
              type="text"
              placeholder="Document title (optional)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2 rounded-lg transition-colors"
            >
              Create →
            </button>
          </div>
        </Form>

        <p className="mt-6 text-xs text-gray-600">
          Anonymous docs are auto-deleted after 30 days of inactivity.{" "}
          <a href="/dashboard" className="underline hover:text-gray-400">
            Sign in
          </a>{" "}
          to keep them forever.
        </p>
      </div>
    </main>
  );
}
