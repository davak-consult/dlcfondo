// Which members a signed-in user may see: their own centre unless their role is regional, and only
// female members for sisters' coordinators. Every member query and record check goes through here.
const { roleOf } = require("../public/roles.js");

// SQL condition for the user's scope, adding its values to params. A regional user may narrow it to one centre.
function scopeWhere(user, params, requestedCentre = null) {
  const role = roleOf(user), parts = [];
  if (!role.regional) { params.push(user.centreId); parts.push(`centre_id = $${params.length}`); }
  else if (requestedCentre) { params.push(requestedCentre); parts.push(`centre_id = $${params.length}`); }
  if (role.femaleOnly) parts.push("gender = 'Female'");
  return parts.length ? parts.join(" AND ") : "TRUE";
}

// Why a member is outside the user's scope ("" if it's inside). member: {centreId, gender}.
function outOfScope(user, member) {
  const role = roleOf(user);
  if (!role.regional && member.centreId !== user.centreId) return `${role.label.toLowerCase()}s can only open members of their own centre`;
  if (role.femaleOnly && member.gender !== "Female") return "sisters’ coordinators can only open female members";
  return "";
}

const visibleCentres = (user, list) => roleOf(user).regional ? list : list.filter((c) => c.id === user.centreId);

module.exports = { scopeWhere, outOfScope, visibleCentres, roleOf };
