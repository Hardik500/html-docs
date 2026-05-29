import { useEffect, useRef, useState } from "react";

interface PreviewIframeProps {
  html: string;
  title?: string;
}

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
  "font-src https://fonts.gstatic.com data:",
  "img-src https: data:",
  "connect-src 'none'",
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
  const [frames, setFrames] = useState([{ id: 0, html }]);
  const nextId = useRef(1);

  // Double-buffering: when html changes, add a new hidden iframe.
  // When it finishes loading, remove all older iframes so it becomes visible.
  useEffect(() => {
    setFrames((prev) => {
      if (prev[prev.length - 1].html === html) return prev;
      return [...prev, { id: nextId.current++, html }];
    });
  }, [html]);

  const handleLoad = (id: number) => {
    // Double-rAF: wait until browser has painted the new frame before swap.
    // Without this, onLoad fires before compositing → white flash.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFrames((prev) => {
          const index = prev.findIndex((f) => f.id === id);
          if (index === -1) return prev;
          return prev.slice(index);
        });
      });
    });
  };

  return (
    <div className="relative w-full h-full bg-white">
      {frames.map((frame, i) => {
        // Only the oldest frame in the list is visible. Newer frames are loading in the background.
        const isVisible = i === 0;
        return (
          <iframe
            key={frame.id}
            srcDoc={injectCsp(frame.html)}
            onLoad={() => handleLoad(frame.id)}
            sandbox="allow-scripts"
            title={title}
            className="absolute inset-0 w-full h-full border-0"
            style={{
              opacity: isVisible ? 1 : 0,
              // Do NOT use visibility:hidden — it stops the browser from
              // compositing the background frame, causing a white flash on swap.
              // pointer-events:none keeps hidden frames inert instead.
              pointerEvents: isVisible ? "auto" : "none",
              zIndex: isVisible ? 1 : 0,
            }}
          />
        );
      })}
    </div>
  );
}
