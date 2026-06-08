import { useEffect, useRef, useState } from "react";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { markdownToHtml } from "~/lib/markdown";

interface PreviewIframeProps {
  html: string;
  title?: string;
  contentType?: "html" | "markdown" | "pdf";
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

function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

export default function PreviewIframe({ html, title = "Preview", contentType = "html" }: PreviewIframeProps) {
  // All hooks must run unconditionally regardless of contentType.
  const isDark = useIsDark();
  const isDarkRef = useRef(isDark);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  const resolvedHtml = contentType === "markdown" ? markdownToHtml(html) : html;
  const [frames, setFrames] = useState<FrameState[]>([{ id: 0, html: resolvedHtml, ready: true }]);
  const nextId = useRef(1);
  const iframeRefs = useRef<Map<number, HTMLIFrameElement>>(new Map());

  // PDF: bypass the iframe crossfade stack entirely — embed renders natively in the browser.
  if (contentType === "pdf") {
    return (
      <div className="relative w-full h-full bg-canvas">
        <embed
          src={`data:application/pdf;base64,${html}`}
          type="application/pdf"
          className="absolute inset-0 w-full h-full border-0"
          title={title}
        />
      </div>
    );
  }

  // When html changes, push a new background frame (ready=false).
  // The old frame(s) remain visible underneath until the new one fades in.
  useEffect(() => {
    setFrames((prev) => {
      if (prev[prev.length - 1].html === resolvedHtml) return prev;
      return [...prev, { id: nextId.current++, html: resolvedHtml, ready: false }];
    });
  }, [resolvedHtml]);

  // When isDark changes, notify all live iframes via postMessage.
  useEffect(() => {
    iframeRefs.current.forEach((iframe) => {
      iframe.contentWindow?.postMessage({ type: "html-docs-theme", dark: isDark }, "*");
    });
  }, [isDark]);

  const handleLoad = (id: number) => {
    // Sync theme immediately after the iframe finishes loading.
    iframeRefs.current.get(id)?.contentWindow?.postMessage(
      { type: "html-docs-theme", dark: isDarkRef.current }, "*"
    );
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
    <div className="relative w-full h-full bg-canvas">
      {frames.map((frame, i) => (
        <iframe
          key={frame.id}
          ref={(el) => {
            if (el) iframeRefs.current.set(frame.id, el);
            else iframeRefs.current.delete(frame.id);
          }}
          srcDoc={injectDefaultStyles(injectCsp(frame.html), isDark)}
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
