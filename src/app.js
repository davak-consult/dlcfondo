// Entry point: starts the HTTP server (src/server.js loads this file too).
const config = require("./config");
const { pool } = require("./db");
const { migrate } = require("./migrate");
const { bootstrapAdmin } = require("./admin");
const { createApp } = require("./create-app");

// Migrations run after the server is listening, retrying every 30 seconds until they succeed,
// so a database problem shows up on /healthz instead of as a host timeout.
async function migrateWithRetry() {
  try {
    await migrate(pool);
    await bootstrapAdmin();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "database setup failed, retrying in 30s", code: error.code || null, error: error.message }));
    setTimeout(migrateWithRetry, 30000).unref();
  }
}

async function main() {
  const server = createApp().listen(config.port, () => console.log(JSON.stringify({ level: "info", msg: `DLCF dashboard listening on port ${config.port}` })));
  if (process.env.MIGRATE_ON_START === "true") migrateWithRetry();
  const shutdown = (signal) => {
    console.log(JSON.stringify({ level: "info", msg: `${signal} received, shutting down` }));
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => { console.error(error); process.exit(1); });
