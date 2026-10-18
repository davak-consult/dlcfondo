// Creates the first regional admin account. Usage:
//   npm run create-admin -- --email pastor@example.com --name "Pastor Name"
// Prints a one-time temporary password; the admin must change it at first sign-in.
const { pool, tx } = require("../src/db");
const auth = require("../src/auth");
const audit = require("../src/audit");

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : ""; };

async function main() {
  const email = String(arg("email")).trim().toLowerCase();
  const name = String(arg("name")).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !name) throw new Error('Usage: npm run create-admin -- --email you@example.com --name "Full Name"');
  const { rows: [existing] } = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
  if (existing) throw new Error(`An account for ${email} already exists. Use the dashboard to reset its password.`);
  const password = auth.temporaryPassword();
  const passwordHash = await auth.hashPassword(password);
  await tx(async (client) => {
    const { rows: [row] } = await client.query("INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, 'regional_admin', $3) RETURNING *", [email, name, passwordHash]);
    await audit.record(client, { ip: "command line", userAgent: "create-admin script" }, "user.create", { target: { type: "user", id: row.id, label: name }, details: { email, role: "Regional admin", centre: "All centres" } });
  });
  console.log(`\nCreated regional admin ${name} <${email}>.\nTemporary password: ${password}\nThey will be asked to choose a new password at first sign-in.\n`);
}

main().then(() => pool.end()).catch((error) => { console.error(error.message); pool.end(); process.exit(1); });
