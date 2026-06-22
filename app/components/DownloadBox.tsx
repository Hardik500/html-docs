import { useState, useRef, useEffect } from "react";

interface DownloadBoxProps {
  docId: string;
  tabSlug: string;
  tabName: string;
  contentType: "html" | "markdown" | "pdf" | "doc";
  isUnsaved?: boolean;
}

function Ext({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[8px] font-bold tracking-tighter border border-hairline bg-surface text-muted shrink-0">
      {label}
    </span>
  );
}

export default function DownloadBox({ docId, tabSlug, tabName, contentType, isUnsaved = false }: DownloadBoxProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const base = `/download/${docId}/${tabSlug}`;
  const isPdf = contentType === "pdf";

  function openPrintDialog() {
    window.open(`/raw/${docId}/${tabSlug}?print=1`, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  const itemClass = "flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-body hover:bg-strong";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !isUnsaved && setOpen((v) => !v)}
        disabled={isUnsaved}
        title={isUnsaved ? "Save changes before downloading" : "Download"}
        className="flex text-xs font-medium px-3 py-1.5 rounded-md transition-colors items-center gap-1.5 border bg-card border-hairline text-body hover:bg-strong disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Download
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 rounded-lg shadow-xl z-50 border bg-paper border-hairline overflow-hidden py-1">
          {isPdf ? (
            <a href={`${base}?format=pdf`} download={`${tabName}.pdf`} onClick={() => setOpen(false)} className={itemClass}>
              <Ext label="PDF" /> Download PDF
            </a>
          ) : (
            <>
              <a href={`${base}?format=html`} download={`${tabName}.html`} onClick={() => setOpen(false)} className={itemClass}>
                <Ext label="HTML" /> Download HTML
              </a>
              <a href={`${base}?format=md`} download={`${tabName}.md`} onClick={() => setOpen(false)} className={itemClass}>
                <Ext label="MD" /> Download Markdown
              </a>
              <a href={`${base}?format=docx`} download={`${tabName}.docx`} onClick={() => setOpen(false)} className={itemClass}>
                <Ext label="DOCX" /> Download Word
              </a>
              <div className="h-px bg-hairline mx-2 my-1" />
              <button onClick={openPrintDialog} className={itemClass}>
                <Ext label="PDF" /> Save as PDF…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
