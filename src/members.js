// Maps between the shared member schema (camelCase keys) and the members table.
const { FIELDS, clean, groupLabel } = require("../public/member-schema.js");
const { query } = require("./db");

const toColumn = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const STORED = FIELDS.filter((f) => f.key !== "institution" && f.key !== "centre");
const DATE_FIELDS = new Set(STORED.filter((f) => f.type === "date").map((f) => f.key));

// Fellowship centres with their institution, cached until a centre is added, renamed or removed.
let centreCache = null;
async function centres() {
  centreCache ||= (await query(
    `SELECT c.id, c.code, c.name, i.id AS institutionId, i.name AS institution, i.short_name AS institutionShort, i.code AS institutionCode
       FROM centres c JOIN institutions i ON i.id = c.institution_id ORDER BY i.id, c.name`)).rows;
  return centreCache;
}
const clearCentreCache = () => { centreCache = null; };
const institutionList = async () => (await query("SELECT id, code, name, short_name AS shortName FROM institutions ORDER BY id")).rows;
const institutions = async () => [...new Set((await centres()).map((c) => c.institution))];

// What the member form may offer: institutions, and the centres under each (by institution name).
function formOptions(list) {
  const centresByInstitution = {};
  list.forEach((c) => { (centresByInstitution[c.institution] ||= []).push(c.name); });
  return { institutions: Object.keys(centresByInstitution), centres: centresByInstitution };
}

function fromRow(row, centreList) {
  const centre = centreList.find((c) => c.id === row.centre_id);
  const member = { id: Number(row.id), centreId: row.centre_id, institution: centre.institution, centre: centre.name };
  STORED.forEach((f) => { const value = row[toColumn(f.key)]; member[f.key] = f.type === "checkbox" ? !!value : value ?? ""; });
  return Object.assign(member, {
    name: [member.firstName, member.otherNames, member.surname].filter(Boolean).join(" "),
    initials: `${member.firstName[0] || ""}${member.surname[0] || ""}`.toUpperCase(),
    course: member.role === "Staff" ? member.position : member.programme,
    levelLabel: member.role === "Staff" ? "Staff" : member.level,
    approval: row.approval || "approved",
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at
  });
}

// Column list and values for INSERT/UPDATE, from cleaned data.
function toColumns(data, centreId) {
  const columns = ["centre_id"], values = [centreId];
  STORED.forEach((f) => { columns.push(toColumn(f.key)); values.push(DATE_FIELDS.has(f.key) && !data[f.key] ? null : data[f.key]); });
  return { columns, values };
}

function diff(before, after) {
  return FIELDS.filter((f) => f.type !== "checkbox" && String(before[f.key] ?? "") !== String(after[f.key] ?? ""))
    .map((f) => ({ field: f.key, label: groupLabel(f), from: before[f.key] ?? "", to: after[f.key] ?? "" }));
}

function snapshot(member) {
  return Object.fromEntries(FIELDS.filter((f) => f.type !== "checkbox" && member[f.key]).map((f) => [f.key, member[f.key]]));
}

const target = (member) => ({ type: "member", id: member.id, label: member.name });

// The last n calendar months (UTC) as "YYYY-MM", oldest first.
function recentMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7));
}

// Loads a member row by id (used after INSERT/UPDATE, since MySQL has no RETURNING).
const memberRow = async (client, id) => (await client.query("SELECT * FROM members WHERE id = $1", [id])).rows[0];

module.exports = { centres, clearCentreCache, institutionList, formOptions, institutions, fromRow, toColumns, diff, snapshot, target, clean, toColumn, STORED, recentMonths, memberRow };
