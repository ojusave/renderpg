export class SafeHtml {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes a value for safe use in HTML text and attributes. */
export function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escape(value);
}

/** Tagged template that escapes interpolations unless they are already `SafeHtml`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  return new SafeHtml(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

/** Marks trusted markup (for example inline SVG) as safe. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}
