const { Pool, types } = require("pg");
const config = require("./config");

// Return DATE columns as "YYYY-MM-DD" strings instead of local-time Date objects.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30000
});
pool.on("error", (error) => console.error(JSON.stringify({ level: "error", msg: "idle database client error", error: error.message })));

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, query: (text, params) => pool.query(text, params) };
