import { drivePreviewUrl } from "../media/video";
import type { Config } from "../config";
import type { Submission } from "../submissions/types";
import { elementTile } from "./elements";
import { html } from "./html";
import { layout } from "./layout";

const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const hostOf = (url: string) => new URL(url).host.replace(/^www\./, "");
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => html`<p>${p}</p>`);

function panel(n: string, label: string, text: string) {
  return html`<section class="panel">
    <h2 class="panel-label"><span>${n}</span>${label}</h2>
    <div class="panel-text">${paragraphs(text)}</div>
  </section>`;
}

/** Public page for one experiment, laid out like a science-fair trifold. */
export function detailPage(config: Config, s: Submission, notice?: string): string {
  const body = html`<article class="wrap detail">
    ${notice ? html`<div class="toast" role="status">${notice}</div>` : ""}
    <a class="back" href="/">← All experiments</a>
    <header class="detail-head">
      ${elementTile(s.teamName, "lg")}
      <div class="detail-title">
        <p class="eyebrow">${s.teamName}</p>
        <h1>${s.projectName}</h1>
        <p class="meta">Updated ${date(s.updatedAt)} by ${s.updatedBy}</p>
      </div>
      <div class="detail-actions">
        <a class="btn btn-primary" href="${s.siteUrl}" rel="noopener" target="_blank">Visit ${hostOf(s.siteUrl)} ↗</a>
        ${config.submissionsOpen ? html`<a class="btn btn-ghost" href="/edit/${s.slug}">Edit</a>` : ""}
      </div>
    </header>

    <figure class="board">
      <a href="/media/${s.posterPhoto}" target="_blank" rel="noopener"><img src="/media/${s.posterPhoto}" alt="Poster for ${s.projectName}"></a>
      <figcaption>The poster · open full size ↗</figcaption>
    </figure>

    <div class="trifold">
      ${panel("01", "Hypothesis", s.hypothesis)}
      ${panel("02", "Method", s.methods)}
      ${panel("03", "Results", s.results)}
    </div>

    <div class="evidence ${s.video ? "" : "evidence-single"}">
      ${s.video
        ? drivePreviewUrl(s.video)
          ? html`<figure class="pitch-frame"><iframe class="pitch" src="${drivePreviewUrl(s.video)}" title="Video pitch for ${s.projectName}" allow="autoplay; fullscreen" allowfullscreen></iframe><figcaption>Video pitch</figcaption></figure>`
          : html`<figure><video src="/media/${s.video}" controls preload="metadata" playsinline></video><figcaption>Video pitch</figcaption></figure>`
        : ""}
      <figure><img src="/media/${s.teamPhoto}" alt="${s.teamName} team photo" loading="lazy"><figcaption>The lab group: ${s.teamName}</figcaption></figure>
    </div>
  </article>`;
  return layout({ title: `${s.projectName} · ${s.teamName} · Science Fair`, description: s.hypothesis, body, config });
}
