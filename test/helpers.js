// Tests run against a real MariaDB/MySQL database (docker compose up -d db) named dlcf_test.
process.env.DATABASE_URL ||= "mysql://dlcf:dlcf@127.0.0.1:3307/dlcf_test";
process.env.LOG_REQUESTS = "false";
process.env.COOKIE_SECURE = "false";

const request = require("supertest");
const { pool } = require("../src/db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { migrate, statements } = require("../src/migrate");
const { createApp } = require("../src/create-app");
const auth = require("../src/auth");
const audit = require("../src/audit");

const app = createApp();
const PASSWORD = "Correct-Horse-42";

async function resetDatabase() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()");
    await client.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { name } of rows) await client.query(`DROP TABLE \`${name}\``);
    await client.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally { client.release(); }
  await migrate(pool, () => {});
}

async function applyMigration(file) {
  for (const statement of statements(fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8"))) await pool.query(statement);
}

async function createUser({ email, name = "Test User", role = "regional_admin", centreId = null, password = PASSWORD, mustChange = false }) {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, email, full_name, role, centre_id, password_hash, must_change_password) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, email, name, role, centreId, await auth.hashPassword(password), mustChange]);
  return (await pool.query("SELECT * FROM users WHERE id = $1", [id])).rows[0];
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
  role: "Student", institution: "University of Medical Sciences", centre: "UNIMED Centre", faculty: "Nursing Sciences", department: "Nursing", programme: "B.NSc Nursing", level: "300 level",
  status: "New member", isWorker: "No", dateJoined: "2026-09-01", kinName: "Mr Okafor", kinRelationship: "Father", kinPhone: "08051112233", ...overrides
});

const auditActions = async () => (await pool.query("SELECT action FROM audit_log ORDER BY seq")).rows.map((r) => r.action);
const lastAudit = async () => audit.rowToEntry((await pool.query("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1")).rows[0]);

module.exports = { app, pool, request, resetDatabase, applyMigration, createUser, client, signedIn, validMember, auditActions, lastAudit, PASSWORD };
