// Creates a regional admin account. Usage:
//   npm run create-admin -- --email pastor@example.com --name "Pastor Name"
// Prints a one-time temporary password; the admin must change it at first sign-in.
const { pool } = require("../src/db");
const { createAdmin } = require("../src/admin");

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : ""; };

async function main() {
  const email = String(arg("email")).trim().toLowerCase(), name = String(arg("name")).trim();
  if (!email || !name) throw new Error('Usage: npm run create-admin -- --email you@example.com --name "Full Name"');
  const password = await createAdmin({ email, name, source: "create-admin script" });
  console.log(`\nCreated regional admin ${name} <${email}>.\nTemporary password: ${password}\nThey will be asked to choose a new password at first sign-in.\n`);
}

main().then(() => pool.end()).catch((error) => { console.error(error.message); pool.end(); process.exit(1); });
