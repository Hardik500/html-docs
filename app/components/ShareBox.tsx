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
      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors"
      title="Copy share link"
    >
      {copied ? "✓ Copied!" : "Share"}
    </button>
  );
}
