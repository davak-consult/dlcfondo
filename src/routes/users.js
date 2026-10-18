const express = require("express");
const { query, tx } = require("../db");
const audit = require("../audit");
const auth = require("../auth");
const { centres } = require("../members");

const router = express.Router();
router.param("id", (req, res, next, id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? next() : res.status(404).json({ error: "Account not found." }));
const ROLES = { regional_admin: "Regional admin", campus_pastor: "Campus pastor" };
const target = (u) => ({ type: "user", id: u.id, label: u.full_name || u.fullName });
const view = (row) => ({ id: row.id, email: row.email, fullName: row.full_name, role: row.role, centreId: row.centre_id, isActive: row.is_active, mustChangePassword: row.must_change_password, lockedUntil: row.locked_until, lastLoginAt: row.last_login_at, createdAt: row.created_at });

async function validate(body, { partial = false } = {}) {
  const errors = {}, data = {};
  if (!partial || body.fullName !== undefined) { data.fullName = String(body.fullName || "").trim().replace(/\s+/g, " "); if (!data.fullName || data.fullName.length > 120) errors.fullName = "Enter their full name."; }
  if (!partial) { data.email = String(body.email || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) || data.email.length > 254) errors.email = "Enter a valid email address."; }
  if (!partial || body.role !== undefined) { data.role = body.role; if (!ROLES[data.role]) errors.role = "Choose a role."; }
  if (!partial || body.centreId !== undefined || body.role !== undefined) {
    data.centreId = body.centreId ? Number(body.centreId) : null;
    if (data.centreId && !(await centres()).some((c) => c.id === data.centreId)) errors.centreId = "Choose a centre.";
  }
  if (body.isActive !== undefined) data.isActive = body.isActive === true;
  return { data, errors };
}

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT * FROM users ORDER BY is_active DESC, role, full_name");
  res.json({ items: rows.map(view) });
});

router.post("/", async (req, res) => {
  const { data, errors } = await validate(req.body || {});
  if (data.role === "campus_pastor" && !data.centreId) errors.centreId = "Choose the centre this pastor looks after.";
  if (data.role === "regional_admin") data.centreId = null;
  if (Object.keys(errors).length) return res.status(400).json({ error: "Some details need attention.", errors });
  const { rows: [existing] } = await query("SELECT 1 FROM users WHERE lower(email) = $1", [data.email]);
  if (existing) return res.status(400).json({ error: "An account with this email already exists.", errors: { email: "An account with this email already exists." } });
  const temporaryPassword = auth.temporaryPassword();
  const passwordHash = await auth.hashPassword(temporaryPassword);
  const user = await tx(async (client) => {
    const { rows: [row] } = await client.query(
      "INSERT INTO users (email, full_name, role, centre_id, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, true) RETURNING *",
      [data.email, data.fullName, data.role, data.centreId, passwordHash]);
    await audit.record(client, audit.contextFrom(req), "user.create", { target: target(row), details: { email: row.email, role: ROLES[row.role], centre: (await centres()).find((c) => c.id === row.centre_id)?.name || "All centres" } });
    return row;
  });
  res.status(201).json({ user: view(user), temporaryPassword });
});

router.patch("/:id", async (req, res) => {
  const { data, errors } = await validate(req.body || {}, { partial: true });
  if (Object.keys(errors).length) return res.status(400).json({ error: "Some details need attention.", errors });
  const result = await tx(async (client) => {
    const { rows: [before] } = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!before) { res.status(404).json({ error: "Account not found." }); return null; }
    const role = data.role ?? before.role;
    const centreId = role === "regional_admin" ? null : (data.centreId !== undefined ? data.centreId : before.centre_id);
    if (role === "campus_pastor" && !centreId) { res.status(400).json({ error: "Choose the centre this pastor looks after.", errors: { centreId: "Choose the centre this pastor looks after." } }); return null; }
    if (before.id === req.user.id && (role !== "regional_admin" || data.isActive === false)) { res.status(400).json({ error: "You can’t remove your own admin access or deactivate yourself." }); return null; }
    const isActive = data.isActive ?? before.is_active;
    if (before.role === "regional_admin" && (role !== "regional_admin" || !isActive)) {
      const { rows: [{ count }] } = await client.query("SELECT count(*)::int FROM users WHERE role = 'regional_admin' AND is_active AND id <> $1", [before.id]);
      if (!count) { res.status(400).json({ error: "There must always be at least one active regional admin." }); return null; }
    }
    const { rows: [after] } = await client.query(
      "UPDATE users SET full_name = $1, role = $2, centre_id = $3, is_active = $4, locked_until = CASE WHEN $5 THEN NULL ELSE locked_until END, updated_at = now() WHERE id = $6 RETURNING *",
      [data.fullName ?? before.full_name, role, centreId, isActive, req.body?.unlock === true, before.id]);
    if (!after.is_active || after.role !== before.role || after.centre_id !== before.centre_id) await client.query("DELETE FROM sessions WHERE user_id = $1", [after.id]);
    const list = await centres(); const centreName = (id) => list.find((c) => c.id === id)?.name || "All centres";
    const changes = [
      ["Full name", before.full_name, after.full_name], ["Role", ROLES[before.role], ROLES[after.role]],
      ["Centre", centreName(before.centre_id), centreName(after.centre_id)], ["Status", before.is_active ? "Active" : "Deactivated", after.is_active ? "Active" : "Deactivated"],
      ["Lock", before.locked_until > new Date() ? "Locked" : "Unlocked", after.locked_until > new Date() ? "Locked" : "Unlocked"]
    ].filter(([, from, to]) => from !== to).map(([label, from, to]) => ({ label, from, to }));
    await audit.record(client, audit.contextFrom(req), "user.update", { target: target(after), details: { changes } });
    return after;
  });
  if (result) res.json({ user: view(result) });
});

router.post("/:id/reset-password", async (req, res) => {
  const temporaryPassword = auth.temporaryPassword();
  const passwordHash = await auth.hashPassword(temporaryPassword);
  const user = await tx(async (client) => {
    const { rows: [row] } = await client.query("UPDATE users SET password_hash = $1, must_change_password = true, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $2 RETURNING *", [passwordHash, req.params.id]);
    if (!row) return null;
    await client.query("DELETE FROM sessions WHERE user_id = $1", [row.id]);
    await audit.record(client, audit.contextFrom(req), "user.password_reset", { target: target(row) });
    return row;
  });
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: view(user), temporaryPassword });
});

module.exports = router;
