const crypto = require("crypto");
const { hash, verify } = require("@node-rs/argon2");
const config = require("./config");
const { query } = require("./db");
const audit = require("./audit");

const COOKIE = config.cookieSecure ? "__Host-dlcf_session" : "dlcf_session";
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP argon2id baseline
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let dummyHash; // verified against for unknown emails so response time doesn't reveal which accounts exist

const hashPassword = (password) => hash(password, ARGON);
async function checkPassword(storedHash, password) {
  try { return await verify(storedHash, password); } catch { return false; }
}
async function burnTime(password) {
  dummyHash ||= await hashPassword(crypto.randomBytes(16).toString("hex"));
  await checkPassword(dummyHash, password);
}

function passwordProblem(password, email = "") {
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 3 && password.toLowerCase().includes(local)) return "Don’t include your email name in the password.";
  if (/^(.)\1+$/.test(password) || /^(?:0123456789|1234567890|password\d*)$/i.test(password)) return "Choose a less predictable password.";
  return "";
}

// Readable temporary password (no look-alike characters), shown once to the admin.
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(14);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 9)}-${chars.slice(9)}`;
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "strict", secure: config.cookieSecure, path: "/", maxAge: config.sessionMaxHours * 3600 * 1000 };
}

async function createSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(
    "INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, NOW(3) + INTERVAL $3 HOUR, $4, $5)",
    [sha256(token), userId, config.sessionMaxHours, req.ip, String(req.get("user-agent") || "").slice(0, 300)]
  );
  res.cookie(COOKIE, token, cookieOptions());
}

async function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
}

function toUser(row) {
  return {
    id: row.id, email: row.email, fullName: row.full_name, role: row.role,
    centreId: row.centre_id, centreName: row.centre_name || null,
    mustChangePassword: row.must_change_password
  };
}

// Loads req.user from the session cookie; expired or idle sessions are removed.
async function loadSession(req, res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const tokenHash = sha256(token);
  const { rows: [row] } = await query(
    `SELECT s.token_hash, s.expires_at, s.last_seen_at, u.*, c.name AS centre_name
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN centres c ON c.id = u.centre_id
      WHERE s.token_hash = $1`, [tokenHash]);
  const idleLimit = Date.now() - config.sessionIdleMinutes * 60000;
  if (!row || !row.is_active || row.expires_at < new Date() || row.last_seen_at.getTime() < idleLimit) {
    if (row) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    return next();
  }
  if (Date.now() - row.last_seen_at.getTime() > 60000) await query("UPDATE sessions SET last_seen_at = NOW(3) WHERE token_hash = $1", [tokenHash]);
  req.user = toUser(row);
  req.sessionHash = tokenHash;
  next();
}

const PASSWORD_CHANGE_ALLOWED = new Set(["/api/auth/me", "/api/auth/password", "/api/auth/logout"]);
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in.", code: "UNAUTHENTICATED" });
  if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split("?")[0])) {
    return res.status(403).json({ error: "Please set a new password first.", code: "PASSWORD_CHANGE_REQUIRED" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role === "regional_admin") return next();
  audit.log(audit.contextFrom(req), "access.denied", { details: { resource: req.originalUrl.split("?")[0], reason: "this area is for the regional admin only" } })
    .finally(() => res.status(403).json({ error: "Only the regional admin can do this.", code: "FORBIDDEN" }));
}

// Mutating API requests must carry a custom header (which cross-site forms can't set)
// and, when the browser sends one, an Origin matching this host.
function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "dlcf") return res.status(403).json({ error: "Request blocked.", code: "CSRF" });
  const origin = req.get("origin");
  if (origin) {
    let host; try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get("host")) return res.status(403).json({ error: "Request blocked.", code: "CSRF" });
  }
  next();
}

module.exports = { COOKIE, hashPassword, checkPassword, burnTime, passwordProblem, temporaryPassword, createSession, destroySession, loadSession, requireAuth, requireAdmin, csrfGuard, toUser, sha256 };
