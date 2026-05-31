const PERF_ENABLED = process.env.PERF_LOG === "1";

export interface Timer {
  mark(name: string): void;
  end(): void;
}

const NOOP: Timer = { mark() {}, end() {} };

// Lightweight per-request timing. Emits one parseable line per request when
// PERF_LOG=1, e.g. `[perf] dashboard auth=183ms db=11ms rest=4ms total=198ms`.
// No-op (zero overhead) when the flag is unset, so it is safe to leave wired in.
export function createTimer(label: string): Timer {
  if (!PERF_ENABLED) return NOOP;

  const start = Date.now();
  let last = start;
  const spans: string[] = [];

  return {
    mark(name: string) {
      const now = Date.now();
      spans.push(`${name}=${now - last}ms`);
      last = now;
    },
    end() {
      const now = Date.now();
      const rest = now - last;
      console.log(
        `[perf] ${label} ${spans.join(" ")} rest=${rest}ms total=${now - start}ms`
      );
    },
  };
}
