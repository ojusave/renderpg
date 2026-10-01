import type { Config } from "../config";
import { html } from "./html";
import { layout } from "./layout";

/** Asks for a work email before someone can submit, edit, or delete. */
export function signinPage(config: Config, next: string, value = "", error?: string): string {
  const body = html`<div class="wrap form-wrap">
    <a class="back" href="/">← All experiments</a>
    <h1>Who's submitting?</h1>
    <p class="lede">Enter your Render email. You'll use the same email to edit or delete your experiment later.</p>
    <form class="signin" method="post" action="/signin">
      <input type="hidden" name="next" value="${next}">
      <fieldset class="step">
        <div class="field">
          <label for="email">Work email</label>
          <input id="email" name="email" type="email" required autofocus autocomplete="email" placeholder="you@${config.emailDomain}"
            value="${value}" aria-describedby="email-error" ${error ? html`aria-invalid="true"` : ""}>
          <p class="field-error" id="email-error" ${error ? "" : "hidden"}>${error ?? ""}</p>
        </div>
        <div><button class="btn btn-primary" type="submit">Continue</button></div>
      </fieldset>
    </form>
  </div>`;
  return layout({ title: "Your email · Science Fair", body, config, css: "form.css", showSubmit: false });
}
