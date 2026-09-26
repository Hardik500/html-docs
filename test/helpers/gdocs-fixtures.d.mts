export const GDOCS_CLIPBOARD: string;
export const GDOCS_WEBPAGE_EXPORT: string;
export const GDOCS_SHEETS_MARKER: string;
export function gdocsHtml(options?: {
  paragraphs?: number;
  wordsPerParagraph?: number;
  runsPerParagraph?: number;
}): string;
