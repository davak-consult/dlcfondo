// Public member registration: a guided, step-by-step form. Uses the same fields and rules as the
// dashboard (member-schema.js), without the staff-only ones. Submissions wait for the centre's pastor to approve them.
const S = window.MemberSchema;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// Wording for the person registering rather than for staff.
const COPY = {
  personal: {title: "About you", heading: "Tell us about yourself", intro: "Your name and how we can reach you."},
  campus: {title: "Campus", heading: "Where do you study, work or serve?", intro: "Choose your institution and the fellowship centre you attend."},
  fellowship: {title: "Fellowship", heading: "Your walk with the fellowship", intro: "A few questions about your spiritual life and service."},
  family: {title: "Family", heading: "Family and emergency contact", intro: "Who we should contact about you, especially in an emergency."}
};
const STEPS = S.STEPS.filter((step) => step.fields.length).map((step) => ({...step, ...COPY[step.id], fields: step.fields.filter((f) => !f.staffOnly)}));
const REVIEW = STEPS.length; // index of the review step
const TITLES = [...STEPS.map((s) => s.title), "Review"];
const FIELDS = STEPS.flatMap((step) => step.fields.filter((f) => f.key));
const label = (f) => f.publicLabel || f.label;
let ctx = {institutions: [], centres: {}, kinds: {}};
let current = 0, reached = 0;

// ---- Rendering --------------------------------------------------------------------------
function fieldHtml(f) {
  if (f.group) return `<div class="group"><h3>${esc(f.group)}</h3>${f.help ? `<p>${esc(f.help)}</p>` : ""}</div>`;
  const id = `f-${f.key}`, req = f.required ? `<span class="req" aria-hidden="true">*</span>` : "";
  const described = `${f.help ? `h-${f.key} ` : ""}e-${f.key}`;
  const common = `id="${id}" name="${f.key}" aria-describedby="${described}"${f.required ? ` aria-required="true"` : ""}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ""}`;
  const options = f.options === "roles" ? S.ROLES : S.optionsOf(f, ctx);
  let head = `<label class="label" for="${id}">${esc(label(f))}${req}</label>`, control;
  if (f.type === "choice") {
    head = `<span class="label" id="l-${f.key}">${esc(label(f))}${req}</span>`;
    control = `<div class="choices" role="radiogroup" aria-labelledby="l-${f.key}" aria-describedby="${described}">${options.map((o) => `<label class="choice"><input type="radio" name="${f.key}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>`;
  } else if (f.type === "select") {
    control = `<select class="input" ${common}><option value="">${esc(f.placeholder || "Select…")}</option>${options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea class="input" ${common} rows="3" maxlength="${f.maxLength || 200}"></textarea>`;
  } else if (f.type === "checkbox") {
    head = ""; control = `<label class="switch"><input type="checkbox" ${common}><span class="track"></span><span>${esc(label(f))}</span></label>`;
  } else {
    const mode = f.inputmode ? ` inputmode="${f.inputmode}"` : f.type === "tel" ? ` inputmode="tel"` : "";
    control = `<input class="input" type="${f.type || "text"}" ${common}${mode} maxlength="${f.maxLength || 200}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${f.max ? ` max="${f.max()}"` : ""}>`;
  }
  return `<div class="field${f.wide || f.type === "textarea" ? " wide" : ""}" data-field="${f.key}">${head}${control}${f.help ? `<p class="hint" id="h-${f.key}">${esc(f.help)}</p>` : ""}<p class="error" id="e-${f.key}" aria-live="polite"></p></div>`;
}
const stepHead = (index, heading, intro) => `<header class="step-head"><p class="step-kicker">Step ${index + 1} of ${TITLES.length}</p><h2 tabindex="-1">${esc(heading)}</h2><p>${esc(intro)}</p></header>`;

function render() {
  $("#stepsBody").innerHTML = STEPS.map((step, i) => `<section class="step" data-step="${i}" hidden>${stepHead(i, step.heading, step.intro)}<div class="grid">${step.fields.map(fieldHtml).join("")}</div></section>`).join("")
    + `<section class="step" data-step="${REVIEW}" hidden>${stepHead(REVIEW, "Check your details", "Make sure everything is correct, then submit your registration.")}<div class="review" id="reviewBody"></div>
       <label class="consent" id="consentWrap"><input type="checkbox" id="consent" aria-describedby="e-consent"><span>I agree to DLCF Ondo Region keeping these details for fellowship and pastoral care. Only my centre’s pastor and the regional admin can see them.</span></label><p class="consent-error" id="e-consent">Please tick the box to give your consent.</p></section>`;
  $("#stepList").innerHTML = TITLES.map((title, i) => `<li data-index="${i}"><button type="button" data-goto="${i}"><span class="num"><span>${i + 1}</span></span>${esc(title)}</button></li>`).join("");
}

// ---- Form state ---------------------------------------------------------------------------
function readForm() {
  const form = $("#registerForm"), data = {};
  FIELDS.forEach((f) => { const el = form.elements[f.key]; if (el) data[f.key] = f.type === "checkbox" ? el.checked : String(el.value ?? "").trim(); });
  return data;
}
function refreshCentres() {
  const form = $("#registerForm"), select = form.elements.centre;
  const names = ctx.centres[form.elements.institution.value] || [], keep = select.value;
  select.innerHTML = `<option value="">${names.length ? "Select your fellowship centre" : "Choose your institution first"}</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}`;
  select.value = names.includes(keep) ? keep : names.length === 1 ? names[0] : "";
}
// Shows only the member types that suit the chosen institution (e.g. Corpers Fellowship → Corps member).
function updateRoleChoices(form) {
  const allowed = S.optionsOf(S.FIELDS.find((f) => f.key === "role"), ctx, {institution: form.elements.institution.value});
  form.querySelectorAll('[name="role"]').forEach((input) => {
    const ok = allowed.includes(input.value);
    input.closest("label").hidden = !ok;
    if (!ok && input.checked) input.checked = false;
  });
  if (allowed.length === 1) form.querySelector(`[name="role"][value="${allowed[0]}"]`).checked = true;
}
function applyConditions() {
  const form = $("#registerForm");
  updateRoleChoices(form);
  const data = readForm();
  FIELDS.forEach((f) => { if (f.when) $(`[data-field="${f.key}"]`).hidden = !S.fieldShown(f, data); });
  const same = form.elements.kinSameAsParent.checked;
  if (same) { form.elements.kinName.value = form.elements.parentName.value; form.elements.kinPhone.value = form.elements.parentPhone.value; form.elements.kinRelationship.value = form.elements.parentRelationship.value; }
  form.elements.kinName.readOnly = form.elements.kinPhone.readOnly = same;
  form.elements.kinRelationship.disabled = same;
}

// ---- Validation ---------------------------------------------------------------------------
function showError(key, message) {
  const wrap = $(`[data-field="${key}"]`); if (!wrap) return;
  wrap.classList.toggle("invalid", !!message);
  $(`#e-${key}`).textContent = message || "";
  wrap.querySelectorAll("input, select, textarea").forEach((el) => { if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid"); });
}
// Validates one step; returns the first field with a problem, or null.
function validateStep(index) {
  const data = readForm(); let first = null;
  STEPS[index].fields.filter((f) => f.key).forEach((f) => { const message = S.fieldError(f, data, ctx); showError(f.key, message); if (message && !first) first = f.key; });
  return first;
}
function focusField(key) {
  const el = $("#registerForm").elements[key];
  const target = el && !el.tagName ? el[0] : el;
  target?.closest(".field")?.scrollIntoView({block: "center", behavior: "smooth"});
  target?.focus({preventScroll: true});
}

// ---- Steps --------------------------------------------------------------------------------
function goTo(index) {
  current = index; reached = Math.max(reached, index);
  $$(".step").forEach((section) => { section.hidden = Number(section.dataset.step) !== index; });
  $$("#stepList li").forEach((li) => {
    const i = Number(li.dataset.index);
    li.className = i === index ? "current" : i <= reached ? "complete" : "";
    li.querySelector("button").disabled = i > reached;
    if (i === index) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  $("#progressBar").style.width = `${((index + 1) / TITLES.length) * 100}%`;
  $("#mobileStep").textContent = `Step ${index + 1} of ${TITLES.length} · ${TITLES[index]}`;
  $("#backButton").hidden = index === 0;
  $("#nextButton").textContent = index === REVIEW ? "Submit registration" : "Continue";
  $("#registerError").hidden = true;
  if (index === REVIEW) renderReview();
  window.scrollTo({top: 0, behavior: "smooth"});
  $(`.step[data-step="${index}"] h2`).focus({preventScroll: true});
}
function display(f, value) {
  if (f.type === "checkbox") return value ? "Yes" : "";
  if (f.type === "date" && value) return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"});
  return value;
}
function renderReview() {
  const data = readForm();
  $("#reviewBody").innerHTML = STEPS.map((step, i) => {
    const rows = step.fields.filter((f) => f.key && S.fieldShown(f, data) && display(f, data[f.key])).map((f) => `<dt>${esc(label(f))}</dt><dd>${esc(display(f, data[f.key]))}</dd>`).join("");
    return `<article class="review-card"><header><h3>${esc(step.title)}</h3><button type="button" class="link-button" data-goto="${i}">Edit</button></header><dl>${rows}</dl></article>`;
  }).join("");
}

async function next(event) {
  event.preventDefault();
  if (current < REVIEW) {
    const invalid = validateStep(current);
    if (invalid) { focusField(invalid); return; }
    goTo(current + 1);
    return;
  }
  // Review: re-check every step, then consent, then submit.
  for (let i = 0; i < REVIEW; i++) { const invalid = validateStep(i); if (invalid) { goTo(i); focusField(invalid); return; } }
  const consent = $("#consent").checked;
  $("#consentWrap").classList.toggle("invalid", !consent);
  if (!consent) { $("#consent").focus(); return; }
  await submit();
}

async function submit() {
  const button = $("#nextButton"); button.disabled = true; button.textContent = "Submitting…";
  $("#registerError").hidden = true;
  try {
    const body = {...readForm(), status: "New member", consent: true, website: $("#website").value};
    const res = await fetch("/api/public/register", {method: "POST", headers: {"Content-Type": "application/json", "X-Requested-With": "dlcf"}, body: JSON.stringify(body)});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const keys = Object.keys(data.errors || {});
      keys.forEach((key) => showError(key, data.errors[key]));
      const step = STEPS.findIndex((s) => s.fields.some((f) => keys.includes(f.key)));
      if (step > -1) { goTo(step); focusField(keys.find((k) => STEPS[step].fields.some((f) => f.key === k))); }
      throw new Error(data.error || "Something went wrong. Please try again.");
    }
    $("#doneText").textContent = `Your registration has been sent to ${data.centre}${data.institution ? `, ${data.institution}` : ""}. Your pastor will review it and add you to the fellowship directory.`;
    $("#registerForm").hidden = true; $(".progress").hidden = true; $("#done").hidden = false;
    $$("#stepList li").forEach((li) => { li.className = "complete"; li.querySelector("button").disabled = true; });
    $("#mobileStep").textContent = "Registration sent";
    window.scrollTo({top: 0});
  } catch (error) {
    $("#registerError").textContent = error.message === "Failed to fetch" ? "Can’t reach the server. Check your internet connection and try again." : error.message;
    $("#registerError").hidden = false;
  } finally {
    button.disabled = false; button.textContent = current === REVIEW ? "Submit registration" : "Continue";
  }
}

// ---- Start --------------------------------------------------------------------------------
async function start() {
  try {
    const res = await fetch("/api/public/centres");
    if (!res.ok) throw new Error();
    ctx = await res.json();
  } catch {
    $("#stepsBody").innerHTML = `<p class="alert">Can’t load the fellowship centres. Check your internet connection and reload the page.</p>`;
    $(".actions").hidden = true;
    return;
  }
  render();
  const form = $("#registerForm");
  form.elements.institution.querySelector("option").textContent = "Select your institution or fellowship";
  refreshCentres(); applyConditions(); goTo(0);
  form.addEventListener("change", (event) => {
    if (event.target.name === "institution") refreshCentres();
    applyConditions();
    const f = FIELDS.find((x) => x.key === event.target.name);
    if (f && $(`[data-field="${f.key}"]`)?.classList.contains("invalid")) showError(f.key, S.fieldError(f, readForm(), ctx));
    if (event.target.id === "consent" && event.target.checked) $("#consentWrap").classList.remove("invalid");
  });
  form.addEventListener("input", (event) => {
    if (event.target.name?.startsWith("parent")) applyConditions();
    const f = FIELDS.find((x) => x.key === event.target.name);
    if (f && $(`[data-field="${f.key}"]`)?.classList.contains("invalid")) showError(f.key, S.fieldError(f, readForm(), ctx));
  });
  form.addEventListener("submit", next);
  $("#backButton").addEventListener("click", () => goTo(current - 1));
  document.addEventListener("click", (event) => { const target = event.target.closest("[data-goto]"); if (target && !target.disabled) goTo(Number(target.dataset.goto)); });
}
$("#registerAnother").addEventListener("click", () => window.location.reload());
start();
