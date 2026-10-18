// All runtime settings come from environment variables (see .env.example).
const fs = require("fs");
const path = require("path");

// Hosts such as Hostinger write the settings to a .env file in the app folder instead of setting
// real environment variables. Load it if present; variables already set take precedence.
function loadEnvFile() {
  const file = [path.join(__dirname, "..", ".env"), path.join(process.cwd(), ".env")].find((f) => fs.existsSync(f));
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
if (process.env.NODE_ENV !== "test") loadEnvFile();

const env = process.env;
const isProd = env.NODE_ENV === "production";

function trustProxy(value) {
  if (value === undefined || value === "") return isProd ? 1 : false;
  if (value === "true") return true;
  if (value === "false") return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

// MySQL/MariaDB connection: DATABASE_URL (mysql://user:password@host:port/name), or the separate DB_* settings.
function database() {
  const url = env.DATABASE_URL || (env.DB_NAME || isProd ? "" : "mysql://dlcf:dlcf@127.0.0.1:3307/dlcf");
  if (url) {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1)) };
  }
  if (!env.DB_NAME) return null;
  return { host: env.DB_HOST || "localhost", port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME };
}

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  database: database(),
  databaseSsl: env.DATABASE_SSL === "true",
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd,
  trustProxy: trustProxy(env.TRUST_PROXY),
  sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 30),
  sessionMaxHours: Number(env.SESSION_MAX_HOURS || 12),
  maxFailedLogins: Number(env.MAX_FAILED_LOGINS || 5),
  lockoutMinutes: Number(env.LOCKOUT_MINUTES || 15),
  logRequests: env.LOG_REQUESTS !== "false"
};

if (!config.database) throw new Error("Set DATABASE_URL, or DB_HOST, DB_USER, DB_PASSWORD and DB_NAME, in production.");

module.exports = config;
