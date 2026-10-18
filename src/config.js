// All runtime settings come from environment variables (see .env.example).
const env = process.env;
const isProd = env.NODE_ENV === "production";

function trustProxy(value) {
  if (value === undefined || value === "") return isProd ? 1 : false;
  if (value === "true") return true;
  if (value === "false") return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || (isProd ? "" : "postgres://dlcf:dlcf@localhost:5433/dlcf"),
  databaseSsl: env.DATABASE_SSL === "true",
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd,
  trustProxy: trustProxy(env.TRUST_PROXY),
  sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 30),
  sessionMaxHours: Number(env.SESSION_MAX_HOURS || 12),
  maxFailedLogins: Number(env.MAX_FAILED_LOGINS || 5),
  lockoutMinutes: Number(env.LOCKOUT_MINUTES || 15),
  logRequests: env.LOG_REQUESTS !== "false"
};

if (!config.databaseUrl) throw new Error("DATABASE_URL must be set in production.");

module.exports = config;
