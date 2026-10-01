// Seamless submit form: files upload the moment they're chosen, a checklist tracks what's left.
const form = document.querySelector("form.notebook");
const saveBtn = form.querySelector('button[type="submit"]');
const checklist = form.querySelector(".checklist");
const saveBar = form.querySelector(".savebar");
const LABELS = { teamName: "Team name", projectName: "Project name", siteUrl: "Site URL", posterPhoto: "Poster photo", teamPhoto: "Team photo", hypothesis: "Hypothesis", methods: "Method", results: "Results" };
const MAX_EDGE = 2400;
let pending = 0;
let dirty = false;

const field = (name) => form.elements.namedItem(name);
const errorEl = (name) => document.getElementById(`${name}-error`);
const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

function setError(name, message) {
  const el = errorEl(name);
  el.innerHTML = message;
  el.hidden = !message;
  const input = field(name);
  if (input && input.type !== "hidden") input.toggleAttribute("aria-invalid", !!message);
}

/** Downscale photos in the browser so uploads are fast and the gallery stays light. */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1048576 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.86));
  return webp && webp.type === "image/webp" ? webp : new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
}

function upload(blob, kind, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?kind=${kind}`);
    xhr.setRequestHeader("content-type", blob.type);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status === 201 ? resolve(xhr.response.data) : reject(new Error(xhr.response?.error?.message ?? "Upload failed.")));
    xhr.onerror = () => reject(new Error("Connection lost."));
    xhr.send(blob);
  });
}

function setupDrop(drop) {
  const kind = drop.dataset.kind;
  const hidden = drop.querySelector('input[type="hidden"]');
  const preview = drop.querySelector(".drop-preview");
  const msg = drop.querySelector(".drop-msg");
  const bar = drop.querySelector(".bar > span");
  const clear = drop.querySelector(".drop-clear");
  const name = hidden.name;
  let last = null;

  const state = (cls, text, progress) => {
    drop.classList.remove("is-uploading", "is-done", "is-error");
    if (cls) drop.classList.add(cls);
    msg.innerHTML = text;
    bar.parentElement.style.setProperty("--p", `${Math.round((progress ?? 0) * 100)}%`);
  };

  async function take(file) {
    if (!file) return;
    last = file;
    const isVideo = kind === "video";
    if (isVideo ? !file.type.startsWith("video/") : !file.type.startsWith("image/")) return state("is-error", isVideo ? "Choose a video file." : "Choose a photo.");
    const max = Number(isVideo ? form.dataset.maxVideo : form.dataset.maxImage);
    if (isVideo && file.size > max) return state("is-error", `That video is ${mb(file.size)}. The limit is ${mb(max)}.`);
    const url = URL.createObjectURL(file);
    preview.innerHTML = isVideo ? `<video src="${url}" muted playsinline preload="metadata"></video>` : `<img src="${url}" alt="">`;
    drop.classList.add("has-file");
    drop.querySelector(".drop-copy strong").textContent = "Replace";
    setError(name, "");
    pending++;
    refresh();
    try {
      state("is-uploading", isVideo ? "Uploading…" : "Preparing…", 0);
      const blob = isVideo ? file : await shrinkImage(file).catch(() => { throw new Error("Can't read this photo. Try a JPG or PNG."); });
      const data = await upload(blob, kind, (p) => state("is-uploading", `Uploading ${Math.round(p * 100)}%`, p));
      hidden.value = data.file;
      dirty = true;
      state("is-done", "Uploaded ✓", 1);
      if (clear) clear.hidden = false;
    } catch (e) {
      state("is-error", `${e.message} <button type="button" class="link-quiet drop-retry">Retry</button>`, 1);
    } finally {
      pending--;
      refresh();
    }
  }

  drop.querySelector(".drop-input").addEventListener("change", (e) => take(e.target.files[0]));
  drop.addEventListener("click", (e) => e.target.closest(".drop-retry") && take(last));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("dragging"); take(e.dataTransfer.files[0]); });
  clear?.addEventListener("click", () => {
    hidden.value = "";
    preview.innerHTML = "";
    drop.classList.remove("has-file");
    drop.querySelector(".drop-copy strong").textContent = "Choose or drop a file";
    clear.hidden = true;
    state("", "");
    dirty = true;
  });
}

function missing() {
  return Object.keys(LABELS).filter((n) => !field(n).value.trim());
}

function refresh() {
  const left = missing();
  const total = Object.keys(LABELS).length;
  saveBtn.disabled = pending > 0;
  checklist.textContent = pending
    ? `Uploading ${pending} file${pending > 1 ? "s" : ""}…`
    : left.length ? `${total - left.length} of ${total} done · Next: ${LABELS[left[0]]}` : "All set. Ready to save.";
  saveBar.querySelector(".bar").style.setProperty("--p", `${((total - left.length) / total) * 100}%`);
}

async function checkTeam() {
  const name = field("teamName").value.trim();
  if (!name) return;
  const except = form.action.match(/\/edit\/([^/?]+)/)?.[1] ?? "";
  try {
    const res = await fetch(`/api/teams?name=${encodeURIComponent(name)}&except=${except}`);
    const { data } = await res.json();
    if (data?.taken) {
      const project = data.projectName.replace(/</g, "&lt;");
      setError("teamName", data.mine
        ? `You already logged “${project}”. <a href="/edit/${data.slug}">Edit it instead →</a>`
        : `This team already logged “${project}”. Choose a different team name.`);
    }
  } catch {}
}

form.querySelectorAll(".drop").forEach(setupDrop);
form.addEventListener("input", (e) => {
  dirty = true;
  if (e.target.name) setError(e.target.name, "");
  refresh();
});
field("teamName").addEventListener("blur", checkTeam);
form.addEventListener("submit", (e) => {
  const left = missing();
  if (pending || left.length) {
    e.preventDefault();
    left.forEach((n) => setError(n, `Add your ${LABELS[n].toLowerCase()}.`));
    const first = left[0] && (field(left[0]).type === "hidden" ? form.querySelector(`#${left[0]}-file`) : field(left[0]));
    first?.focus();
    first?.closest(".field")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    return;
  }
  dirty = false;
  saveBar.classList.add("is-saving");
  saveBtn.textContent = "Saving…";
  setTimeout(() => (saveBtn.disabled = true));
});
addEventListener("beforeunload", (e) => dirty && e.preventDefault());
document.querySelector(".delete-form")?.addEventListener("submit", (e) => {
  if (!confirm("Delete this experiment and its uploaded files? This cannot be undone.")) {
    e.preventDefault();
    return;
  }
  dirty = false;
  e.submitter.disabled = true;
  e.submitter.textContent = "Deleting…";
});
refresh();
