// Creates a regional admin with a one-time temporary password (they must change it at first sign-in).
const crypto = require("crypto");
const { pool, tx } = require("./db");
const auth = require("./auth");
const audit = require("./audit");

async function createAdmin({ email, name, source }) {
  email = String(email || "").trim().toLowerCase();
  name = String(name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !name) throw new Error("A valid email and full name are required.");
  const { rows: [existing] } = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
  if (existing) throw new Error(`An account for ${email} already exists. Use the dashboard to reset its password.`);
  const password = auth.temporaryPassword();
  const passwordHash = await auth.hashPassword(password);
  await tx(async (client) => {
    const id = crypto.randomUUID();
    await client.query("INSERT INTO users (id, email, full_name, role, password_hash) VALUES ($1, $2, $3, 'regional_admin', $4)", [id, email, name, passwordHash]);
    await audit.record(client, { ip: source, userAgent: source }, "user.create", { target: { type: "user", id, label: name }, details: { email, role: "Regional admin", centre: "All centres" } });
  });
  return password;
}

// On a brand-new install with ADMIN_EMAIL and ADMIN_NAME set, creates the first admin and prints the
// temporary password to the server log. Does nothing once any account exists.
async function bootstrapAdmin(log = console.log) {
  if (!process.env.ADMIN_EMAIL) return;
  const { rows: [{ count }] } = await pool.query("SELECT count(*) AS count FROM users");
  if (count) return;
  const password = await createAdmin({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, source: "first start-up" });
  log(`Created the first regional admin <${process.env.ADMIN_EMAIL.trim().toLowerCase()}>. Temporary password: ${password} (must be changed at first sign-in; you can now remove ADMIN_EMAIL and ADMIN_NAME).`);
}

module.exports = { createAdmin, bootstrapAdmin };
