// Re-checks the whole audit chain from the command line (e.g. from a nightly cron job).
// Exits with code 1 if any entry was altered, removed or reordered.
const { pool } = require("../src/db");
const audit = require("../src/audit");

audit.verify().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  return pool.end().then(() => process.exit(result.ok ? 0 : 1));
}).catch((error) => { console.error(error.message); process.exit(2); });
