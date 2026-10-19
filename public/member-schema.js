// Member fields and validation rules, shared by the browser (window.MemberSchema)
// and the server (require), so both sides always enforce the same rules.
(function (root, factory) {
  const schema = factory();
  if (typeof module === "object" && module.exports) module.exports = schema;
  else root.MemberSchema = schema;
})(typeof self !== "undefined" ? self : this, () => {
  const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara","Outside Nigeria"];
  const LEVELS = ["100 level","200 level","300 level","400 level","500 level","600 level","Postgraduate"];
  const UNITS = ["Not yet in a unit","Bible study","Choir","Drama","Evangelism","Follow-up","Media & technical","Prayer","Sanitation","Ushering","Welfare"];
  const STATUSES = ["New member", "Active", "Inactive", "Graduated"];

  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const phoneDigits = (v) => String(v || "").replace(/[\s\-().]/g, "");
  const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + "T00:00:00Z").getTime()) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;

  // Validators return an error message, or "" when the value is fine.
  const validPhone = (v) => /^(\+?234|0)[789][01]\d{8}$/.test(phoneDigits(v)) ? "" : "Enter a valid Nigerian number, e.g. 0803 123 4567.";
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254 ? "" : "Enter a valid email address, e.g. name@example.com.";
  const notFuture = (v) => !isISODate(v) ? "Enter a valid date." : v > todayISO() ? "This date can’t be in the future." : "";
  const validDob = (v) => { const base = notFuture(v); if (base) return base; const age = (Date.now() - new Date(v + "T00:00:00Z")) / 31557600000; return age < 12 || age > 100 ? "Check the date of birth — the age looks unlikely." : ""; };
  const validYear = (v) => /^\d{4}$/.test(v) && +v >= 1970 && +v <= new Date().getFullYear() ? "" : `Enter a year between 1970 and ${new Date().getFullYear()}.`;
  const formatPhone = (v) => { if (!v || validPhone(v)) return v; const local = phoneDigits(v).replace(/^\+?234/, "0"); return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`; };
  // "*" in a condition means "any answer given", e.g. academic details appear once an institution is chosen.
  const chosen = {institution: "*"}, student = {role: "Student", ...chosen}, staff = {role: "Staff", ...chosen}, corper = {role: "Corps member", ...chosen}, worker = {isWorker: "Yes"};
  // Member types offered for each kind of institution (campus institutions, or the Corpers Fellowship).
  const ROLES = ["Student", "Staff", "Corps member"];
  const ROLES_BY_KIND = {campus: ["Student", "Staff"], corpers: ["Corps member"]};
  const validStateCode = (v) => /^[A-Z]{2}\/\d{2}[A-Z]\/\d{3,6}$/i.test(v) ? "" : "Enter the state code as on your NYSC call-up, e.g. OD/25B/1234.";

  const STEPS = [
    {id: "personal", title: "Personal", heading: "Personal details", intro: "Who is this member and how can we reach them?", fields: [
      {key: "firstName", label: "First name", required: true, autocomplete: "given-name", maxLength: 80},
      {key: "surname", label: "Surname", required: true, autocomplete: "family-name", maxLength: 80},
      {key: "otherNames", label: "Other names", autocomplete: "additional-name", maxLength: 120},
      {key: "gender", label: "Gender", type: "choice", options: ["Male", "Female"], required: true},
      {key: "dob", label: "Date of birth", type: "date", validate: validDob, max: todayISO},
      {key: "stateOfOrigin", label: "State of origin", type: "select", options: STATES, placeholder: "Select a state"},
      {group: "Contact"},
      {key: "phone", label: "Phone number", type: "tel", required: true, help: "Nigerian number, e.g. 0803 123 4567", validate: validPhone, autocomplete: "tel"},
      {key: "whatsapp", label: "WhatsApp number", type: "tel", help: "Leave blank if it’s the same as the phone number", validate: validPhone},
      {key: "email", label: "Email address", type: "email", validate: validEmail, autocomplete: "email", wide: true},
      {key: "homeAddress", label: "Home address", required: true, help: "Permanent or family home address", wide: true, autocomplete: "street-address", maxLength: 300}
    ]},
    {id: "campus", title: "Campus", heading: "Campus details", intro: "Where this member studies, works or serves.", fields: [
      {key: "institution", label: "Institution / fellowship", type: "select", options: "institutions", required: true, wide: true, placeholder: "Select…", help: "Corps members choose Corpers Fellowship"},
      {key: "centre", label: "Fellowship centre", type: "select", options: "centres", required: true, wide: true, placeholder: "Select a fellowship centre", help: "The centre under this institution that the member attends", when: chosen},
      {key: "role", label: "Member type", type: "choice", options: "roles", required: true, wide: true, when: chosen},
      {key: "faculty", label: "Faculty / school", required: true, when: student, help: "e.g. Faculty of Science"},
      {key: "department", label: "Department", required: true, when: student},
      {key: "level", label: "Current level", type: "select", options: LEVELS, required: true, when: student, placeholder: "Select level"},
      {key: "programme", label: "Course of study", required: true, when: student, help: "e.g. B.Sc. Nursing Science"},
      {key: "admissionYear", label: "Year of admission", when: student, validate: validYear, inputmode: "numeric", maxLength: 4, placeholder: "e.g. 2024"},
      {key: "residence", label: "Hostel / campus address", required: true, wide: true, when: student, help: "Where they can be visited during the semester", maxLength: 300},
      {key: "staffCategory", label: "Staff category", type: "choice", options: ["Academic", "Non-academic"], required: true, when: staff, wide: true},
      {key: "staffDepartment", label: "Department / unit", required: true, when: staff},
      {key: "position", label: "Position / designation", required: true, when: staff, help: "e.g. Lecturer II, Bursary officer"},
      {key: "stateCode", label: "NYSC state code", required: true, when: corper, validate: validStateCode, maxLength: 20, placeholder: "e.g. OD/25B/1234"},
      {key: "ppa", label: "Place of primary assignment (PPA)", required: true, when: corper, help: "Where the corps member serves, e.g. St. Peter’s Grammar School, Akure"},
      {key: "lodgeAddress", label: "Lodge / residential address", required: true, wide: true, when: corper, maxLength: 300, help: "Where they can be visited during the service year"}
    ]},
    {id: "fellowship", title: "Fellowship", heading: "Fellowship details", intro: "Their walk with the fellowship so far.", fields: [
      {key: "status", label: "Membership status", type: "select", options: STATUSES, required: true, staffOnly: true},
      {key: "bornAgain", label: "Born again?", type: "choice", options: ["Yes", "No", "Not sure"]},
      {key: "waterBaptism", label: "Water baptism", type: "choice", options: ["Yes", "No"]},
      {key: "holySpirit", label: "Holy Spirit baptism", type: "choice", options: ["Yes", "No"]},
      {key: "isWorker", label: "Fellowship worker?", publicLabel: "Are you a worker?", type: "choice", options: ["Yes", "No"], required: true, help: "Workers serve in a unit such as the choir, ushering or evangelism."},
      {key: "unit", label: "Workers’ unit", publicLabel: "Which unit do you serve in?", type: "select", options: UNITS, placeholder: "Select a unit", required: true, when: worker},
      {key: "leadership", label: "Leadership role", publicLabel: "Do you hold a leadership role?", help: "e.g. Centre coordinator, unit leader. Leave blank if none.", when: worker},
      {key: "homeChurch", label: "Home church / branch", help: "Deeper Life branch attended at home"},
      {key: "notes", label: "Pastoral notes", type: "textarea", staffOnly: true, wide: true, maxLength: 2000, help: "Prayer points or follow-up notes. Visible to pastors who can open this record."}
    ]},
    {id: "family", title: "Family", heading: "Family & emergency contacts", intro: "Who to contact about this member, especially in an emergency.", fields: [
      {group: "Parent / guardian", help: "Optional for staff members."},
      {key: "parentName", label: "Full name"},
      {key: "parentRelationship", label: "Relationship", type: "select", options: ["Father", "Mother", "Guardian", "Other"], placeholder: "Select relationship"},
      {key: "parentPhone", label: "Phone number", type: "tel", validate: validPhone},
      {key: "parentAddress", label: "Address", maxLength: 300},
      {group: "Next of kin", help: "The person to contact first in an emergency."},
      {key: "kinSameAsParent", label: "Same as parent / guardian", type: "checkbox", wide: true},
      {key: "kinName", label: "Full name", required: true},
      {key: "kinRelationship", label: "Relationship", type: "select", options: ["Father", "Mother", "Guardian", "Sibling", "Spouse", "Relative", "Friend", "Other"], required: true, placeholder: "Select relationship"},
      {key: "kinPhone", label: "Phone number", type: "tel", required: true, validate: validPhone}
    ]},
    {id: "review", title: "Review", heading: "Review and save", intro: "Check everything is correct before saving.", fields: []}
  ];
  const FIELDS = STEPS.flatMap((step) => step.fields.filter((f) => f.key));
  const fieldShown = (f, data) => !f.when || Object.entries(f.when).every(([key, value]) => value === "*" ? !!data[key] : data[key] === value);
  // ctx lists what this user may choose: {institutions: [...], centres: {institutionName: [centreName, ...]}}.
  function optionsOf(f, ctx = {}, data = {}) {
    if (f.options === "institutions") return ctx.institutions || [];
    if (f.options === "centres") return (ctx.centres || {})[data.institution] || [];
    if (f.options === "roles") return ROLES_BY_KIND[(ctx.kinds || {})[data.institution] || "campus"];
    return f.options || [];
  }
  function groupLabel(f) {
    const step = STEPS.find((s) => s.fields.includes(f));
    let group = ""; for (const item of step.fields) { if (item.group) group = item.group; if (item === f) break; }
    return step.id === "family" && group ? `${group} · ${f.label.toLowerCase()}` : f.label;
  }
  function requiredMessage(f) {
    if (f.type === "choice" || f.type === "select") return "Please select an option.";
    return f.label.toLowerCase() === "full name" ? "Please enter their full name." : `Please enter the ${f.label.toLowerCase()}.`;
  }
  function fieldError(f, data, ctx) {
    const value = data[f.key];
    if (!fieldShown(f, data) || f.type === "checkbox") return "";
    if (f.required && !value) return requiredMessage(f);
    if (!value) return "";
    if (value.length > (f.maxLength || 200)) return `Keep this under ${f.maxLength || 200} characters.`;
    if ((f.type === "choice" || f.type === "select") && !optionsOf(f, ctx, data).includes(value)) return f.options === "centres" ? "Choose a fellowship centre under this institution." : "Please select one of the listed options.";
    return f.validate ? f.validate(value) : "";
  }
  // Turns untrusted input into a clean record: known fields only, trimmed strings,
  // hidden conditional fields blanked, phones formatted. Returns {data, errors}.
  function clean(input, ctx) {
    const data = {};
    FIELDS.forEach((f) => {
      const raw = input && input[f.key];
      data[f.key] = f.type === "checkbox" ? raw === true : typeof raw === "string" || typeof raw === "number" ? String(raw).trim().replace(f.type === "textarea" ? /[^\S\n]+/g : /\s+/g, " ") : "";
    });
    FIELDS.forEach((f) => { if (!fieldShown(f, data)) data[f.key] = f.type === "checkbox" ? false : ""; if (f.type === "tel") data[f.key] = formatPhone(data[f.key]); });
    const errors = {};
    FIELDS.forEach((f) => { const message = fieldError(f, data, ctx); if (message) errors[f.key] = message; });
    return {data, errors};
  }
  return {STEPS, FIELDS, ROLES, STATES, LEVELS, UNITS, STATUSES, todayISO, phoneDigits, validPhone, formatPhone, fieldShown, optionsOf, groupLabel, fieldError, clean};
});
