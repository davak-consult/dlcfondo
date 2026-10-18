const S = window.MemberSchema, A = window.AuditActions;
const {STEPS, FIELDS} = S;
const REVIEW = STEPS.length - 1;
const PAGE = 50;
const tones = ["sage", "lilac", "peach", "butter", "blue", "rose"];
const CENTRE_DOTS = {adeyemi: "green", unimed: "violet", wesley: "amber"};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (n) => Number(n || 0).toLocaleString("en-NG");
const pct = (part, total) => total ? Math.round(part / total * 100) : 0;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const formatTime = (iso) => new Date(iso).toLocaleString("en-GB", {day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"});

const state = {user: null, centres: [], stats: null, view: "Overview", centreFilter: "", membersShown: PAGE, auditShown: PAGE, openMember: null, idleMinutes: 30, lastActivity: Date.now()};
const isAdmin = () => state.user?.role === "regional_admin";
const allowedCentres = () => isAdmin() ? state.centres : state.centres.filter((c) => c.id === state.user.centreId);
// What the member form may offer this user: institutions, and the centres under each.
function formCtx() {
  const ctx = {institutions: [], centres: {}};
  allowedCentres().forEach((c) => { if (!ctx.centres[c.institution]) { ctx.institutions.push(c.institution); ctx.centres[c.institution] = []; } ctx.centres[c.institution].push(c.name); });
  return ctx;
}
const dotFor = (centre) => CENTRE_DOTS[centre?.institutionCode] || "green";
// <option>s for every centre, grouped under its institution.
function centreOptions(placeholder) {
  const groups = [];
  state.centres.forEach((c) => { let g = groups.find((x) => x.name === c.institution); if (!g) groups.push(g = {name: c.institution, centres: []}); g.centres.push(c); });
  return `<option value="">${esc(placeholder)}</option>${groups.map((g) => `<optgroup label="${esc(g.name)}">${g.centres.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}`;
}
const plural = (n, word) => `${fmt(n)} ${word}${Number(n) === 1 ? "" : "s"}`;
const centreLabel = (c) => c ? `${c.name} · ${c.institutionShort}` : "";
const toneFor = (id) => tones[Number(id) % tones.length];

// ---- API ---------------------------------------------------------------------
class ApiError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; } }
async function api(path, {method = "GET", body} = {}) {
  let res;
  try {
    res = await fetch(path, {method, credentials: "same-origin", headers: {"X-Requested-With": "dlcf", ...(body !== undefined ? {"Content-Type": "application/json"} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
  } catch {
    throw new ApiError(0, "Can’t reach the server. Check your internet connection and try again.");
  }
  state.lastActivity = Date.now();
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch {} }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) { if (state.user) showLogin("Your session has ended. Please sign in again."); throw new ApiError(401, "Please sign in.", data); }
  if (res.status === 403 && data?.code === "PASSWORD_CHANGE_REQUIRED") { showPasswordScreen(true); throw new ApiError(403, data.error, data); }
  if (!res.ok) throw new ApiError(res.status, data?.error || "Something went wrong. Please try again.", data);
  return data;
}
// Runs an async handler and turns failures into a friendly message.
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.data?.code === "PASSWORD_CHANGE_REQUIRED")) return;
    toast(error.message || "Something went wrong.");
    if (!(error instanceof ApiError)) console.error(error);
  }
};
const track = (action, extra = {}) => api("/api/events", {method: "POST", body: {action, ...extra}}).catch(() => {});

// ---- Screens ---------------------------------------------------------------------
function showOnly(id) {
  ["#boot", "#loginScreen", "#passwordScreen", "#appShell"].forEach((s) => { $(s).hidden = s !== id; });
}
function showLogin(notice = "") {
  state.user = null;
  closeModals(true);
  showOnly("#loginScreen");
  $("#loginNotice").textContent = notice; $("#loginNotice").hidden = !notice;
  $("#loginError").hidden = true;
  $("#loginPassword").value = "";
  setTimeout(() => ($("#loginEmail").value ? $("#loginPassword") : $("#loginEmail")).focus());
}
function showPasswordScreen(forced) {
  closeModals(true);
  showOnly("#passwordScreen");
  $("#passwordForm").reset();
  $("#passwordForm").dataset.forced = forced ? "1" : "";
  $("#passwordTitle").textContent = forced ? "Choose a new password" : "Change your password";
  $("#passwordIntro").textContent = forced ? "You signed in with a temporary password. Choose your own to continue." : "You’ll stay signed in here; other devices will be signed out.";
  $("#passwordCancel").textContent = forced ? "Sign out" : "Cancel";
  ["currentPassword", "newPassword", "confirmPassword"].forEach((k) => setError(`#e-${k}`, ""));
  setTimeout(() => $("#currentPassword").focus());
}
function setError(selector, message) {
  const node = $(selector); node.textContent = message;
  node.closest(".field")?.classList.toggle("has-error", !!message);
}

async function boot() {
  $("#todayLabel").textContent = new Date().toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "long", year: "numeric"}).toUpperCase().replace(",", "");
  try {
    const me = await api("/api/auth/me");
    startApp(me.user, me.centres, me.session);
  } catch (error) {
    if (error.data?.code === "PASSWORD_CHANGE_REQUIRED") return;
    showLogin(error.status === 0 ? error.message : "");
  }
}
function startApp(user, centres, session) {
  state.user = user; state.centres = centres;
  if (session?.idleMinutes) state.idleMinutes = session.idleMinutes;
  if (user.mustChangePassword) return showPasswordScreen(true);
  showOnly("#appShell");
  const initials = user.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  $("#profileInitials").textContent = initials; $("#topInitials").textContent = initials;
  $("#profileName").textContent = user.fullName;
  $("#profileScope").textContent = isAdmin() ? "Regional admin · All centres" : `Campus pastor · ${user.centreName}`;
  $("#userChip").textContent = isAdmin() ? "Regional admin" : user.centreName;
  $$(".admin-only").forEach((node) => { node.hidden = !isAdmin(); });
  $("#scopeBanner").hidden = isAdmin();
  $("#scopeText").innerHTML = `<strong>${esc(user.centreName)}</strong> · You can see and add members of this centre only.`;
  $("#schoolFilter").innerHTML = centreOptions("All centres");
  $("#centresLabel").textContent = isAdmin() ? "YOUR CENTRES" : "YOUR CENTRE";
  // Nothing from a previous user's session (searches, filters, open records) carries over.
  ["#searchBox", "#auditSearch", "#auditCategory", "#auditActor", "#auditFrom", "#auditTo"].forEach((s) => { $(s).value = ""; });
  $("#auditIntegrity").innerHTML = "";
  Object.assign(state, {view: "", centreFilter: "", membersShown: PAGE, auditShown: PAGE, stats: null, openMember: null});
  showView("Overview");
}

// ---- Rendering helpers -------------------------------------------------------------
function statusClass(status) { return status === "Active" ? "status-active" : status === "New member" ? "status-new" : "status-inactive"; }
function rowMarkup(m) {
  const centre = state.centres.find((c) => c.id === m.centreId);
  return `<tr data-person="${m.id}" tabindex="0"><td><div class="member-cell"><div class="avatar ${toneFor(m.id)}">${esc(m.initials)}</div><span><strong>${esc(m.name)}</strong><small>${esc(m.levelLabel || m.role)} · ${esc(m.institution.split(" ").slice(0, 2).join(" "))}</small></span></div></td><td><span class="type-badge ${m.role === "Staff" ? "type-staff" : "type-student"}">${m.role === "Staff" ? "▤ Staff" : "♙ Student"}</span></td><td><span class="centre-name"><i class="centre-dot ${dotFor(centre)}"></i>${esc(m.centre)}</span></td><td class="course-cell">${esc(m.course)}</td><td><span class="status-badge ${statusClass(m.status)}"><i></i>${esc(m.status)}</span></td><td><button class="row-more" aria-label="View ${esc(m.name)}">•••</button></td></tr>`;
}
function bindRows(container) {
  container.querySelectorAll("[data-person]").forEach((row) => {
    row.onclick = () => openMember(Number(row.dataset.person));
    row.onkeydown = (event) => { if (event.key === "Enter") openMember(Number(row.dataset.person)); };
  });
}

async function loadStats() {
  const stats = state.stats = await api("/api/members/stats");
  $("#totalMembers").textContent = fmt(stats.total);
  $("#chartTotal").textContent = fmt(stats.total);
  $("#studentCount").textContent = fmt(stats.students);
  $("#studentShare").textContent = `${pct(stats.students, stats.total)}% of all members`;
  $("#staffCount").textContent = fmt(stats.staff);
  $("#centreCount").textContent = fmt(stats.centres.length);
  $("#pendingCount").textContent = fmt(stats.pending); $("#pendingCount").hidden = !stats.pending;
  $("#navCount").textContent = stats.total >= 1000 ? `${(stats.total / 1000).toFixed(1)}k` : fmt(stats.total);
  $("#totalScope").textContent = isAdmin() ? "Across your fellowship" : `At ${state.user.centreName}`;
  $("#sidebarCentres").innerHTML = stats.centres.map((c) => `<button class="centre-link" data-centre="${c.id}"><i class="centre-dot ${dotFor(c)}"></i><span>${esc(c.name)}</span><small>${fmt(c.total)}</small></button>`).join("");
  $("#centreList").innerHTML = stats.centres.map((c) => `<button class="centre-row" data-centre="${c.id}"><i class="centre-dot ${dotFor(c)}"></i><span class="centre-row-copy"><strong>${esc(c.name)}</strong><small>${esc(c.institution)}</small><span class="mini-bar"><i class="${dotFor(c)}" style="width:${pct(c.total, stats.total)}%"></i></span></span><span class="centre-total"><strong>${fmt(c.total)}</strong><small>${pct(c.total, stats.total)}%</small></span><b class="row-chevron">›</b></button>`).join("");
  renderCentresView();
  $$("[data-centre]").forEach((button) => { button.onclick = () => openCentre(Number(button.dataset.centre)); });
  renderChart(stats.monthly);
}
function renderChart(monthly) {
  const totals = monthly.map((m) => m.total);
  const empty = !Math.max(0, ...totals);
  $("#chartEmpty").hidden = !empty; $("#chartArea").hidden = empty;
  if (empty) return;
  const step = Math.max(1, Math.ceil(Math.max(...totals) / 3));
  const points = totals.map((t, i) => [i * 680 / (totals.length - 1), 160 - t / (step * 3) * 150]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  $("#growthChart").innerHTML = `<defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3e4095" stop-opacity=".16"/><stop offset="100%" stop-color="#3e4095" stop-opacity="0"/></linearGradient></defs><path d="${line} V170 H0Z" fill="url(#chartFill)"/><path d="${line}" fill="none" stroke="#3e4095" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${lx}" cy="${ly}" r="5" fill="#fff" stroke="#3e4095" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  $("#chartY").innerHTML = [3, 2, 1, 0].map((k) => `<span>${fmt(step * k)}</span>`).join("");
  $("#chartX").innerHTML = monthly.map((m) => `<span>${new Date(`${m.month}-01T00:00:00`).toLocaleString("en-GB", {month: "short"})}</span>`).join("");
}
async function loadRecent() {
  const {items} = await api("/api/members?limit=4");
  $("#memberRows").innerHTML = items.map(rowMarkup).join("");
  $("#emptyState").hidden = items.length > 0;
  bindRows($("#memberRows"));
}

// ---- Members directory ----------------------------------------------------------------
let memberRequest = 0;
async function loadMembers({logFilter = false} = {}) {
  const ticket = ++memberRequest;
  const params = new URLSearchParams({limit: String(state.membersShown)});
  const q = $("#searchBox").value.trim();
  if (q) params.set("q", q);
  if (isAdmin() && state.centreFilter) params.set("centreId", state.centreFilter);
  if (logFilter) params.set("logFilter", "1");
  const {items, total} = await api(`/api/members?${params}`);
  if (ticket !== memberRequest) return; // a newer search has started
  $("#allRows").innerHTML = items.map(rowMarkup).join("");
  bindRows($("#allRows"));
  const filtered = q || state.centreFilter;
  $("#emptyDirectory").hidden = items.length > 0;
  $("#emptyDirectoryTitle").textContent = filtered ? "No members match this search" : "No members yet";
  $("#emptyDirectoryText").textContent = filtered ? "Try another name, programme or centre." : "Use “Add a member” to create the first record.";
  $("#resultShown").textContent = fmt(items.length);
  $("#resultCount").textContent = fmt(total);
  $("#membersMore").hidden = items.length >= total;
  const centre = state.centres.find((c) => String(c.id) === String(state.centreFilter));
  $("#directoryTitle").textContent = !isAdmin() ? `${state.user.centreName} members` : centre ? `${centre.name} members` : "All members";
}
function openCentre(id) {
  state.centreFilter = isAdmin() ? String(id) : "";
  $("#schoolFilter").value = state.centreFilter;
  state.membersShown = PAGE;
  showView("Members", {logFilter: isAdmin()});
}

// ---- Views ------------------------------------------------------------------------
function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; }
const VIEWS = {"Overview": "#overviewView", "Members": "#directoryView", "Registrations": "#registrationsView", "Fellowship centres": "#centresView", "Reports": "#reportsView", "Users": "#usersView", "Audit log": "#auditView"};
const showView = guard(async (view, {logFilter = false} = {}) => {
  if ((view === "Users" || view === "Audit log") && !isAdmin()) return;
  const changed = view !== state.view;
  state.view = view;
  $("#crumb").textContent = view;
  $("#pageTitle").textContent = view === "Overview" ? `${greeting()}, ${state.user.fullName.split(" ")[0]}` : view;
  const subtitles = {"Overview": isAdmin() ? "Here’s what’s happening across your fellowship centres." : `Here’s what’s happening at ${state.user.centreName}.`, "Members": "Browse member information within your authorised access.", "Registrations": isAdmin() ? "Approve people who registered online for any fellowship centre." : `Approve people who registered online for ${state.user.centreName}.`, "Fellowship centres": "Your fellowship centres and their membership.", "Reports": "Download membership reports as CSV files.", "Users": "Manage who can sign in and what they can see.", "Audit log": "A tamper-evident record of every action taken on this system."};
  $("#subtitle").textContent = subtitles[view];
  Object.entries(VIEWS).forEach(([name, selector]) => { $(selector).hidden = name !== view; });
  $(".heading-actions").hidden = view === "Users" || view === "Audit log";
  $$(".nav-item").forEach((button) => button.classList.toggle("nav-active", button.dataset.view === view));
  closeMenu();
  if (changed) { window.scrollTo({top: 0}); if (view !== "Audit log") track("nav.view", {view}); }
  if (view === "Overview") await Promise.all([loadStats(), loadRecent()]);
  if (view === "Members") await Promise.all([loadMembers({logFilter}), state.stats ? null : loadStats()]);
  if (view === "Fellowship centres") await Promise.all([loadStats(), isAdmin() ? loadCentres() : null]);
  if (view === "Users") await loadUsers();
  if (view === "Registrations") await Promise.all([loadRegistrations(), loadStats()]);
  if (view === "Audit log") { state.auditShown = PAGE; await loadAuditMeta(); await loadAudit({open: changed}); }
});
async function refreshData() {
  await loadStats();
  if (state.view === "Overview") await loadRecent();
  if (state.view === "Members") await loadMembers();
}

// ---- Member profile ----------------------------------------------------------------
function displayValue(f, value) {
  if (!value) return "";
  if (f.type === "date") return new Date(value + "T00:00").toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"});
  return value;
}
function detailSections(data) {
  return STEPS.slice(0, REVIEW).map((step, index) => ({index, heading: step.heading, rows: step.fields.filter((f) => f.key && f.type !== "checkbox" && S.fieldShown(f, data)).map((f) => ({f, label: S.groupLabel(f), value: displayValue(f, data[f.key])}))}));
}
const openMember = guard(async (id) => {
  const member = await api(`/api/members/${id}`);
  closeModals(true);
  state.openMember = member;
  $("#profileAvatar").className = `avatar avatar-large ${toneFor(member.id)}`;
  $("#profileAvatar").textContent = member.initials;
  $("#profileTitle").textContent = member.name;
  $("#profileRole").textContent = `${member.role} · ${member.course} · ${member.centre}`;
  $("#profileStatus").className = `status-badge ${statusClass(member.status)}`;
  $("#profileStatus").innerHTML = `<i></i>${esc(member.status)}`;
  $("#profileBody").innerHTML = detailSections(member).map((section) => {
    const filled = section.rows.filter((row) => row.value && !["firstName", "surname", "otherNames"].includes(row.f.key));
    return filled.length ? `<div class="profile-section"><h3>${esc(section.heading)}</h3><div class="detail-grid">${filled.map((row) => `<div class="detail-cell${row.f.wide || row.f.type === "textarea" ? " wide" : ""}"><small>${esc(row.label)}</small><strong>${esc(row.value)}</strong></div>`).join("")}</div></div>` : "";
  }).join("");
  $("#profileUpdated").textContent = `Last updated ${formatTime(member.updatedAt)}`;
  $("#profileActivity").innerHTML = "";
  $("#modalBackdrop").hidden = false;
  $("#closeModal").focus();
  const {items} = await api(`/api/members/${id}/history`);
  if (state.openMember?.id !== id) return;
  $("#profileActivity").innerHTML = items.length ? `<div class="member-activity"><h3>Change history</h3><ol>${items.slice(0, 8).map((e) => `<li><time datetime="${e.ts}">${esc(formatTime(e.ts))}</time><span>${esc(A.describe(e))} · ${esc(e.actor_name || "System")}</span></li>`).join("")}</ol></div>` : "";
});
const removeMember = guard(async () => {
  const member = state.openMember; if (!member) return;
  if (!confirm(`Remove ${member.name}? They will no longer appear in the directory. The removal is recorded in the audit log.`)) return;
  await api(`/api/members/${member.id}`, {method: "DELETE"});
  closeModals(true);
  toast(`${member.name} was removed.`);
  await refreshData();
});

// ---- Member form (wizard) ---------------------------------------------------------------
const wiz = {step: 0, reached: 0, mode: "add", member: null, dirty: false, saving: false};
// Fields that show or hide other fields (e.g. member type, worker), so changes to them re-check the form.
const CONDITION_KEYS = new Set(FIELDS.flatMap((f) => Object.keys(f.when || {})));
function fieldHtml(f) {
  if (f.group) return `<div class="field-group field-wide"><h4>${esc(f.group)}</h4>${f.help ? `<p>${esc(f.help)}</p>` : ""}</div>`;
  const id = `f-${f.key}`;
  const describedBy = [f.help && `h-${f.key}`, `e-${f.key}`].filter(Boolean).join(" ");
  const req = f.required ? ` <span class="req" aria-hidden="true">*</span>` : "";
  const common = `id="${id}" name="${f.key}" aria-describedby="${describedBy}"${f.required ? ` aria-required="true"` : ""}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ""}`;
  let label = `<label for="${id}">${esc(f.label)}${req}</label>`;
  let control;
  const options = S.optionsOf(f, formCtx());
  if (f.type === "choice") {
    label = `<span class="field-label" id="l-${f.key}">${esc(f.label)}${req}</span>`;
    control = `<div class="choice-group" role="radiogroup" aria-labelledby="l-${f.key}" aria-describedby="${describedBy}">${options.map((o) => `<label class="choice"><input type="radio" name="${f.key}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>`;
  } else if (f.type === "select") {
    control = `<select ${common}><option value="">${esc(f.placeholder || "Select…")}</option>${options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea ${common} rows="3" maxlength="${f.maxLength || 200}"></textarea>`;
  } else if (f.type === "checkbox") {
    label = ""; control = `<label class="check"><input type="checkbox" ${common}><span>${esc(f.label)}</span></label>`;
  } else {
    control = `<input type="${f.type || "text"}" ${common}${f.inputmode ? ` inputmode="${f.inputmode}"` : f.type === "tel" ? ` inputmode="tel"` : ""} maxlength="${f.maxLength || 200}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${f.max ? ` max="${f.max()}"` : ""}>`;
  }
  return `<div class="field${f.wide ? " field-wide" : ""}" data-field="${f.key}">${label}${control}${f.help ? `<small class="help" id="h-${f.key}">${esc(f.help)}</small>` : ""}<small class="error" id="e-${f.key}" aria-live="polite"></small></div>`;
}
function buildForm() {
  $("#wizardBody").innerHTML = STEPS.map((step, index) => `<section class="wizard-step" data-step="${index}" hidden aria-labelledby="sh-${step.id}"><div class="step-intro"><h3 id="sh-${step.id}" tabindex="-1">${esc(step.heading)}</h3><p>${esc(step.intro)}</p>${index < REVIEW && step.fields.some((f) => f.required) ? `<p class="req-note">Fields marked <span class="req">*</span> are required.</p>` : ""}</div>${index === REVIEW ? `<div id="reviewBody"></div>` : `<div class="form-grid">${step.fields.map(fieldHtml).join("")}</div>`}</section>`).join("");
  $("#stepper").innerHTML = STEPS.map((step, index) => `<li><button type="button" class="step-btn" data-goto="${index}" aria-label="Step ${index + 1}: ${esc(step.heading)}"><span class="step-num">${index + 1}</span><span class="step-name">${esc(step.title)}</span></button></li>`).join("");
}
function readForm() {
  const form = $("#memberForm"); const data = {};
  FIELDS.forEach((f) => { const el = form.elements[f.key]; if (!el) return; data[f.key] = f.type === "checkbox" ? el.checked : String(el.value ?? "").trim(); });
  return data;
}
function writeForm(data) {
  const form = $("#memberForm");
  FIELDS.forEach((f) => { const el = form.elements[f.key]; if (!el) return; if (f.key === "centre") refreshCentreOptions(data.centre); else if (f.type === "checkbox") el.checked = !!data[f.key]; else el.value = data[f.key] ?? ""; });
}
// Offers the fellowship centres under the chosen institution, keeping the selection when it still applies.
function refreshCentreOptions(selected) {
  const form = $("#memberForm"), select = form.elements.centre;
  const names = formCtx().centres[form.elements.institution.value] || [];
  const keep = selected ?? select.value;
  select.innerHTML = `<option value="">${names.length ? "Select a fellowship centre" : "Choose the institution first"}</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}`;
  select.value = names.includes(keep) ? keep : names.length === 1 ? names[0] : "";
}
function applyConditions() {
  const data = readForm();
  FIELDS.forEach((f) => { if (f.when) $(`[data-field="${f.key}"]`).hidden = !S.fieldShown(f, data); });
  refreshCentreOptions();
  ["kinName", "kinPhone"].forEach((key) => { $(`#f-${key}`).readOnly = data.kinSameAsParent; });
  $("#f-kinRelationship").disabled = data.kinSameAsParent;
}
function syncKin() {
  const form = $("#memberForm");
  if (!form.elements.kinSameAsParent.checked) return;
  form.elements.kinName.value = form.elements.parentName.value;
  form.elements.kinPhone.value = form.elements.parentPhone.value;
  form.elements.kinRelationship.value = form.elements.parentRelationship.value;
}
const fieldError = (f, data) => S.fieldError(f, data, formCtx());
function showFieldError(key, message) {
  const wrap = $(`[data-field="${key}"]`); if (!wrap) return;
  wrap.classList.toggle("has-error", !!message);
  $(`#e-${key}`).textContent = message;
  wrap.querySelectorAll("input, select, textarea").forEach((el) => { if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid"); });
}
function validateStep(index) {
  if (index === REVIEW) {
    if (wiz.mode === "edit") return true;
    const ok = $("#consent").checked;
    $("#consentWrap").classList.toggle("has-error", !ok);
    $("#e-consent").textContent = ok ? "" : "Please confirm consent before saving.";
    return ok ? true : "consent";
  }
  const data = readForm(); let first = null;
  STEPS[index].fields.filter((f) => f.key).forEach((f) => { const message = fieldError(f, data); showFieldError(f.key, message); if (message && !first) first = f.key; });
  return first || true;
}
function focusField(key) {
  const el = key === "consent" ? $("#consent") : $(`[data-field="${key}"] input, [data-field="${key}"] select, [data-field="${key}"] textarea`);
  el?.focus(); el?.closest(".field, .consent")?.scrollIntoView({block: "center"});
}
function updateStepper() {
  $$(".step-btn").forEach((button) => {
    const index = Number(button.dataset.goto);
    const reachable = wiz.mode === "edit" || index <= wiz.reached;
    const done = index !== wiz.step && (wiz.mode === "edit" || index < wiz.reached);
    button.classList.toggle("current", index === wiz.step);
    button.classList.toggle("done", done);
    button.toggleAttribute("data-reachable", reachable && index !== wiz.step);
    button.setAttribute("aria-current", index === wiz.step ? "step" : "false");
    button.querySelector(".step-num").textContent = done ? "✓" : String(index + 1);
  });
  const last = wiz.step === REVIEW;
  $("#stepCount").textContent = `Step ${wiz.step + 1} of ${STEPS.length} · ${STEPS[wiz.step].heading}`;
  $("#wizBack").textContent = wiz.step === 0 ? "Cancel" : "Back";
  $("#wizNext").textContent = wiz.saving ? "Saving…" : last ? (wiz.mode === "edit" ? "Save changes" : "Save member") : `Continue to ${STEPS[wiz.step + 1].title.toLowerCase()}`;
  $("#wizAnother").hidden = !(last && wiz.mode === "add");
  $("#wizSaveNow").hidden = !(wiz.mode === "edit" && !last);
  ["#wizNext", "#wizAnother", "#wizSaveNow"].forEach((s) => { $(s).disabled = wiz.saving; });
}
function goStep(index, {focus = true} = {}) {
  wiz.step = index; wiz.reached = Math.max(wiz.reached, index);
  $$(".wizard-step").forEach((section) => { section.hidden = Number(section.dataset.step) !== index; });
  if (index === REVIEW) renderReview();
  updateStepper();
  $("#wizardBody").scrollTop = 0;
  if (!focus) return;
  const section = $(`.wizard-step[data-step="${index}"]`);
  const first = index === REVIEW ? section.querySelector("h3") : section.querySelector(".field:not([hidden]) input:not([readonly]), .field:not([hidden]) select:not(:disabled), .field:not([hidden]) textarea");
  first?.focus({preventScroll: true});
}
function renderReview() {
  const data = readForm();
  const cards = detailSections(data).map((section) => `<div class="review-card"><header><h4>${esc(section.heading)}</h4><button type="button" class="text-link" data-goto="${section.index}">Edit</button></header><dl>${section.rows.map((row) => `<div class="${row.f.wide || row.f.type === "textarea" ? "wide" : ""}"><dt>${esc(row.label)}</dt><dd${row.value ? "" : ' class="empty"'}>${esc(row.value || "Not provided")}</dd></div>`).join("")}</dl></div>`).join("");
  const consent = wiz.mode === "add" ? `<div class="consent" id="consentWrap"><label class="check"><input type="checkbox" id="consent" aria-describedby="e-consent"><span>I confirm this member has agreed to DLCF Ondo Region keeping these details for fellowship care and administration. <span class="req">*</span></span></label><div class="field"><small class="error" id="e-consent" aria-live="polite"></small></div></div>` : "";
  $("#reviewBody").innerHTML = `<div id="dupeWarning"></div>${cards}${consent}`;
  api("/api/members/duplicates", {method: "POST", body: {phone: data.phone, email: data.email, excludeId: wiz.member?.id}}).then(({matches}) => {
    if (!matches.length || !$("#dupeWarning")) return;
    $("#dupeWarning").innerHTML = `<div class="notice notice-warn" role="status"><span>⚠</span><span><strong>Possible duplicate.</strong> ${matches.map((m) => `${esc(m.name)} (${esc(m.centre)}) has the same ${esc(m.reasons.join(" and "))}`).join("; ")}. Check this isn’t the same person before saving.</span></div>`;
  }).catch(() => {});
}
function openForm(member = null) {
  buildForm();
  Object.assign(wiz, {step: 0, reached: 0, mode: member ? "edit" : "add", member, dirty: false, saving: false});
  $("#formKicker").textContent = member ? "EDIT MEMBER" : "NEW MEMBER";
  $("#formTitle").textContent = member ? member.name : "Add a member";
  const preset = allowedCentres().find((c) => String(c.id) === String(state.centreFilter)) || (allowedCentres().length === 1 ? allowedCentres()[0] : null);
  writeForm(member || {role: "Student", institution: preset?.institution || formCtx().institutions[0], centre: preset?.name, status: "New member"});
  applyConditions();
  closeModals(true);
  $("#formBackdrop").hidden = false;
  goStep(0);
}
const saveFromForm = guard(async ({another = false} = {}) => {
  if (wiz.saving) return;
  for (let index = 0; index < REVIEW; index++) {
    const result = validateStep(index);
    if (result !== true) { goStep(index, {focus: false}); validateStep(index); focusField(result); toast(`Some details in “${STEPS[index].heading}” need attention.`); return; }
  }
  if (wiz.step === REVIEW) { const result = validateStep(REVIEW); if (result !== true) { focusField(result); return; } }
  const data = readForm();
  wiz.saving = true; updateStepper();
  let saved;
  try {
    saved = wiz.mode === "edit"
      ? await api(`/api/members/${wiz.member.id}`, {method: "PUT", body: {...data, updatedAt: wiz.member.updatedAt}})
      : await api("/api/members", {method: "POST", body: data});
  } catch (error) {
    wiz.saving = false; updateStepper();
    if (error.status === 400 && error.data.errors) {
      const keys = Object.keys(error.data.errors);
      const step = STEPS.findIndex((s) => s.fields.some((f) => keys.includes(f.key)));
      if (step > -1) { goStep(step, {focus: false}); keys.forEach((k) => showFieldError(k, error.data.errors[k])); focusField(keys.find((k) => STEPS[step].fields.some((f) => f.key === k))); }
    }
    throw error;
  }
  wiz.saving = false; wiz.dirty = false;
  await refreshData();
  if (another) {
    const keep = {role: data.role, institution: data.institution, centre: data.centre};
    openForm(); writeForm({...keep, status: "New member"}); applyConditions();
    toast(`${saved.name} saved. Ready for the next member.`);
    return;
  }
  closeModals(true);
  toast(wiz.mode === "edit" ? `${saved.name}’s details were updated.` : `${saved.name} was added to ${saved.centre}.`);
  if (wiz.mode === "edit") openMember(saved.id);
});
function onFormSubmit(event) {
  event.preventDefault();
  if (wiz.step === REVIEW) { saveFromForm(); return; }
  const result = validateStep(wiz.step);
  if (result !== true) { focusField(result); return; }
  goStep(wiz.step + 1);
}
function onFormInput(event) {
  const target = event.target;
  if (target.id === "consent") { if (target.checked) { $("#consentWrap").classList.remove("has-error"); $("#e-consent").textContent = ""; } return; }
  wiz.dirty = true;
  if (target.name === "kinSameAsParent" || target.name?.startsWith("parent")) syncKin();
  if (CONDITION_KEYS.has(target.name) || target.name === "kinSameAsParent" || target.name === "institution") applyConditions();
  const f = FIELDS.find((item) => item.key === target.name);
  if (f && target.closest(".field")?.classList.contains("has-error")) showFieldError(f.key, fieldError(f, readForm()));
  if (target.name === "kinSameAsParent" && target.checked) ["kinName", "kinPhone", "kinRelationship"].forEach((key) => showFieldError(key, ""));
}
function onFormBlur(event) {
  const target = event.target;
  const f = FIELDS.find((item) => item.key === target.name); if (!f) return;
  if (f.type === "tel" && target.value) { target.value = S.formatPhone(target.value); syncKin(); }
  if (target.type === "text" || target.type === "email") target.value = target.value.replace(/\s+/g, " ").trim();
  if (target.value) showFieldError(f.key, fieldError(f, readForm()));
}
function onStepClick(event) {
  const button = event.target.closest("[data-goto]"); if (!button) return;
  const index = Number(button.dataset.goto);
  if (index === wiz.step || (wiz.mode === "add" && index > wiz.reached)) return;
  if (index > wiz.step && wiz.mode === "add") { for (let i = wiz.step; i < index; i++) { const result = validateStep(i); if (result !== true) { goStep(i); focusField(result); return; } } }
  goStep(index);
}

// ---- Registrations awaiting approval ------------------------------------------------------
let registrations = [];
async function loadRegistrations() {
  ({items: registrations} = await api("/api/members/pending"));
  $("#registrationRows").innerHTML = registrations.map((m) => `<tr data-registration="${m.id}"><td class="cell-main"><div class="member-cell"><div class="avatar ${toneFor(m.id)}">${esc(m.initials)}</div><span><strong>${esc(m.name)}</strong><small>${esc(m.role === "Staff" ? m.position : `${m.programme} · ${m.level}`)}</small></span></div></td><td data-label="Fellowship centre">${esc(m.centre)}<small class="cell-sub">${esc(state.centres.find((c) => c.id === m.centreId)?.institutionShort || "")}</small></td><td data-label="Phone"><a href="tel:${esc(m.phone.replace(/\s/g, ""))}">${esc(m.phone)}</a></td><td data-label="Registered">${esc(formatTime(m.createdAt))}</td><td class="user-actions"><button class="text-link" data-registration-action="view">View</button><button class="text-link" data-registration-action="approve">Approve</button><button class="text-link danger-link" data-registration-action="reject">Reject</button></td></tr>`).join("");
  $("#registrationsEmpty").hidden = registrations.length > 0;
}
const registrationAction = guard(async (event) => {
  const button = event.target.closest("[data-registration-action]"); if (!button) return;
  const member = registrations.find((m) => m.id === Number(button.closest("[data-registration]").dataset.registration));
  const action = button.dataset.registrationAction;
  if (action === "view") return openMember(member.id);
  let body;
  if (action === "approve" && !confirm(`Approve ${member.name} as a member of ${member.centre}?`)) return;
  if (action === "reject") {
    const reason = prompt(`Reject the registration of ${member.name}? It will be removed from this list. You can add a reason for the audit log (optional):`, "");
    if (reason === null) return;
    body = {reason};
  }
  await api(`/api/members/${member.id}/${action}`, {method: "POST", body});
  await Promise.all([loadRegistrations(), loadStats()]);
  toast(action === "approve" ? `${member.name} is now a member of ${member.centre}.` : `The registration of ${member.name} was rejected.`);
});
$("#registrationRows").addEventListener("click", registrationAction);
$("#copyRegisterLink").addEventListener("click", async () => {
  const link = `${window.location.origin}/register`;
  try { await navigator.clipboard.writeText(link); toast(`Copied ${link}`); } catch { prompt("Copy this link:", link); }
});

// ---- Fellowship centres ---------------------------------------------------------------------
let centreAdmin = null; // {institutions, centres with member/pastor counts}, loaded for the regional admin
let editingCentre = null;
async function loadCentres() {
  centreAdmin = await api("/api/centres");
  state.centres = centreAdmin.centres.map(({members, pastors, ...c}) => c);
  $("#schoolFilter").innerHTML = centreOptions("All centres"); $("#schoolFilter").value = state.centreFilter;
  renderCentresView();
}
function renderCentresView() {
  const stats = state.stats; if (!stats) return;
  const statFor = (id) => stats.centres.find((c) => c.id === id) || {total: 0, staff: 0};
  const institutions = isAdmin() && centreAdmin ? centreAdmin.institutions
    : [...new Map(allowedCentres().map((c) => [c.institutionId, {id: c.institutionId, name: c.institution, shortName: c.institutionShort, code: c.institutionCode}])).values()];
  $("#centresView").innerHTML = institutions.map((inst) => {
    const list = allowedCentres().filter((c) => c.institutionId === inst.id);
    const total = list.reduce((sum, c) => sum + statFor(c.id).total, 0);
    const cards = list.map((c, i) => {
      const s = statFor(c.id), pastors = centreAdmin?.centres.find((x) => x.id === c.id)?.pastors;
      return `<div class="centre-detail-card"><div class="centre-card-icon tone-${i % 3}">▤</div><span class="centre-card-count">${plural(s.total, "member")}</span><h2>${esc(c.name)}</h2><p>${plural(s.total - s.staff, "student")}, ${fmt(s.staff)} staff${pastors !== undefined ? ` · ${pastors ? plural(pastors, "pastor") : "no pastor yet"}` : ""}</p><div class="centre-card-bottom"><button class="text-link" data-centre="${c.id}"><i class="centre-dot ${dotFor(c)}"></i>View members ›</button>${isAdmin() ? `<span class="centre-card-actions"><button class="text-link" data-centre-action="rename" data-id="${c.id}">Rename</button><button class="text-link danger-link" data-centre-action="remove" data-id="${c.id}">Remove</button></span>` : ""}</div></div>`;
    }).join("");
    return `<section class="institution-group"><header class="institution-head"><div><div class="panel-kicker">${esc(inst.shortName)}</div><h2>${esc(inst.name)}</h2><p>${plural(list.length, "fellowship centre")} · ${plural(total, "member")}</p></div>${isAdmin() ? `<button class="button button-secondary" data-add-centre="${inst.id}">＋ Add centre</button>` : ""}</header><div class="centre-cards">${cards || `<p class="institution-empty">No fellowship centres yet.</p>`}</div></section>`;
  }).join("");
  $$("#centresView [data-centre]").forEach((button) => { button.onclick = () => openCentre(Number(button.dataset.centre)); });
}
function openCentreForm({institutionId, centre = null}) {
  editingCentre = centre;
  const form = $("#centreForm"); form.reset();
  $("#centreFormKicker").textContent = centre ? "RENAME FELLOWSHIP CENTRE" : "NEW FELLOWSHIP CENTRE";
  $("#centreFormTitle").textContent = centre ? centre.name : "Add a fellowship centre";
  $("#centreSave").textContent = centre ? "Save name" : "Add centre";
  $("#c-institutionId").innerHTML = (centreAdmin?.institutions || []).map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  form.elements.institutionId.value = centre?.institutionId || institutionId;
  form.elements.institutionId.disabled = !!centre;
  form.elements.name.value = centre?.name || "";
  ["institutionId", "name"].forEach((k) => setError(`#ce-${k}`, ""));
  $("#centreFormError").hidden = true;
  closeModals(true);
  $("#centreBackdrop").hidden = false;
  form.elements.name.focus();
}
const saveCentre = guard(async (event) => {
  event.preventDefault();
  const form = $("#centreForm");
  const body = {name: form.elements.name.value.trim(), institutionId: Number(form.elements.institutionId.value)};
  ["institutionId", "name"].forEach((k) => setError(`#ce-${k}`, ""));
  try {
    const {centre} = editingCentre ? await api(`/api/centres/${editingCentre.id}`, {method: "PATCH", body: {name: body.name}}) : await api("/api/centres", {method: "POST", body});
    closeModals(true);
    await Promise.all([loadCentres(), loadStats()]);
    toast(editingCentre ? `Renamed to ${centre.name}.` : `${centre.name} was added. You can now assign a campus pastor to it under Users.`);
  } catch (error) {
    if (error.data?.errors) Object.entries(error.data.errors).forEach(([k, v]) => setError(`#ce-${k}`, v));
    $("#centreFormError").textContent = error.message; $("#centreFormError").hidden = false;
  }
});
const centreAction = guard(async (event) => {
  const add = event.target.closest("[data-add-centre]");
  if (add) return openCentreForm({institutionId: Number(add.dataset.addCentre)});
  const button = event.target.closest("[data-centre-action]"); if (!button) return;
  const centre = state.centres.find((c) => c.id === Number(button.dataset.id));
  if (button.dataset.centreAction === "rename") return openCentreForm({centre});
  if (!confirm(`Remove ${centre.name} from ${centre.institution}? This is only possible if no members or users have ever been assigned to it.`)) return;
  try { await api(`/api/centres/${centre.id}`, {method: "DELETE"}); }
  catch (error) { if (error.status === 409) return toast(error.message); throw error; }
  await Promise.all([loadCentres(), loadStats()]);
  toast(`${centre.name} was removed.`);
});

// ---- Users (regional admin) ---------------------------------------------------------------
const ROLE_LABELS = {regional_admin: "Regional admin", campus_pastor: "Campus pastor"};
let users = [];
let editingUser = null;
async function loadUsers() {
  ({items: users} = await api("/api/users"));
  $("#userRows").innerHTML = users.map((u) => {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    const status = !u.isActive ? ["Deactivated", "status-inactive"] : locked ? ["Locked", "status-new"] : u.mustChangePassword ? ["Awaiting first sign-in", "status-new"] : ["Active", "status-active"];
    const self = u.id === state.user.id;
    return `<tr data-user="${u.id}"><td class="cell-main"><div class="member-cell"><div class="avatar ${toneFor(u.email.length)}">${esc(u.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase())}</div><span><strong>${esc(u.fullName)}${self ? " (you)" : ""}</strong><small>${esc(u.email)}</small></span></div></td><td data-label="Role">${ROLE_LABELS[u.role]}</td><td data-label="Centre">${esc(centreLabel(state.centres.find((c) => c.id === u.centreId)) || "All centres")}</td><td data-label="Status"><span class="status-badge ${status[1]}"><i></i>${status[0]}</span></td><td data-label="Last sign-in">${u.lastLoginAt ? esc(formatTime(u.lastLoginAt)) : "Never"}</td><td class="user-actions"><button class="text-link" data-user-action="edit">Edit</button><button class="text-link" data-user-action="reset">Reset password</button>${locked ? `<button class="text-link" data-user-action="unlock">Unlock</button>` : ""}${self ? "" : `<button class="text-link ${u.isActive ? "danger-link" : ""}" data-user-action="${u.isActive ? "deactivate" : "activate"}">${u.isActive ? "Deactivate" : "Reactivate"}</button>`}</td></tr>`;
  }).join("");
}
function openUserForm(user = null) {
  editingUser = user;
  const form = $("#userForm"); form.reset();
  $("#userFormKicker").textContent = user ? "EDIT USER" : "NEW USER";
  $("#userFormTitle").textContent = user ? user.fullName : "Add a user";
  $("#userSave").textContent = user ? "Save changes" : "Create account";
  $("#u-centreId").innerHTML = centreOptions("Select a fellowship centre");
  form.elements.fullName.value = user?.fullName || "";
  form.elements.email.value = user?.email || "";
  form.elements.email.disabled = !!user;
  form.elements.role.value = user?.role || "campus_pastor";
  form.elements.centreId.value = user?.centreId || "";
  ["fullName", "email", "role", "centreId"].forEach((k) => setError(`#ue-${k}`, ""));
  $("#userFormError").hidden = true;
  updateUserRole();
  closeModals(true);
  $("#userBackdrop").hidden = false;
  form.elements.fullName.focus();
}
function updateUserRole() {
  const role = $("#userForm").elements.role.value;
  $('[data-field="centreId"]').hidden = role !== "campus_pastor";
  $("#roleHelp").textContent = role === "campus_pastor" ? "Can view, add and edit members of one fellowship centre." : "Full access to every centre, user accounts and the audit log.";
}
const saveUser = guard(async (event) => {
  event.preventDefault();
  const form = $("#userForm");
  const body = {fullName: form.elements.fullName.value.trim(), role: form.elements.role.value, centreId: form.elements.role.value === "campus_pastor" ? Number(form.elements.centreId.value) || null : null};
  if (!editingUser) body.email = form.elements.email.value.trim();
  ["fullName", "email", "role", "centreId"].forEach((k) => setError(`#ue-${k}`, ""));
  try {
    const result = editingUser ? await api(`/api/users/${editingUser.id}`, {method: "PATCH", body}) : await api("/api/users", {method: "POST", body});
    closeModals(true);
    await loadUsers();
    if (result.temporaryPassword) showTempPassword(result.user, result.temporaryPassword, "Account created");
    else toast(`${result.user.fullName}’s account was updated.`);
  } catch (error) {
    if (error.data?.errors) Object.entries(error.data.errors).forEach(([k, v]) => setError(`#ue-${k}`, v));
    $("#userFormError").textContent = error.message; $("#userFormError").hidden = false;
  }
});
function showTempPassword(user, password, title) {
  $("#tempTitle").textContent = title;
  $("#tempName").textContent = user.fullName;
  $("#tempPassword").textContent = password;
  $("#tempBackdrop").hidden = false;
  $("#copyTemp").focus();
}
const userAction = guard(async (event) => {
  const button = event.target.closest("[data-user-action]"); if (!button) return;
  const user = users.find((u) => u.id === button.closest("[data-user]").dataset.user);
  const action = button.dataset.userAction;
  if (action === "edit") return openUserForm(user);
  if (action === "reset") {
    if (!confirm(`Reset the password for ${user.fullName}? They’ll be signed out everywhere and must use the new temporary password.`)) return;
    const result = await api(`/api/users/${user.id}/reset-password`, {method: "POST"});
    await loadUsers();
    return showTempPassword(result.user, result.temporaryPassword, "Password reset");
  }
  if (action === "deactivate" && !confirm(`Deactivate ${user.fullName}? They’ll be signed out immediately and won’t be able to sign in.`)) return;
  const body = action === "unlock" ? {unlock: true} : {isActive: action === "activate"};
  const result = await api(`/api/users/${user.id}`, {method: "PATCH", body});
  await loadUsers();
  toast(action === "unlock" ? `${result.user.fullName} can sign in again.` : `${result.user.fullName} was ${action === "activate" ? "reactivated" : "deactivated"}.`);
});

// ---- Audit log (regional admin) -------------------------------------------------------------
let auditRequest = 0, auditItems = [];
async function loadAuditMeta() {
  const {items, categories} = await api("/api/audit/actors");
  const keepCategory = $("#auditCategory").value, keepActor = $("#auditActor").value;
  $("#auditCategory").innerHTML = `<option value="">All categories</option>${categories.map((c) => `<option${c === keepCategory ? " selected" : ""}>${esc(c)}</option>`).join("")}`;
  $("#auditActor").innerHTML = `<option value="">Everyone</option>${items.map((a) => `<option value="${esc(a.email)}"${a.email === keepActor ? " selected" : ""}>${esc(a.name)} (${esc(a.email)})</option>`).join("")}`;
}
async function loadAudit({open = false} = {}) {
  const ticket = ++auditRequest;
  const params = new URLSearchParams({limit: String(state.auditShown)});
  if (open) params.set("open", "1");
  const fields = {q: "#auditSearch", category: "#auditCategory", actor: "#auditActor", from: "#auditFrom", to: "#auditTo"};
  Object.entries(fields).forEach(([key, selector]) => { const value = $(selector).value.trim(); if (value) params.set(key, value); });
  const {items, total} = await api(`/api/audit?${params}`);
  if (ticket !== auditRequest) return;
  auditItems = items;
  $("#auditRows").innerHTML = items.map((e) => `<tr class="audit-row sev-${A.severity(e)}" data-seq="${e.seq}" tabindex="0" aria-expanded="false"><td data-label="Entry">#${e.seq}</td><td class="audit-when" data-label="When">${esc(new Date(e.ts).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"}))}<small>${esc(new Date(e.ts).toLocaleTimeString("en-GB"))}</small></td><td data-label="Who">${esc(e.actor_name || "Not signed in")}<small class="audit-sub">${esc(e.actor_role ? `${e.actor_role}${e.actor_centre ? ` · ${e.actor_centre}` : ""}` : e.ip || "")}</small></td><td class="cell-main audit-activity"><span class="cat-badge">${esc(A.category(e))}</span>${esc(A.describe(e))}</td><td class="audit-toggle-cell"><span class="row-more audit-toggle" aria-hidden="true">›</span></td></tr><tr class="audit-detail" data-detail="${e.seq}" hidden><td colspan="5"></td></tr>`).join("");
  $("#auditEmpty").hidden = items.length > 0;
  $("#auditShown").textContent = fmt(items.length);
  $("#auditTotal").textContent = fmt(total);
  $("#auditMore").hidden = items.length >= total;
}
function showValue(value) { return value === "" || value == null ? `<span class="diff-empty">empty</span>` : esc(typeof value === "object" ? JSON.stringify(value) : value); }
function auditDetail(e) {
  const d = e.details || {};
  let body = "";
  if (Array.isArray(d.changes) && d.changes.length) body += `<table class="diff-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${d.changes.map((c) => `<tr><td>${esc(c.label)}</td><td class="diff-from">${showValue(c.from)}</td><td class="diff-to">${showValue(c.to)}</td></tr>`).join("")}</tbody></table>`;
  if (d.snapshot) body += `<table class="diff-table"><thead><tr><th>Field</th><th>Value at removal</th></tr></thead><tbody>${Object.entries(d.snapshot).map(([key, value]) => { const f = FIELDS.find((x) => x.key === key); return `<tr><td>${esc(f ? S.groupLabel(f) : key)}</td><td>${showValue(value)}</td></tr>`; }).join("")}</tbody></table>`;
  const extra = Object.entries(d).filter(([key]) => !["changes", "snapshot"].includes(key));
  const cells = [["Action code", `<code>${esc(e.action)}</code>`], ["Recorded", esc(new Date(e.ts).toLocaleString("en-GB"))], ["Email", esc(e.actor_email || "—")], ["IP address", esc(e.ip || "—")], ["Device", esc(e.user_agent || "—")], ...(e.target_type ? [["Record", `${esc(e.target_label)} <code>${esc(e.target_type)} #${esc(e.target_id)}</code>`]] : []), ...extra.map(([key, value]) => [key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), showValue(value)]), ["Entry hash", `<span class="audit-hash">${esc(e.hash)}</span>`], ["Previous hash", `<span class="audit-hash">${esc(e.prev_hash)}</span>`]];
  return `<div class="audit-detail-grid">${cells.map(([label, value]) => `<div><small>${esc(label)}</small>${value}</div>`).join("")}</div>${body}`;
}
function toggleAuditRow(row) {
  const detail = $(`[data-detail="${row.dataset.seq}"]`);
  if (!detail.dataset.filled) { detail.firstElementChild.innerHTML = auditDetail(auditItems.find((e) => String(e.seq) === row.dataset.seq)); detail.dataset.filled = "1"; }
  detail.hidden = !detail.hidden;
  row.setAttribute("aria-expanded", String(!detail.hidden));
}
const verifyAudit = guard(async () => {
  $("#auditVerify").disabled = true; $("#auditVerify").textContent = "Checking…";
  try {
    const result = await api("/api/audit/verify", {method: "POST"});
    $("#auditIntegrity").innerHTML = result.ok
      ? `<div class="audit-integrity integrity-ok"><b>✓</b><span><strong>Log intact.</strong> All ${fmt(result.entries)} entries are linked and unchanged since they were recorded. Latest fingerprint: <code class="audit-hash">${esc(result.head?.hash.slice(0, 16) || "")}…</code> (entry #${result.head?.seq || 0}). Note it down or export the JSON to prove the log later.</span></div>`
      : `<div class="audit-integrity integrity-bad"><b>⚠</b><span><strong>Tampering detected at entry #${esc(result.at)}.</strong> ${esc(result.reason)} Export the log and investigate how the database was accessed.</span></div>`;
    await loadAudit();
  } finally { $("#auditVerify").disabled = false; $("#auditVerify").textContent = "✓ Verify integrity"; }
});

// ---- Modals, menus, misc ------------------------------------------------------------------
function closeModals(force = false) {
  if (!force && !$("#formBackdrop").hidden && wiz.dirty && !confirm(wiz.mode === "edit" ? "Discard your changes to this member?" : "Discard this new member? The details you entered will be lost.")) return false;
  $$(".modal-backdrop").forEach((node) => { node.hidden = true; });
  if (force || $("#modalBackdrop").hidden) state.openMember = null;
  return true;
}
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("toast-visible"); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => node.classList.remove("toast-visible"), 4200); }
function closeMenu() { $("#sidebar").classList.remove("sidebar-open"); $("#mobileScrim").classList.remove("scrim-visible"); }
// Downloads are plain links; check the session first so an expired one shows the sign-in screen instead of downloading an error.
const download = guard(async (event) => { event.preventDefault(); const href = event.currentTarget.getAttribute("href"); await api("/api/auth/me"); window.location.href = href; });

// ---- Wiring ---------------------------------------------------------------------------------
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#loginEmail").value.trim(), password = $("#loginPassword").value;
  $("#loginError").hidden = true;
  if (!email || !password) { $("#loginError").textContent = "Enter your email and password."; $("#loginError").hidden = false; return; }
  $("#loginSubmit").disabled = true; $("#loginSubmit").textContent = "Signing in…";
  try {
    const {user, centres} = await api("/api/auth/login", {method: "POST", body: {email, password}});
    $("#loginNotice").hidden = true;
    startApp(user, centres);
  } catch (error) {
    $("#loginError").textContent = error.message; $("#loginError").hidden = false;
    $("#loginPassword").value = ""; $("#loginPassword").focus();
  } finally { $("#loginSubmit").disabled = false; $("#loginSubmit").textContent = "Sign in"; }
});
$("#passwordForm").addEventListener("submit", guard(async (event) => {
  event.preventDefault();
  const current = $("#currentPassword").value, next = $("#newPassword").value, confirmValue = $("#confirmPassword").value;
  ["currentPassword", "newPassword", "confirmPassword"].forEach((k) => setError(`#e-${k}`, ""));
  if (!current) return setError("#e-currentPassword", "Enter your current password.");
  if (next.length < 10) return setError("#e-newPassword", "Use at least 10 characters.");
  if (next !== confirmValue) return setError("#e-confirmPassword", "The passwords don’t match.");
  try {
    const {user} = await api("/api/auth/password", {method: "POST", body: {currentPassword: current, newPassword: next}});
    const me = await api("/api/auth/me");
    startApp({...me.user, ...user, mustChangePassword: false}, me.centres, me.session);
    toast("Your password was changed.");
  } catch (error) {
    if (error.data?.errors) Object.entries(error.data.errors).forEach(([k, v]) => setError(`#e-${k}`, v)); else throw error;
  }
}));
$("#passwordCancel").addEventListener("click", guard(async () => {
  if ($("#passwordForm").dataset.forced) { await api("/api/auth/logout", {method: "POST"}).catch(() => {}); showLogin(); }
  else { showOnly("#appShell"); }
}));
$$("[data-reveal]").forEach((button) => button.addEventListener("click", () => {
  const input = $(`#${button.dataset.reveal}`); const show = input.type === "password";
  input.type = show ? "text" : "password"; button.textContent = show ? "Hide" : "Show"; button.setAttribute("aria-label", show ? "Hide password" : "Show password");
}));
$("#signOut").addEventListener("click", guard(async () => { await api("/api/auth/logout", {method: "POST"}); showLogin("You’ve been signed out."); }));
$("#changePassword").addEventListener("click", () => { closeMenu(); showPasswordScreen(false); });

$("#schoolFilter").addEventListener("change", guard(async () => { state.centreFilter = $("#schoolFilter").value; state.membersShown = PAGE; await loadMembers({logFilter: !!state.centreFilter}); }));
let searchTimer;
$("#searchBox").addEventListener("input", () => { clearTimeout(searchTimer); state.membersShown = PAGE; searchTimer = setTimeout(guard(loadMembers), 450); });
$("#resetFilter").addEventListener("click", guard(async () => { $("#searchBox").value = ""; $("#schoolFilter").value = ""; state.centreFilter = ""; state.membersShown = PAGE; await loadMembers(); }));
$("#membersMore").addEventListener("click", guard(async () => { state.membersShown += PAGE; await loadMembers(); }));
$("#closeModal").addEventListener("click", () => closeModals(true));
$$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModals()));
$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModals(); }));
$$("[data-view]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.view === "Members" && button.classList.contains("nav-item")) { state.centreFilter = ""; $("#schoolFilter").value = ""; state.membersShown = PAGE; }
  showView(button.dataset.view);
}));
$("#addButton").addEventListener("click", () => openForm());
$("#directoryAdd").addEventListener("click", () => openForm());
$("#memberForm").addEventListener("submit", onFormSubmit);
$("#memberForm").addEventListener("input", onFormInput);
$("#memberForm").addEventListener("change", onFormInput);
$("#memberForm").addEventListener("focusout", onFormBlur);
$("#stepper").addEventListener("click", onStepClick);
$("#wizardBody").addEventListener("click", onStepClick);
$("#wizBack").addEventListener("click", () => { if (wiz.step === 0) closeModals(); else goStep(wiz.step - 1); });
$("#wizAnother").addEventListener("click", () => saveFromForm({another: true}));
$("#wizSaveNow").addEventListener("click", () => saveFromForm());
$("#editMember").addEventListener("click", () => { if (state.openMember) openForm(state.openMember); });
$("#removeMember").addEventListener("click", removeMember);
$("#exportButton").addEventListener("click", () => { track("export.print", {view: state.view}); window.print(); });
$$("#downloadSummary, #downloadMonthly, #auditCsv, #auditJson").forEach((link) => link.addEventListener("click", download));
$("#helpButton").addEventListener("click", () => { track("help.open"); closeMenu(); closeModals(true); $("#helpBackdrop").hidden = false; $("#helpBackdrop [data-close]").focus(); });
$("#notifyButton").addEventListener("click", () => { track("notify.open"); toast("You’re all caught up. There are no new notifications."); });
$("#openMenu").addEventListener("click", () => { $("#sidebar").classList.add("sidebar-open"); $("#mobileScrim").classList.add("scrim-visible"); });
$("#closeMenu").addEventListener("click", closeMenu); $("#mobileScrim").addEventListener("click", closeMenu);
$("#addUser").addEventListener("click", () => openUserForm());
$("#centresView").addEventListener("click", centreAction);
$("#centreForm").addEventListener("submit", saveCentre);
$("#userForm").addEventListener("submit", saveUser);
$("#userForm").addEventListener("change", (event) => { if (event.target.name === "role") updateUserRole(); });
$("#userRows").addEventListener("click", userAction);
$("#copyTemp").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#tempPassword").textContent); toast("Copied."); } catch { toast("Select the password and copy it manually."); } });
let auditTimer;
["#auditSearch", "#auditCategory", "#auditActor", "#auditFrom", "#auditTo"].forEach((id) => $(id).addEventListener("input", () => { clearTimeout(auditTimer); state.auditShown = PAGE; auditTimer = setTimeout(guard(loadAudit), 350); }));
$("#auditReset").addEventListener("click", guard(async () => { ["#auditSearch", "#auditCategory", "#auditActor", "#auditFrom", "#auditTo"].forEach((id) => { $(id).value = ""; }); state.auditShown = PAGE; await loadAudit(); }));
$("#auditMore").addEventListener("click", guard(async () => { state.auditShown += PAGE; await loadAudit(); }));
$("#auditRows").addEventListener("click", (event) => { const row = event.target.closest(".audit-row"); if (row) toggleAuditRow(row); });
$("#auditRows").addEventListener("keydown", (event) => { const row = event.target.closest(".audit-row"); if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleAuditRow(row); } });
$("#auditVerify").addEventListener("click", verifyAudit);
document.addEventListener("keydown", (event) => {
  if (!state.user || $("#appShell").hidden) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (!closeModals()) return; showView("Members").then(() => $("#searchBox").focus()); }
  if (event.key === "Escape") { closeModals(); closeMenu(); }
});
// Show the sign-in screen promptly when the server-side idle timeout has passed.
setInterval(() => {
  if (state.user && !document.hidden && Date.now() - state.lastActivity > state.idleMinutes * 60000) api("/api/auth/me").catch(() => {});
}, 60000);
["click", "keydown"].forEach((type) => document.addEventListener(type, () => { if (state.user && Date.now() - state.lastActivity > 5 * 60000) api("/api/auth/me").catch(() => {}); }, {passive: true}));

boot();
