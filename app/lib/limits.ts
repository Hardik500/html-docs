export type TabContentType = "html" | "markdown" | "pdf" | "doc";

export const MAX_HTML_BYTES = 500_000; // 500 KB per HTML/MD tab
// 2.8 MB cap for binary-ish tabs (PDF base64, doc HTML with inline images):
// keeps the total save payload under Vercel's 4.5 MB serverless limit.
export const MAX_PDF_BYTES = 2_800_000;
export const MAX_DOC_BYTES = 2_800_000;

export function maxBytesForType(type: TabContentType): number {
  if (type === "pdf") return MAX_PDF_BYTES;
  if (type === "doc") return MAX_DOC_BYTES;
  return MAX_HTML_BYTES;
}
