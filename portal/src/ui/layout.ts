import type { Config } from "../config";
import { renderMark } from "./brand";
import { html, type SafeHtml } from "./html";

export type PageOptions = {
  title: string;
  body: SafeHtml;
  config: Config;
  description?: string;
  script?: string;
  css?: string;
  showSubmit?: boolean;
};

/** Wraps page content in the shared document, header, and footer. */
export function layout({ title, body, config, description, script, css, showSubmit = true }: PageOptions): string {
  const v = config.assetVersion;
  return `<!doctype html>${html`<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description ?? "Every experiment from Rendervous Maker Day 2026."}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/app.css?v=${v}">
  ${css ? html`<link rel="stylesheet" href="/assets/${css}?v=${v}">` : ""}
  ${script ? html`<link rel="stylesheet" href="/assets/${script.replace(/\.js$/, ".css")}?v=${v}"><script type="module" src="/assets/${script}?v=${v}"></script>` : ""}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="/" aria-label="Science Fair home">
        ${renderMark(20)}<span class="brand-name">Science Fair</span><span class="brand-tag">Maker Day ’26</span>
      </a>
      <nav class="topnav" aria-label="Site">
        ${showSubmit && config.submissionsOpen ? html`<a class="btn btn-primary" href="/submit">Submit experiment</a>` : ""}
      </nav>
    </div>
  </header>
  <main id="main" class="page">${body}</main>
  <footer class="footer">
    <div class="wrap footer-inner">
      <p class="footer-note">${renderMark(14)} Rendervous: For Science!</p>
    </div>
  </footer>
</body>
</html>`}`;
}
