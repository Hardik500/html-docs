import { createRequestHandler } from "@react-router/express";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readCookie(header, name) {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function hasDesktopToken(req, token) {
  const queryToken =
    typeof req.query.desktop_token === "string"
      ? req.query.desktop_token
      : undefined;
  const cookieToken = readCookie(req.headers.cookie, "html_docs_desktop");
  const headerToken = req.headers["x-html-docs-desktop-token"];
  return queryToken === token || cookieToken === token || headerToken === token;
}

export async function startLocalServer({
  port,
  token,
  serverBuildPath,
  assetsBuildDirectory,
  publicDirectory,
  host = "127.0.0.1",
}) {
  if (!token || !serverBuildPath || !assetsBuildDirectory || !publicDirectory) {
    throw new Error(
      "token, serverBuildPath, assetsBuildDirectory, and publicDirectory are required",
    );
  }

  const build = await import(pathToFileURL(serverBuildPath).href);
  if (!existsSync(assetsBuildDirectory)) {
    throw new Error(`Desktop assets directory not found: ${assetsBuildDirectory}`);
  }

  const app = express();
  app.disable("x-powered-by");

  // The local server is deliberately authenticated by a per-launch token. The
  // BrowserWindow receives it on the first navigation and then receives an
  // HttpOnly cookie for asset and loader requests.
  app.get("/__desktop/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (hasDesktopToken(req, token)) {
      if (typeof req.query.desktop_token === "string") {
        res.setHeader(
          "Set-Cookie",
          `html_docs_desktop=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
        );
      }
      return next();
    }

    res.status(401).send("Desktop session token is missing");
  });

  app.use(
    path.posix.join(build.publicPath, "assets"),
    express.static(path.join(assetsBuildDirectory, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(build.publicPath, express.static(assetsBuildDirectory));
  app.use(express.static(publicDirectory, { maxAge: "1h" }));
  app.use(
    createRequestHandler({
      build,
      mode: "production",
    }),
  );

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once("error", reject);
  });

  const origin = `http://${host}:${port}`;
  console.log(`[html-docs] desktop server listening on ${origin}`);

  return {
    origin,
    async close() {
      try {
        await fetch(`${origin}/__desktop/shutdown`, {
          method: "POST",
          headers: { "x-html-docs-desktop-token": token },
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        // The database may already be closed or the server may be shutting down.
      }
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startLocalServer({
    port: Number(process.env.HTML_DOCS_SERVER_PORT ?? 3000),
    token: process.env.HTML_DOCS_DESKTOP_TOKEN,
    serverBuildPath: process.env.HTML_DOCS_SERVER_BUILD,
    assetsBuildDirectory:
      process.env.HTML_DOCS_ASSETS_DIR ??
      path.resolve(
        path.dirname(process.env.HTML_DOCS_SERVER_BUILD),
        "..",
        "client",
      ),
    publicDirectory: process.env.HTML_DOCS_PUBLIC_DIR,
  });

  const close = () => {
    void server.close().then(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
