const config = require("./config");
const { pool } = require("./db");
const { migrate } = require("./migrate");
const { createApp } = require("./app");

async function main() {
  if (process.env.MIGRATE_ON_START === "true") await migrate(pool);
  const server = createApp().listen(config.port, () => console.log(JSON.stringify({ level: "info", msg: `DLCF dashboard listening on port ${config.port}` })));
  const shutdown = (signal) => {
    console.log(JSON.stringify({ level: "info", msg: `${signal} received, shutting down` }));
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => { console.error(error); process.exit(1); });
