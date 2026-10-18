const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { query } = require("./db");
const auth = require("./auth");

function requestLogger(req, res, next) {
  if (!config.logRequests || !req.path.startsWith("/api")) return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => console.log(JSON.stringify({
    level: res.statusCode >= 500 ? "error" : "info", time: new Date().toISOString(), method: req.method, path: req.path,
    status: res.statusCode, ms: Number(process.hrtime.bigint() - start) / 1e6, user: req.user?.id || null, ip: req.ip
  })));
  next();
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"],
      formAction: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
      upgradeInsecureRequests: config.cookieSecure ? [] : null
    } },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));

  app.get("/healthz", async (req, res) => {
    // Reports only the error code (e.g. ER_ACCESS_DENIED_ERROR, ER_NO_SUCH_TABLE), never connection details.
    try { await query("SELECT 1 FROM schema_migrations LIMIT 1"); res.json({ ok: true }); } catch (error) { res.status(503).json({ ok: false, error: error.code || "DATABASE_ERROR" }); }
  });

  const api = express.Router();
  api.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  api.use(auth.csrfGuard);
  api.use(auth.loadSession);
  api.use(requestLogger);
  api.use("/auth", require("./routes/auth"));
  api.use("/members", auth.requireAuth, require("./routes/members"));
  api.use("/reports", auth.requireAuth, require("./routes/reports"));
  api.use("/events", auth.requireAuth, require("./routes/events"));
  api.use("/users", auth.requireAuth, auth.requireAdmin, require("./routes/users"));
  api.use("/centres", auth.requireAuth, auth.requireAdmin, require("./routes/centres"));
  api.use("/audit", auth.requireAuth, auth.requireAdmin, require("./routes/audit"));
  api.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use("/api", api);

  app.use(express.static(path.join(__dirname, "..", "public"), {
    setHeaders: (res, file) => res.set("Cache-Control", file.endsWith(".html") ? "no-cache" : "public, max-age=3600")
  }));

  // Errors: details go to the server log, never to the browser.
  app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "The request body isn’t valid JSON." });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "The request is too large." });
    console.error(JSON.stringify({ level: "error", time: new Date().toISOString(), method: req.method, path: req.path, error: error.message, stack: error.stack }));
    if (res.headersSent) return next(error);
    res.status(500).json({ error: "Something went wrong on our side. Please try again." });
  });
  return app;
}

module.exports = { createApp };
