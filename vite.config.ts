import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

/** Silently absorb browser-internal probes that have no app route. */
function ignoreWellKnownProbes(): Plugin {
  return {
    name: "ignore-well-known-probes",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/.well-known/")) {
          res.writeHead(404).end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), ignoreWellKnownProbes(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
