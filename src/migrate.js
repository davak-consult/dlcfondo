const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "migrations");
const LOCK = "dlcf_migrations";
// Privilege errors that an "-- optional" migration may skip: no TRIGGER privilege (1142, 1227),
// or binary logging requires SUPER to create triggers (1419).
const PRIVILEGE_ERRORS = new Set([1142, 1227, 1419]);

// Splits a migration into statements (one per ";" at the end of a line), dropping comment lines.
const statements = (sql) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
  .split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);

// Applies every migrations/*.sql file not yet recorded. MySQL commits schema changes immediately,
// so a failed migration must be fixed by hand before re-running.
async function migrate(pool, log = console.log) {
  const client = await pool.connect();
  try {
    const { rows: [{ locked }] } = await client.query("SELECT GET_LOCK($1, 60) AS locked", [LOCK]);
    if (locked !== 1) throw new Error("Another migration is running.");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB");
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));
    const pending = fs.readdirSync(DIR).filter((file) => file.endsWith(".sql")).sort().filter((file) => !applied.has(file));
    let changed = false;
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(DIR, file), "utf8");
      try {
        for (const statement of statements(sql)) await client.query(statement);
      } catch (error) {
        if (sql.startsWith("-- optional") && PRIVILEGE_ERRORS.has(error.errno)) {
          log(`skipped ${file}: the database user isn't allowed to do this (${error.message}). It will be retried on the next run.`);
          continue;
        }
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      log(`applied ${file}`);
      changed = true;
    }
    if (!changed && !pending.length) log("database is up to date");
  } finally {
    await client.query("SELECT RELEASE_LOCK($1)", [LOCK]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate, statements };
