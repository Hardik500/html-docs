import { query } from "~/lib/db.server";

export async function loader() {
  try {
    await query("SELECT 1");
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ status: "error" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
