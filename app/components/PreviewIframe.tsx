import { useEffect, useRef, useState } from "react";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { markdownToHtml } from "~/lib/markdown";
import { docToHtml } from "~/lib/doc";
import { injectPreviewCsp } from "~/lib/preview-csp";

interface PreviewIframeProps {
  html: string;
  title?: string;
  contentType?: "html" | "markdown" | "pdf" | "doc";
  /**
   * Same-origin URL that serves this tab's bytes. Required when
   * `contentType` is `"pdf"`; see PdfPreview for why.
   */
  src?: string;
}

type HtmlPreviewProps = Omit<PreviewIframeProps, "contentType"> & {
  contentType: "html" | "markdown" | "doc";
};

interface FrameState {
  id: number;
  html: string;
  /** true once onLoad has fired and the frame has been painted */
  ready: boolean;
}

const CROSSFADE_MS = 150;

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

/**
 * PDF preview.
 *
 * The PDF is loaded from a same-origin URL in an `<iframe>`, not from a
 * `data:` URL in an `<embed>`:
 *
 *  - The app shell's CSP sets `object-src 'none'` (see app/lib/csp.server.ts),
 *    which blocks `<embed>`/`<object>` outright — including `data:` URLs. A
 *    browser enforces that, so a `data:` embed renders nothing.
 *  - Relaxing the policy instead would be the wrong trade: a `data:` URL in an
 *    embedded browsing context inherits the app origin, so `data:text/html,…`
 *    would be a script-in-app-origin hole. Serving the bytes from our own origin
 *    as `application/pdf` keeps the response type under server control.
 *  - It also keeps a ~2.8 MB base64 string out of a DOM attribute.
 *
 * `/raw/:docId/:tabSlug` already decodes stored PDF tabs and serves them as
 * `application/pdf`, and the public viewer at `d.$docId.$tabSlug.tsx` already
 * previews PDFs this way. This keeps the editor consistent with it.
 */
function PdfPreview({ src, title = "Preview" }: Pick<PreviewIframeProps, "src" | "title">) {
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas text-sm text-subtle [contain:paint]">
        PDF — no source URL available for this tab
      </div>
    );
  }

  return (
    <div className="relative isolate h-full w-full overflow-hidden bg-canvas [contain:paint]">
      {/* No `type` attribute: it is not valid on <iframe> and the response's
          Content-Type is what selects the PDF viewer. */}
      <iframe
        src={src}
        className="absolute inset-0 block h-full w-full border-0"
        title={title}
      />
    </div>
  );
}

function HtmlPreview({ html, title = "Preview", contentType }: HtmlPreviewProps) {
  // All hooks must run unconditionally regardless of contentType.
  const isDark = useIsDark();
  const isDarkRef = useRef(isDark);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  const resolvedHtml =
    contentType === "markdown" ? markdownToHtml(html)
    : contentType === "doc"    ? docToHtml(html)
    : html;
  const [frames, setFrames] = useState<FrameState[]>([{ id: 0, html: resolvedHtml, ready: true }]);
  const nextId = useRef(1);
  const iframeRefs = useRef<Map<number, HTMLIFrameElement>>(new Map());
  // Tracks the last scroll Y reported by whichever iframe is active.
  const lastScrollY = useRef(0);

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

  // Handle postMessages from sandboxed iframes:
  //   html-docs-open-link  → open external URLs in a new tab
  //   html-docs-scroll     → record the current scroll Y so new frames can restore it
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data) return;
      if (e.data.type === "html-docs-open-link") {
        const url = e.data.url;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      } else if (e.data.type === "html-docs-scroll") {
        lastScrollY.current = e.data.y ?? 0;
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleLoad = (id: number) => {
    const win = iframeRefs.current.get(id)?.contentWindow;
    // Sync theme immediately after the iframe finishes loading.
    win?.postMessage({ type: "html-docs-theme", dark: isDarkRef.current }, "*");
    // Restore scroll before the frame fades in so the user never sees the jump.
    // Only restore for frames that aren't the initial load (id > 0).
    if (id > 0 && lastScrollY.current > 0) {
      win?.postMessage({ type: "html-docs-restore-scroll", y: lastScrollY.current }, "*");
    }
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
    <div className="relative isolate h-full w-full overflow-hidden bg-canvas [contain:paint]">
      {frames.map((frame, i) => (
        <iframe
          key={frame.id}
          ref={(el) => {
            if (el) iframeRefs.current.set(frame.id, el);
            else iframeRefs.current.delete(frame.id);
          }}
          srcDoc={injectDefaultStyles(injectPreviewCsp(frame.html), isDark)}
          onLoad={() => handleLoad(frame.id)}
          sandbox="allow-scripts"
          title={title}
          className="absolute inset-0 block h-full w-full border-0"
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

export default function PreviewIframe({
  html,
  title = "Preview",
  contentType = "html",
  src,
}: PreviewIframeProps) {
  if (contentType === "pdf") {
    return <PdfPreview src={src} title={title} />;
  }

  return <HtmlPreview html={html} title={title} contentType={contentType} />;
}
