// What each audit action means, shared by the browser (window.AuditActions) and the server (require).
(function (root, factory) {
  const actions = factory();
  if (typeof module === "object" && module.exports) module.exports = actions;
  else root.AuditActions = actions;
})(typeof self !== "undefined" ? self : this, () => {
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const who = (e) => e.target_label || "a record";
  // action: [category, severity, describe(entry)]
  const ACTIONS = {
    "auth.login": ["Sign-in", "info", () => "Signed in"],
    "auth.login_failed": ["Sign-in", "warning", (e) => `Failed sign-in for ${e.details.email || "an account"} — ${e.details.reason}`],
    "auth.locked": ["Sign-in", "critical", (e) => `Account ${e.details.email} locked after ${e.details.attempts} failed sign-ins`],
    "auth.logout": ["Sign-in", "info", () => "Signed out"],
    "auth.password_changed": ["Sign-in", "notice", () => "Changed their password"],
    "user.create": ["Users", "notice", (e) => `Created the account for ${who(e)} (${e.details.role})`],
    "user.update": ["Users", "notice", (e) => `Updated the account for ${who(e)} (${plural(e.details.changes.length, "change")})`],
    "user.password_reset": ["Users", "warning", (e) => `Reset the password for ${who(e)}`],
    "centre.create": ["Centres", "notice", (e) => `Added the fellowship centre ${who(e)} under ${e.details.institution}`],
    "centre.update": ["Centres", "notice", (e) => `Renamed the fellowship centre “${e.details.from}” to “${e.details.to}”`],
    "centre.delete": ["Centres", "warning", (e) => `Removed the fellowship centre ${who(e)} from ${e.details.institution}`],
    "nav.view": ["Navigation", "info", (e) => `Opened ${e.details.view}`],
    "member.view": ["Member", "info", (e) => `Viewed the profile of ${who(e)}`],
    "member.create": ["Member", "notice", (e) => `Added ${who(e)} to ${e.details.centre}`],
    "member.update": ["Member", "notice", (e) => e.details.changes.length ? `Updated ${who(e)} (${plural(e.details.changes.length, "field")})` : `Saved ${who(e)} with no changes`],
    "member.delete": ["Member", "warning", (e) => `Removed ${who(e)}`],
    "member.register": ["Registration", "notice", (e) => `${who(e)} registered online for ${e.details.centre}`],
    "member.approve": ["Registration", "notice", (e) => `Approved the registration of ${who(e)} (${e.details.centre})`],
    "member.reject": ["Registration", "warning", (e) => `Rejected the registration of ${who(e)} (${e.details.centre})${e.details.reason ? ` — ${e.details.reason}` : ""}`],
    "directory.search": ["Directory", "info", (e) => `Searched members for “${e.details.query}” (${plural(e.details.results, "result")})`],
    "directory.filter": ["Directory", "info", (e) => `Filtered members by ${e.details.centre}`],
    "export.print": ["Export", "notice", (e) => `Printed the ${e.details.view} page`],
    "export.csv": ["Export", "notice", (e) => `Downloaded ${e.details.report} (${plural(e.details.rows, "row")})`],
    "audit.view": ["Audit", "info", () => "Opened the audit log"],
    "audit.verify": ["Audit", "info", (e) => e.details.ok ? `Verified the audit log — ${plural(e.details.entries, "entry", "entries")} intact` : `Verified the audit log — problem at entry #${e.details.at}`],
    "audit.export": ["Audit", "notice", (e) => `Exported the audit log as ${e.details.format}`],
    "access.denied": ["Access", "warning", (e) => `Access denied — ${e.details.reason}`],
    "help.open": ["Help", "info", () => "Opened the help centre"],
    "notify.open": ["Help", "info", () => "Checked notifications"]
  };
  const meta = (e) => ACTIONS[e.action] || ["Other", "info", () => e.action];
  return {
    ACTIONS,
    describe: (e) => { try { return meta(e)[2](e); } catch { return e.action; } },
    category: (e) => meta(e)[0],
    severity: (e) => meta(e)[1],
    categories: () => [...new Set(Object.values(ACTIONS).map(([category]) => category))],
    actionsIn: (category) => Object.keys(ACTIONS).filter((key) => ACTIONS[key][0] === category),
    // Events the browser may report itself; everything else is recorded by the server.
    CLIENT_EVENTS: ["nav.view", "help.open", "notify.open", "export.print"]
  };
});
