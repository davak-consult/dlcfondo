// Account roles and what each can see, shared by the browser (window.Roles) and the server (require).
// regional: sees every fellowship centre (otherwise only their own centre)
// femaleOnly: sees and manages female members only (sisters' coordinators)
// admin: manages user accounts, fellowship centres and the audit log
(function (root, factory) {
  const roles = factory();
  if (typeof module === "object" && module.exports) module.exports = roles;
  else root.Roles = roles;
})(typeof self !== "undefined" ? self : this, () => {
  const ROLES = {
    regional_admin: {label: "Regional admin", regional: true, femaleOnly: false, admin: true, help: "Full access to every centre, user accounts and the audit log."},
    campus_pastor: {label: "Campus pastor", regional: false, femaleOnly: false, admin: false, help: "Can view, add and edit members of one fellowship centre."},
    centre_sister: {label: "Centre sisters’ coordinator", regional: false, femaleOnly: true, admin: false, help: "Can view, add and edit female members of one fellowship centre."},
    regional_sister: {label: "Regional sisters’ coordinator", regional: true, femaleOnly: true, admin: false, help: "Can view, add and edit female members in every centre of the region."}
  };
  const roleOf = (user) => ROLES[user && user.role] || ROLES.campus_pastor;
  // Roles tied to one fellowship centre must have a centre chosen for them.
  const needsCentre = (role) => !!ROLES[role] && !ROLES[role].regional;
  return {ROLES, roleOf, needsCentre};
});
