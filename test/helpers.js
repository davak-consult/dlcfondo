// Tests run against a real PostgreSQL database (docker compose up -d db) named dlcf_test.
process.env.DATABASE_URL ||= "postgres://dlcf:dlcf@localhost:5433/dlcf_test";
process.env.LOG_REQUESTS = "false";
process.env.COOKIE_SECURE = "false";

const request = require("supertest");
const { pool } = require("../src/db");
const { migrate } = require("../src/migrate");
const { createApp } = require("../src/app");
const auth = require("../src/auth");

const app = createApp();
const PASSWORD = "Correct-Horse-42";

async function resetDatabase() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool, () => {});
}

async function createUser({ email, name = "Test User", role = "regional_admin", centreId = null, password = PASSWORD, mustChange = false }) {
  const { rows: [row] } = await pool.query(
    "INSERT INTO users (email, full_name, role, centre_id, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [email, name, role, centreId, await auth.hashPassword(password), mustChange]);
  return row;
}

// A supertest agent that keeps cookies and sends the anti-CSRF header.
function client() {
  const agent = request.agent(app);
  const wrap = (method) => (url) => agent[method](url).set("X-Requested-With", "dlcf");
  return { get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), delete: wrap("delete"), raw: agent };
}
async function signedIn(email, password = PASSWORD) {
  const c = client();
  const res = await c.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

const validMember = (overrides = {}) => ({
  firstName: "Adaeze", surname: "Okafor", gender: "Female", phone: "08031234567",
  role: "Student", institution: "University of Medical Sciences", department: "Nursing", programme: "B.NSc Nursing", level: "300 level",
  status: "New member", dateJoined: "2026-09-01", kinName: "Mr Okafor", kinRelationship: "Father", kinPhone: "08051112233", ...overrides
});

const auditActions = async () => (await pool.query("SELECT action FROM audit_log ORDER BY seq")).rows.map((r) => r.action);
const lastAudit = async () => (await pool.query("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1")).rows[0];

module.exports = { app, pool, request, resetDatabase, createUser, client, signedIn, validMember, auditActions, lastAudit, PASSWORD };
