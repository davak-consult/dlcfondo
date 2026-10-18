const express = require("express");
const rateLimit = require("express-rate-limit");
const config = require("../config");
const { query, tx } = require("../db");
const audit = require("../audit");
const auth = require("../auth");
const { centres } = require("../members");

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many sign-in attempts from this network. Try again in 15 minutes." } });
const GENERIC = "Email or password is incorrect.";

router.post("/login", loginLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(req.body?.password || "");
  const ctx = audit.contextFrom(req);
  if (!email || !password) return res.status(400).json({ error: "Enter your email and password." });
  const { rows: [row] } = await query("SELECT u.*, c.name AS centre_name FROM users u LEFT JOIN centres c ON c.id = u.centre_id WHERE lower(u.email) = $1", [email]);
  if (!row) {
    await auth.burnTime(password);
    await audit.log(ctx, "auth.login_failed", { details: { email, reason: "no account with this email" } });
    return res.status(401).json({ error: GENERIC });
  }
  const user = auth.toUser(row);
  if (row.locked_until && row.locked_until > new Date()) {
    const minutes = Math.ceil((row.locked_until - Date.now()) / 60000);
    await audit.log(ctx, "auth.login_failed", { target: { type: "user", id: user.id, label: user.fullName }, details: { email, reason: "account is locked" } });
    return res.status(423).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the regional admin to reset your password.` });
  }
  const valid = await auth.checkPassword(row.password_hash, password);
  if (!valid || !row.is_active) {
    const attempts = row.failed_logins + 1;
    const lock = valid ? false : attempts >= config.maxFailedLogins;
    await tx(async (client) => {
      if (!valid) await client.query(`UPDATE users SET failed_logins = $1, locked_until = ${lock ? `NOW(3) + INTERVAL ${Number(config.lockoutMinutes)} MINUTE` : "locked_until"} WHERE id = $2`, [lock ? 0 : attempts, row.id]);
      await audit.record(client, ctx, "auth.login_failed", { target: { type: "user", id: user.id, label: user.fullName }, details: { email, reason: valid ? "account is deactivated" : "wrong password" } });
      if (lock) await audit.record(client, ctx, "auth.locked", { target: { type: "user", id: user.id, label: user.fullName }, details: { email, attempts } });
    });
    return res.status(401).json({ error: GENERIC });
  }
  await tx(async (client) => {
    await client.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = $1", [row.id]);
    await audit.record(client, ctx, "auth.login", { actor: user });
  });
  await auth.destroySession(req, res);
  await auth.createSession(res, row.id, req);
  res.json({ user, centres: await centres() });
});

router.post("/logout", async (req, res) => {
  if (req.user) await audit.log(audit.contextFrom(req), "auth.logout");
  await auth.destroySession(req, res);
  res.status(204).end();
});

router.get("/me", auth.requireAuth, async (req, res) => {
  res.json({ user: req.user, centres: await centres(), session: { idleMinutes: config.sessionIdleMinutes } });
});

router.post("/password", auth.requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const { rows: [row] } = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (!(await auth.checkPassword(row.password_hash, String(currentPassword || "")))) return res.status(400).json({ error: "Your current password is incorrect.", errors: { currentPassword: "Your current password is incorrect." } });
  const problem = auth.passwordProblem(newPassword, req.user.email) || (newPassword === currentPassword ? "Choose a password different from your current one." : "");
  if (problem) return res.status(400).json({ error: problem, errors: { newPassword: problem } });
  const passwordHash = await auth.hashPassword(newPassword);
  await tx(async (client) => {
    await client.query("UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW(3) WHERE id = $2", [passwordHash, req.user.id]);
    // Sign out every other device using the old password.
    await client.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [req.user.id, req.sessionHash]);
    await audit.record(client, audit.contextFrom(req), "auth.password_changed", { target: { type: "user", id: req.user.id, label: req.user.fullName } });
  });
  res.json({ user: { ...req.user, mustChangePassword: false } });
});

module.exports = router;
