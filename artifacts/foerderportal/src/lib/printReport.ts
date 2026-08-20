/**
 * Print/save-as-PDF for an in-page report element.
 *
 * Calling `window.print()` directly is silently ignored inside a sandboxed
 * iframe (e.g. the Replit workspace preview) because the `allow-modals`
 * permission is not set. To make "Als PDF speichern" reliable everywhere, we
 * open the report in a new top-level window, copy the page's stylesheets into
 * it, and print from there. If popups are blocked we fall back to the direct
 * `window.print()` (which works for the deployed, non-iframed app).
 */
export function printReport(el: HTMLElement | null, title = "Gebäude-Report"): boolean {
  if (!el) {
    window.print();
    return true;
  }

  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) {
    // Popup blocked — best effort with the native dialog.
    window.print();
    return false;
  }

  // Carry over Vite-injected <style> tags (dev) and linked stylesheets (prod).
  const headStyles = Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]'),
  )
    .map((node) => node.outerHTML)
    .join("\n");

  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<base href="${document.baseURI}" />
<title>${title}</title>
${headStyles}
<style>
  html, body { background: #fff !important; margin: 0; }
  body { padding: 24px; }
  /* Reveal every tab panel and hide interactive-only chrome in the print view. */
  [role="tabpanel"][hidden] { display: block !important; }
  [role="tablist"], .no-print, button { display: none !important; }
  .print-area { display: block !important; }
</style>
</head>
<body>${el.outerHTML}</body>
</html>`);
  doc.close();
  win.focus();

  const triggerPrint = () => {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    const ready = fonts?.ready ?? Promise.resolve();
    // Wait for fonts (bounded) so the layout is settled before printing.
    Promise.race([ready, new Promise((r) => window.setTimeout(r, 1200))]).then(() => {
      win.focus();
      win.print();
    });
  };

  // Give the cloned styles a moment to apply before printing.
  if (doc.readyState === "complete") {
    window.setTimeout(triggerPrint, 200);
  } else {
    win.onload = () => window.setTimeout(triggerPrint, 200);
  }

  return true;
}
