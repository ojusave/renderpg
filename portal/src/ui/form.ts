import type { Config } from "../config";
import type { FieldErrors, FormValues } from "../submissions/validate";
import { html, type SafeHtml } from "./html";
import { layout } from "./layout";

export type FormState = {
  mode: "create" | "edit";
  action: string;
  email: string;
  values: FormValues;
  errors: FieldErrors;
  notice?: string;
  teamTaken?: { slug?: string; projectName: string };
};

type Name = keyof FormValues;

function error(state: FormState, name: Name) {
  const msg = state.errors[name];
  return html`<p class="field-error" id="${name}-error" ${msg ? "" : "hidden"}>${msg ?? ""}</p>`;
}

function text(state: FormState, name: Name, label: string, opts: { placeholder?: string; hint?: string; type?: string; multiline?: boolean }) {
  const attrs = html`id="${name}" name="${name}" required placeholder="${opts.placeholder ?? ""}" aria-describedby="${name}-error" ${state.errors[name] ? html`aria-invalid="true"` : ""}`;
  return html`<div class="field">
    <label for="${name}">${label}</label>
    ${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ""}
    ${opts.multiline
      ? html`<textarea ${attrs} rows="5">${state.values[name]}</textarea>`
      : html`<input ${attrs} type="${opts.type ?? "text"}" value="${state.values[name]}" autocomplete="off">`}
    ${error(state, name)}
  </div>`;
}

function drop(state: FormState, name: Name, label: string, kind: "team" | "poster" | "video", hint: string, required = true) {
  const current = state.values[name];
  const accept = kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/*";
  return html`<div class="field">
    <span class="label">${label}${required ? "" : html` <em>optional</em>`}</span>
    <div class="drop ${current ? "has-file" : ""}" data-kind="${kind}" data-required="${required}">
      <input type="hidden" name="${name}" value="${current}">
      <input class="drop-input" id="${name}-file" type="file" accept="${accept}" aria-describedby="${name}-error">
      <label class="drop-target" for="${name}-file">
        <span class="drop-preview">${current
          ? kind === "video"
            ? html`<video src="/media/${current}" muted playsinline preload="metadata"></video>`
            : html`<img src="/media/${current}" alt="">`
          : ""}</span>
        <span class="drop-copy"><strong>${current ? "Replace" : "Choose or drop a file"}</strong><span>${hint}</span></span>
      </label>
      <div class="drop-status" aria-live="polite"><span class="bar"><span></span></span><span class="drop-msg">${current ? "Uploaded" : ""}</span>
        ${required ? "" : html`<button type="button" class="link-quiet drop-clear" ${current ? "" : "hidden"}>Remove</button>`}
      </div>
    </div>
    ${error(state, name)}
  </div>`;
}

function step(n: string, title: string, fields: SafeHtml[]) {
  return html`<fieldset class="step"><legend><span class="step-n">${n}</span>${title}</legend>${fields}</fieldset>`;
}

/** Create/edit form styled as a lab notebook, with instant uploads and a live checklist. */
export function formPage(config: Config, state: FormState): string {
  const editing = state.mode === "edit";
  const body = html`<div class="wrap form-wrap">
    <a class="back" href="/">← All experiments</a>
    <h1>${editing ? "Edit your experiment" : "Log your experiment"}</h1>
    <p class="lede">Signed in as <strong>${state.email}</strong>. You can publish one experiment, then edit or delete it here.</p>
    ${state.notice ? html`<div class="notice notice-ok" role="status">${state.notice}</div>` : ""}
    ${state.teamTaken
      ? html`<div class="notice" role="alert">${state.values.teamName} already logged “${state.teamTaken.projectName}”.
          ${state.teamTaken.slug ? html`<a href="/edit/${state.teamTaken.slug}">Edit your experiment instead →</a>` : "Choose a different team name."}</div>`
      : Object.keys(state.errors).length ? html`<div class="notice" role="alert">A few things need attention below.</div>` : ""}
    <form class="notebook" method="post" action="${state.action}" novalidate data-max-image="${config.maxImageBytes}" data-max-video="${config.maxVideoBytes}">
      ${step("01", "The lab", [
        text(state, "teamName", "Team name", { placeholder: "Barium", hint: "Your lab group. One experiment per team." }),
        text(state, "projectName", "Project name", { placeholder: "What you built" }),
        text(state, "siteUrl", "Site URL", { placeholder: "your-app.onrender.com", type: "url" }),
      ])}
      ${step("02", "The evidence", [
        drop(state, "posterPhoto", "Photo of your poster", "poster", "The whole trifold, straight on. JPG, PNG, or WebP."),
        drop(state, "teamPhoto", "Team photo", "team", "Lab coats and goggles encouraged."),
        drop(state, "video", "Video pitch", "video", "MP4, WebM, or MOV, up to " + Math.round(config.maxVideoBytes / 1048576) + " MB.", false),
      ])}
      ${step("03", "The findings", [
        text(state, "hypothesis", "Hypothesis", { placeholder: "If we…, then…", multiline: true }),
        text(state, "methods", "Method", { placeholder: "What you built and how: stack, agents, Render services.", multiline: true }),
        text(state, "results", "Results", { placeholder: "What happened? Some experiments fail in interesting ways.", multiline: true }),
      ])}
      <div class="savebar">
        <div class="savebar-progress"><span class="checklist" aria-live="polite"></span><span class="bar"><span></span></span></div>
        <button class="btn btn-primary btn-lg" type="submit">${editing ? "Save changes" : "Log experiment"}</button>
      </div>
    </form>
    ${editing ? html`<section class="danger-zone">
      <div><h2>Remove this experiment</h2><p>This deletes the gallery card and its uploaded files. This cannot be undone.</p></div>
      <form class="delete-form" method="post" action="/delete/${state.action.split("/").pop()}">
        <button class="btn btn-danger" type="submit">Delete experiment</button>
      </form>
    </section>` : ""}
    <noscript><p class="notice">Uploads need JavaScript. Please enable it to submit.</p></noscript>
  </div>`;
  return layout({ title: `${editing ? "Edit" : "Submit"} · Science Fair`, body, config, script: "form.js", showSubmit: false });
}
