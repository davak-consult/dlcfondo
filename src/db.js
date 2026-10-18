const mysql = require("mysql2/promise");
const config = require("./config");

// MySQL/MariaDB pool. Times are stored and read as UTC; DATE columns come back as "YYYY-MM-DD"
// strings and TINYINT(1) columns as booleans.
const raw = mysql.createPool({
  ...config.database,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 30000,
  timezone: "Z",
  dateStrings: ["DATE"],
  decimalNumbers: true,
  charset: "utf8mb4",
  typeCast: (field, next) => {
    if (field.type === "TINY" && field.length === 1) { const value = field.string(); return value === null ? null : value === "1"; }
    return next();
  }
});
raw.pool.on("connection", (connection) => connection.query("SET time_zone = '+00:00'"));

// Queries use PostgreSQL-style $1, $2 … placeholders (a number may repeat); they become MySQL ? placeholders.
function toMysql(text, params = []) {
  const values = [];
  const sql = text.replace(/\$(\d+)/g, (_, n) => { values.push(params[Number(n) - 1]); return "?"; });
  return [sql, values];
}

// Result shape: { rows } for SELECT, { rows: [], rowCount, insertId } for writes.
const run = async (target, text, params) => {
  const [result] = await target.query(...toMysql(text, params));
  return Array.isArray(result) ? { rows: result, rowCount: result.length } : { rows: [], rowCount: result.affectedRows, insertId: result.insertId };
};

const wrap = (connection) => ({ query: (text, params) => run(connection, text, params), release: () => connection.release() });

const pool = {
  query: (text, params) => run(raw, text, params),
  connect: async () => wrap(await raw.getConnection()),
  end: () => raw.end()
};

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("START TRANSACTION");
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

module.exports = { pool, tx, query: pool.query };
