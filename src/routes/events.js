// Lets the browser record UI-only activity (page visits, help, printing). Only listed actions are accepted.
const express = require("express");
const rateLimit = require("express-rate-limit");
const audit = require("../audit");
const { CLIENT_EVENTS } = require("../../public/audit-actions.js");

const router = express.Router();
const VIEWS = ["Overview", "Members", "Fellowship centres", "Reports", "Audit log", "Users"];
router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));

router.post("/", async (req, res) => {
  const action = req.body?.action;
  if (!CLIENT_EVENTS.includes(action)) return res.status(400).json({ error: "Unknown event." });
  const details = {};
  if (action === "nav.view" || action === "export.print") {
    if (!VIEWS.includes(req.body?.view)) return res.status(400).json({ error: "Unknown view." });
    details.view = req.body.view;
  }
  await audit.log(audit.contextFrom(req), action, { details });
  res.status(204).end();
});

module.exports = router;
