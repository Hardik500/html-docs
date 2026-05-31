import { useEffect, useRef, useState } from "react";
import { injectDefaultStyles } from "~/lib/htmlDefaults";

interface PreviewIframeProps {
  html: string;
  title?: string;
}

interface FrameState {
  id: number;
  html: string;
  /** true once onLoad has fired and the frame has been painted */
  ready: boolean;
}

const CROSSFADE_MS = 150;

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.skypack.dev",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src https: data:",
  "connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.skypack.dev",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function injectCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${meta}`);
  }
  return meta + "\n" + html;
}

export default function PreviewIframe({ html, title = "Preview" }: PreviewIframeProps) {
  const [frames, setFrames] = useState<FrameState[]>([{ id: 0, html, ready: true }]);
  const nextId = useRef(1);

  // When html changes, push a new background frame (ready=false).
  // The old frame(s) remain visible underneath until the new one fades in.
  useEffect(() => {
    setFrames((prev) => {
      if (prev[prev.length - 1].html === html) return prev;
      return [...prev, { id: nextId.current++, html, ready: false }];
    });
  }, [html]);

  const handleLoad = (id: number) => {
    // Double-rAF ensures the browser has painted the new frame before we
    // trigger the CSS fade-in. Without this, opacity transitions over an
    // unrendered surface still flash white.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Mark frame as ready → CSS transition fades it in over the old frame.
        setFrames((prev) =>
          prev.map((f) => (f.id === id ? { ...f, ready: true } : f))
        );
        // After the crossfade completes, discard stale frames underneath.
        setTimeout(() => {
          setFrames((prev) => {
            const index = prev.findIndex((f) => f.id === id);
            if (index === -1) return prev;
            return prev.slice(index);
          });
        }, CROSSFADE_MS + 50); // small buffer after transition ends
      });
    });
  };

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: "#F9F9F7" }}>
      {frames.map((frame, i) => (
        <iframe
          key={frame.id}
          srcDoc={injectDefaultStyles(injectCsp(frame.html))}
          onLoad={() => handleLoad(frame.id)}
          sandbox="allow-scripts"
          title={title}
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: frame.ready ? 1 : 0,
            // Fade in when ready; no transition while loading (avoids flash on removal).
            transition: frame.ready ? `opacity ${CROSSFADE_MS}ms ease-in` : "none",
            pointerEvents: frame.ready ? "auto" : "none",
            // Newer frames stack on top so they fade in over the old content.
            zIndex: i,
          }}
        />
      ))}
    </div>
  );
}
