import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { createSupabaseServerClient } from "~/lib/supabase.server";

export async function action({ request }: Route.ActionArgs) {
  const responseHeaders = new Headers();
  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  await supabase.auth.signOut();
  return redirect("/", { headers: responseHeaders });
}

export async function loader() {
  return new Response(null, { status: 405 });
}
