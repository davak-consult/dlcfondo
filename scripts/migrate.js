const { pool } = require("../src/db");
const { migrate } = require("../src/migrate");

migrate(pool).then(() => pool.end()).catch((error) => { console.error(error.message); process.exit(1); });
