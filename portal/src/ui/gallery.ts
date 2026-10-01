import type { Config } from "../config";
import type { Page, Submission } from "../submissions/types";
import { elementTile } from "./elements";
import { html } from "./html";
import { layout } from "./layout";

function card(s: Submission) {
  return html`<li>
    <a class="card" href="/p/${s.slug}">
      <span class="card-board">
        <img src="/media/${s.posterPhoto}" alt="Poster for ${s.projectName}" loading="lazy" decoding="async">
        ${elementTile(s.teamName)}
      </span>
      <span class="card-body">
        <span class="card-title">${s.projectName}</span>
        <span class="card-team">${s.teamName}</span>
        <span class="card-hypo">${s.hypothesis}</span>
      </span>
    </a>
  </li>`;
}

function hero(config: Config, total: number) {
  return html`<section class="hero wrap">
    <p class="eyebrow">Rendervous: For Science! · Maker Day 2026</p>
    <h1>The Science Fair</h1>
    <p class="lede">Every Maker Day experiment: the hypothesis, the poster, and what actually happened.</p>
    <div class="hero-actions">
      ${config.submissionsOpen ? html`<a class="btn btn-primary btn-lg" href="/submit">Submit your experiment</a>` : html`<span class="pill">Submissions are closed</span>`}
    </div>
    <p class="count" aria-live="polite">${total === 1 ? "1 experiment" : `${total} experiments`} logged</p>
  </section>`;
}

function empty(config: Config) {
  return html`<div class="empty wrap">
    <div class="empty-board" aria-hidden="true"><span></span><span></span><span></span></div>
    <h2>No experiments yet.</h2>
    <p>The board is blank. Be the first lab group to log yours.</p>
    ${config.submissionsOpen ? html`<a class="btn btn-primary" href="/submit">Submit your experiment</a>` : ""}
  </div>`;
}

function pager(page: number, pages: number) {
  if (pages <= 1) return "";
  return html`<nav class="pager wrap" aria-label="Pages">
    ${page > 1 ? html`<a class="btn btn-ghost" href="/?page=${page - 1}">← Newer</a>` : html`<span></span>`}
    <span class="pager-label">Page ${page} of ${pages}</span>
    ${page < pages ? html`<a class="btn btn-ghost" href="/?page=${page + 1}">Older →</a>` : html`<span></span>`}
  </nav>`;
}

/** Public gallery of every submitted experiment. */
export function galleryPage(config: Config, data: Page<Submission>, page: number, perPage: number, notice?: string): string {
  const pages = Math.max(1, Math.ceil(data.total / perPage));
  const body = html`${notice ? html`<div class="toast" role="status">${notice}</div>` : ""}${hero(config, data.total)}
    ${data.total === 0
      ? empty(config)
      : html`<ul class="grid wrap" role="list">${data.items.map(card)}</ul>${pager(page, pages)}`}`;
  return layout({ title: "Science Fair · Rendervous Maker Day 2026", body, config, showSubmit: false });
}

/** Shown when the gallery cannot load (database unavailable). */
export function unavailablePage(config: Config): string {
  const body = html`<div class="empty wrap">
    <h2>The lab is briefly closed.</h2>
    <p>We couldn't load the experiments just now. Refresh in a moment.</p>
    <a class="btn btn-ghost" href="/">Try again</a>
  </div>`;
  return layout({ title: "Temporarily unavailable · Science Fair", body, config, showSubmit: false });
}

/** Generic not-found or error message page. */
export function messagePage(config: Config, title: string, text: string): string {
  const body = html`<div class="empty wrap"><h2>${title}</h2><p>${text}</p><a class="btn btn-ghost" href="/">Back to the Science Fair</a></div>`;
  return layout({ title: `${title} · Science Fair`, body, config });
}
