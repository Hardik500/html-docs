import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("/docs", "routes/docs.tsx"),
  route("/d/:docId", "routes/d.$docId.tsx"),
  route("/d/:docId/:tabSlug", "routes/d.$docId.$tabSlug.tsx"),
  route("/d/:docId/edit", "routes/d.$docId.edit.tsx"),
  route("/raw/:docId/:tabSlug", "routes/raw.$docId.$tabSlug.tsx"),
  route("/auth/magic", "routes/auth.magic.tsx"),
  route("/auth/magic/:token", "routes/auth.magic.$token.tsx"),
  route("/auth/claim", "routes/auth.claim.tsx"),
  route("/auth/logout", "routes/auth.logout.tsx"),
  route("/dashboard", "routes/dashboard.tsx"),
  route("/dashboard/docs/:id/delete", "routes/dashboard.docs.$id.delete.tsx"),
  route("/dashboard/docs/:id/rename", "routes/dashboard.docs.$id.rename.tsx"),
  route("/healthz", "routes/healthz.tsx"),
] satisfies RouteConfig;
