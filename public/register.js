// Public member registration. Uses the same fields and rules as the dashboard (member-schema.js),
// without the staff-only ones. Submissions wait for the centre's pastor to approve them.
const S = window.MemberSchema;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Section intros written for the person registering rather than for staff.
const INTROS = {personal: "Tell us who you are and how we can reach you.", campus: "Where you study or work, and the fellowship centre you attend.", fellowship: "Your walk with the fellowship so far.", family: "Who we should contact about you, especially in an emergency."};
const STEPS = S.STEPS.filter((step) => step.fields.length).map((step) => ({...step, intro: INTROS[step.id] || step.intro, fields: step.fields.filter((f) => !f.staffOnly)}));
const FIELDS = STEPS.flatMap((step) => step.fields.filter((f) => f.key));
let ctx = {institutions: [], centres: {}};

function fieldHtml(f) {
  if (f.group) return `<div class="field-group field-wide"><h4>${esc(f.group)}</h4>${f.help ? `<p>${esc(f.help)}</p>` : ""}</div>`;
  const id = `f-${f.key}`, req = f.required ? ` <span class="req" aria-hidden="true">*</span>` : "";
  const common = `id="${id}" name="${f.key}" aria-describedby="${f.help ? `h-${f.key} ` : ""}e-${f.key}"${f.required ? ` aria-required="true"` : ""}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ""}`;
  const options = f.options === "roles" ? S.ROLES : S.optionsOf(f, ctx);
  const text = f.publicLabel || f.label;
  let label = `<label for="${id}">${esc(text)}${req}</label>`, control;
  if (f.type === "choice") {
    label = `<span class="field-label" id="l-${f.key}">${esc(text)}${req}</span>`;
    control = `<div class="choice-group" role="radiogroup" aria-labelledby="l-${f.key}">${options.map((o) => `<label class="choice"><input type="radio" name="${f.key}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>`;
  } else if (f.type === "select") {
    control = `<select ${common}><option value="">${esc(f.placeholder || "Select…")}</option>${options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea ${common} rows="3" maxlength="${f.maxLength || 200}"></textarea>`;
  } else if (f.type === "checkbox") {
    label = ""; control = `<label class="check"><input type="checkbox" ${common}><span>${esc(text)}</span></label>`;
  } else {
    control = `<input type="${f.type || "text"}" ${common}${f.inputmode ? ` inputmode="${f.inputmode}"` : f.type === "tel" ? ` inputmode="tel"` : ""} maxlength="${f.maxLength || 200}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${f.max ? ` max="${f.max()}"` : ""}>`;
  }
  return `<div class="field${f.wide ? " field-wide" : ""}" data-field="${f.key}">${label}${control}${f.help ? `<small class="help" id="h-${f.key}">${esc(f.help)}</small>` : ""}<small class="error" id="e-${f.key}" aria-live="polite"></small></div>`;
}

function readForm() {
  const form = $("#registerForm"), data = {};
  FIELDS.forEach((f) => { const el = form.elements[f.key]; if (el) data[f.key] = f.type === "checkbox" ? el.checked : String(el.value ?? "").trim(); });
  return data;
}
function refreshCentres() {
  const form = $("#registerForm"), select = form.elements.centre;
  const names = ctx.centres[form.elements.institution.value] || [], keep = select.value;
  select.innerHTML = `<option value="">${names.length ? "Select a fellowship centre" : "Choose your institution first"}</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}`;
  select.value = names.includes(keep) ? keep : names.length === 1 ? names[0] : "";
}
// Shows only the member types that suit the chosen institution (e.g. Corpers Fellowship → Corps member).
function updateRoleChoices(form, ctx) {
  const allowed = S.optionsOf(S.FIELDS.find((f) => f.key === "role"), ctx, {institution: form.elements.institution.value});
  form.querySelectorAll('[name="role"]').forEach((input) => {
    const ok = allowed.includes(input.value);
    input.closest("label").hidden = !ok;
    if (!ok && input.checked) input.checked = false;
  });
  if (allowed.length === 1) form.querySelector(`[name="role"][value="${allowed[0]}"]`).checked = true;
}
function applyConditions() {
  updateRoleChoices($("#registerForm"), ctx);
  const data = readForm();
  FIELDS.forEach((f) => { if (f.when) $(`[data-field="${f.key}"]`).hidden = !S.fieldShown(f, data); });
  const form = $("#registerForm"), same = form.elements.kinSameAsParent.checked;
  if (same) { form.elements.kinName.value = form.elements.parentName.value; form.elements.kinPhone.value = form.elements.parentPhone.value; form.elements.kinRelationship.value = form.elements.parentRelationship.value; }
  form.elements.kinName.readOnly = form.elements.kinPhone.readOnly = same;
  form.elements.kinRelationship.disabled = same;
}
function showError(key, message) {
  const wrap = $(`[data-field="${key}"]`) || (key === "consent" ? $("#consentWrap") : null); if (!wrap) return;
  wrap.classList.toggle("has-error", !!message);
  const node = $(`#e-${key}`); if (node) node.textContent = message || "";
}
function validate() {
  const data = readForm(); let first = null;
  FIELDS.forEach((f) => { const message = S.fieldError(f, data, ctx); showError(f.key, message); if (message && !first) first = f.key; });
  const consent = $("#consent").checked;
  showError("consent", consent ? "" : "Please confirm consent before submitting.");
  return first || (consent ? null : "consent");
}
function focusField(key) {
  const el = key === "consent" ? $("#consent") : $("#registerForm").elements[key];
  const target = el?.length && !el.tagName ? el[0] : el;
  target?.scrollIntoView({block: "center"}); target?.focus?.();
}

async function submit(event) {
  event.preventDefault();
  $("#registerError").hidden = true;
  const invalid = validate();
  if (invalid) { focusField(invalid); return; }
  const button = $("#registerSubmit"); button.disabled = true; button.textContent = "Submitting…";
  try {
    const body = {...readForm(), status: "New member", consent: true, website: $("#website").value};
    const res = await fetch("/api/public/register", {method: "POST", headers: {"Content-Type": "application/json", "X-Requested-With": "dlcf"}, body: JSON.stringify(body)});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      Object.entries(data.errors || {}).forEach(([key, message]) => showError(key, message));
      const firstKey = Object.keys(data.errors || {})[0]; if (firstKey) focusField(firstKey);
      throw new Error(data.error || "Something went wrong. Please try again.");
    }
    $("#doneText").textContent = `Your registration has been sent to ${data.centre}${data.institution ? ` (${data.institution})` : ""}. Your pastor will review it and add you to the fellowship directory.`;
    $("#registerForm").hidden = true; $("#registerDone").hidden = false; window.scrollTo({top: 0});
  } catch (error) {
    $("#registerError").textContent = error.message === "Failed to fetch" ? "Can’t reach the server. Check your internet connection and try again." : error.message;
    $("#registerError").hidden = false;
  } finally {
    button.disabled = false; button.textContent = "Submit registration";
  }
}

async function start() {
  try {
    ctx = await (await fetch("/api/public/centres")).json();
  } catch {
    $("#registerBody").innerHTML = `<p class="form-error">Can’t load the fellowship centres. Check your internet connection and reload the page.</p>`; return;
  }
  $("#registerBody").innerHTML = STEPS.map((step) => `<section class="register-section"><h2>${esc(step.heading)}</h2><p class="register-intro">${esc(step.intro)}</p><div class="form-grid">${step.fields.map(fieldHtml).join("")}</div></section>`).join("");
  const form = $("#registerForm");
  form.querySelector('[name="role"][value="Student"]').checked = true;
  refreshCentres(); applyConditions();
  form.addEventListener("change", (event) => {
    if (event.target.name === "institution") refreshCentres();
    applyConditions();
    const f = FIELDS.find((x) => x.key === event.target.name);
    if (f && $(`[data-field="${f.key}"]`)?.classList.contains("has-error")) showError(f.key, S.fieldError(f, readForm(), ctx));
    if (event.target.id === "consent" && event.target.checked) showError("consent", "");
  });
  form.addEventListener("input", (event) => { if (event.target.name?.startsWith("parent")) applyConditions(); });
  form.addEventListener("submit", submit);
}
$("#registerAnother").addEventListener("click", () => window.location.reload());
start();
