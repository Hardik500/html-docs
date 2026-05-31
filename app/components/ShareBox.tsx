import { useState } from "react";

interface ShareBoxProps {
  docId: string;
  tabSlug: string;
}

export default function ShareBox({ docId, tabSlug }: ShareBoxProps) {
  const [copied, setCopied] = useState(false);

  const viewUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/d/${docId}/${tabSlug}`
      : `/d/${docId}/${tabSlug}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(viewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 border"
      style={{ backgroundColor: "#efe9de", borderColor: "#e6dfd8", color: "#3d3d3a" }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#e8e0d2")}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#efe9de")}
      title="Copy share link"
    >
      {copied ? "✓ Copied!" : "Share"}
    </button>
  );
}
