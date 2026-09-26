import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    // Vitest's 5000ms default is below what this suite actually costs on a
    // GitHub runner, and it was failing there for that reason alone:
    //
    //   windows  test/local-db.test.ts       8643ms
    //   windows  test/desktop-sync.test.ts   9101ms
    //   macos    test/desktop-sync.test.ts   5160ms
    //
    // The PGlite suites spin up a WASM Postgres, and 34 files run in parallel on
    // a shared runner, so they land well past 5s. This is a budget problem, not
    // a broken test: the same commits pass in 272/272 on ubuntu and on this
    // machine.
    //
    // It is set globally rather than per-file on the two slow suites, because a
    // timeout does not only fail the slow test. Under contention the event loop
    // stalls, and vitest's timer fires against whichever test happens to be
    // running at that moment -- which is how a pure in-memory regex assertion in
    // test/gdocs-content.test.ts was reported as "timed out in 5000ms" on
    // windows. Per-file overrides would leave that in place. 15s clears the
    // slowest observed run with headroom while still bounding a genuine hang.
    testTimeout: 15000,
  },
});
