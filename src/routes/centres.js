// Fellowship centres under each institution (regional admin only).
const express = require("express");
const { query, tx } = require("../db");
const audit = require("../audit");
const { centres, clearCentreCache, institutionList } = require("../members");

const router = express.Router();
const target = (centre) => ({ type: "centre", id: centre.id, label: centre.name });

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 120 ? { name } : { error: "Enter a centre name (2–120 characters)." };
}
const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "centre";
const duplicate = (res, name, institution) => res.status(400).json({ error: `${institution} already has a centre called “${name}”.`, errors: { name: `${institution} already has a centre with this name.` } });

// Every institution with its centres, plus how many live members and active pastors each centre has.
router.get("/", async (req, res) => {
  const [list, insts, { rows: memberCounts }, { rows: pastorCounts }] = await Promise.all([
    centres(), institutionList(),
    query("SELECT centre_id, count(*) AS n FROM members WHERE deleted_at IS NULL GROUP BY centre_id"),
    query("SELECT centre_id, count(*) AS n FROM users WHERE role = 'campus_pastor' AND is_active GROUP BY centre_id")
  ]);
  const count = (rows, id) => rows.find((r) => r.centre_id === id)?.n || 0;
  res.json({
    institutions: insts,
    centres: list.map((c) => ({ ...c, members: count(memberCounts, c.id), pastors: count(pastorCounts, c.id) }))
  });
});

router.post("/", async (req, res) => {
  const institution = (await institutionList()).find((i) => i.id === Number(req.body?.institutionId));
  const { name, error } = cleanName(req.body?.name);
  const errors = { ...(!institution && { institutionId: "Choose an institution." }), ...(error && { name: error }) };
  if (Object.keys(errors).length) return res.status(400).json({ error: "Some details need attention.", errors });
  if ((await centres()).some((c) => c.institutionId === institution.id && c.name.toLowerCase() === name.toLowerCase())) return duplicate(res, name, institution.shortName);
  const taken = new Set((await query("SELECT code FROM centres")).rows.map((r) => r.code));
  const base = `${institution.code}-${slug(name)}`;
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
  const centre = await tx(async (client) => {
    const { insertId } = await client.query("INSERT INTO centres (code, name, institution_id) VALUES ($1, $2, $3)", [code, name, institution.id]);
    const created = { id: insertId, code, name, institutionId: institution.id, institution: institution.name };
    await audit.record(client, audit.contextFrom(req), "centre.create", { target: target(created), details: { institution: institution.name } });
    return created;
  });
  clearCentreCache();
  res.status(201).json({ centre });
});

router.patch("/:id", async (req, res) => {
  const before = (await centres()).find((c) => c.id === Number(req.params.id));
  if (!before) return res.status(404).json({ error: "Centre not found." });
  const { name, error } = cleanName(req.body?.name);
  if (error) return res.status(400).json({ error, errors: { name: error } });
  if ((await centres()).some((c) => c.id !== before.id && c.institutionId === before.institutionId && c.name.toLowerCase() === name.toLowerCase())) return duplicate(res, name, before.institutionShort);
  await tx(async (client) => {
    await client.query("UPDATE centres SET name = $1 WHERE id = $2", [name, before.id]);
    await audit.record(client, audit.contextFrom(req), "centre.update", { target: target({ id: before.id, name }), details: { institution: before.institution, from: before.name, to: name } });
  });
  clearCentreCache();
  res.json({ centre: { ...before, name } });
});

// Only centres nobody has ever been assigned to can be removed, so records and history stay intact.
router.delete("/:id", async (req, res) => {
  const centre = (await centres()).find((c) => c.id === Number(req.params.id));
  if (!centre) return res.status(404).json({ error: "Centre not found." });
  const result = await tx(async (client) => {
    const { rows: [{ members }] } = await client.query("SELECT count(*) AS members FROM members WHERE centre_id = $1", [centre.id]);
    const { rows: [{ users }] } = await client.query("SELECT count(*) AS users FROM users WHERE centre_id = $1", [centre.id]);
    if (members || users) return { blocked: true, members, users };
    await client.query("DELETE FROM centres WHERE id = $1", [centre.id]);
    await audit.record(client, audit.contextFrom(req), "centre.delete", { target: target(centre), details: { institution: centre.institution } });
    return { blocked: false };
  });
  if (result.blocked) {
    const parts = [result.members && `${result.members} member record${result.members === 1 ? "" : "s"}`, result.users && `${result.users} user account${result.users === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    return res.status(409).json({ error: `${centre.name} can’t be removed because it has ${parts} (including removed or deactivated ones). Rename it instead, or move them to another centre first.` });
  }
  clearCentreCache();
  res.status(204).end();
});

module.exports = router;
