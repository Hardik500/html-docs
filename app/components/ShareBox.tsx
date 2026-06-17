import { useState } from "react";

interface ShareBoxProps {
  docId: string;
  tabSlug: string;
  /** When true, the copied URL includes ?solo=1 to preserve single-tab view mode. */
  solo?: boolean;
}

export default function ShareBox({ docId, tabSlug, solo }: ShareBoxProps) {
  const [copied, setCopied] = useState(false);

  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/d/${docId}/${tabSlug}`
      : `/d/${docId}/${tabSlug}`;
  const viewUrl = solo ? `${base}?solo=1` : base;

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
      className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 border bg-card border-hairline text-body hover:bg-strong"
      title="Copy share link"
    >
      {copied ? "✓ Copied!" : "Share"}
    </button>
  );
}
