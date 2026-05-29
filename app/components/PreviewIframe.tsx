import { useEffect, useRef, useState } from "react";

interface PreviewIframeProps {
  html: string;
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

export default function PreviewIframe({ html }: PreviewIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string>("");

  useEffect(() => {
    const injected = injectCsp(html);
    const blob = new Blob([injected], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      key={blobUrl}
      src={blobUrl}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white"
      title="Preview"
    />
  );
}
