export const GDOCS_CLIPBOARD =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-5e6f-7890-abcd-ef1234567890"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Plain </span><span style="font-weight:700;">bold</span><span style="font-style:italic;"> italic</span></p><ul><li><p dir="ltr"><span>bullet one</span></p></li></ul><h1 dir="ltr"><span>Heading</span></h1><table><tbody><tr><td><p>cell</p></td></tr></tbody></table></b>';

/** A Google Docs "Webpage (.html)" export: a complete document, not a fragment. */
export const GDOCS_WEBPAGE_EXPORT =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Q3 Planning Doc</title>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700">' +
  '<style type="text/css">.gdocs-marker{color:rgb(1,2,3);font-size:9pt}</style></head>' +
  '<body dir="ltr" style="font-family:Roboto,sans-serif;background-color:#ffffff">' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">' +
  '<span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Plain </span>' +
  '<span style="font-weight:700;">bold</span></p>' +
  '<h1 dir="ltr"><span>Heading</span></h1>' +
  '<p class="gdocs-marker" dir="ltr"><span>marker</span></p>' +
  '<script>window.__gdocsRan = true;</script>' +
  '</body></html>';

/**
 * Google Docs wraps exported/pasted content in <b id="docs-internal-guid-...">
 * and emits one <span style="..."> per formatting run. This generator produces
 * that shape so payload sizes can be measured instead of guessed.
 */
export function gdocsHtml({ paragraphs, wordsPerParagraph = 120, runsPerParagraph = 1 } = {}) {
  const spanOpen =
    '<span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;' +
    "font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;" +
    'vertical-align:baseline;white-space:pre;white-space:pre-wrap;">';
  const body = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const words = Array.from({ length: wordsPerParagraph }, (_, w) => `word${w}`).join(" ");
    // Google Docs emits one styled <span> per formatting run, not per paragraph.
    const per = Math.max(1, Math.ceil(wordsPerParagraph / runsPerParagraph));
    const runs = [];
    for (let r = 0; r < runsPerParagraph; r += 1) {
      const slice = words.split(" ").slice(r * per, (r + 1) * per).join(" ");
      runs.push(slice ? `${spanOpen}${slice} </span>` : "");
    }
    body.push(
      `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${runs.join("")}` +
        `<span style="font-weight:700;">emphasis</span></p>`,
    );
  }
  return (
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-5e6f-7890-abcd-ef1234567890">' +
    body.join("") +
    "</b>"
  );
}

export const GDOCS_SHEETS_MARKER = 'google-sheets-html-origin';
