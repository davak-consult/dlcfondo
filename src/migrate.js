const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "migrations");

// Applies every migrations/*.sql file not yet recorded, each in its own transaction.
async function migrate(pool, log = console.log) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(73910)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));
    const pending = fs.readdirSync(DIR).filter((file) => file.endsWith(".sql")).sort().filter((file) => !applied.has(file));
    for (const file of pending) {
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(DIR, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }
    if (!pending.length) log("database is up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock(73910)").catch(() => {});
    client.release();
  }
}

module.exports = { migrate };
