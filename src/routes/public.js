// Public self-registration (no sign-in). Registrations wait for the centre's pastor or the
// regional admin to approve them before they appear in the directory.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { tx } = require("../db");
const audit = require("../audit");
const { centres, formOptions, fromRow, toColumns, target, clean, memberRow } = require("../members");
const { FIELDS } = require("../../public/member-schema.js");

const router = express.Router();
const STAFF_ONLY = FIELDS.filter((f) => f.staffOnly).map((f) => f.key);
const registerLimiter = rateLimit({
  windowMs: 60 * 60000, limit: Number(process.env.REGISTRATIONS_PER_HOUR || 10), standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many registrations from this network. Please try again in an hour." }
});

// Institutions and the fellowship centres under each (names only).
router.get("/centres", async (req, res) => {
  res.json(formOptions(await centres()));
});

router.post("/register", registerLimiter, async (req, res) => {
  const body = { ...(req.body || {}) };
  // Hidden field that people never see; bots that fill it get a normal-looking reply and nothing is saved.
  if (body.website) return res.status(201).json({ ok: true, centre: String(body.centre || "") });
  if (body.consent !== true) return res.status(400).json({ error: "Please confirm consent before submitting.", errors: { consent: "Please confirm consent before submitting." } });
  STAFF_ONLY.forEach((key) => { delete body[key]; });
  body.status = "New member";
  const list = await centres();
  const { data, errors } = clean(body, formOptions(list));
  if (Object.keys(errors).length) return res.status(400).json({ error: "Some details need attention.", errors });
  const centre = list.find((c) => c.institution === data.institution && c.name === data.centre);
  const { columns, values } = toColumns(data, centre.id);
  await tx(async (client) => {
    const { insertId } = await client.query(
      `INSERT INTO members (${columns.join(", ")}, approval) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}, 'pending')`, values);
    const member = fromRow(await memberRow(client, insertId), list);
    await audit.record(client, audit.contextFrom(req), "member.register", { target: target(member), details: { centre: member.centre } });
  });
  res.status(201).json({ ok: true, centre: centre.name, institution: centre.institution });
});

module.exports = router;
