const express = require("express");
const { query, tx } = require("../db");
const audit = require("../audit");
const { centres, formOptions, fromRow, toColumns, diff, snapshot, target, clean, recentMonths, memberRow } = require("../members");
const { phoneDigits } = require("../../public/member-schema.js");

const router = express.Router();
const isAdmin = (req) => req.user.role === "regional_admin";

// Campus pastors are always limited to their own centre, whatever the request asks for.
function scopeClause(req, params, requestedCentre) {
  if (!isAdmin(req)) { params.push(req.user.centreId); return `centre_id = $${params.length}`; }
  if (requestedCentre) { params.push(requestedCentre); return `centre_id = $${params.length}`; }
  return "TRUE";
}

async function denied(req, reason, resource) {
  await audit.log(audit.contextFrom(req), "access.denied", { details: { resource, reason } });
}

// Loads a live member the current user may access, or sends 404 (never revealing other centres' records).
async function loadMember(req, res, client = null, lock = false) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(404).json({ error: "Member not found." }); return null; }
  const run = client ? client.query.bind(client) : query;
  const { rows: [row] } = await run(`SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`, [id]);
  if (row && !isAdmin(req) && row.centre_id !== req.user.centreId) {
    await denied(req, `campus pastors can only open members of their own centre (member #${id})`, `member #${id}`);
    res.status(404).json({ error: "Member not found." });
    return null;
  }
  if (!row) { res.status(404).json({ error: "Member not found." }); return null; }
  return fromRow(row, await centres());
}

router.get("/", async (req, res) => {
  const params = [];
  const centreId = req.query.centreId ? Number(req.query.centreId) : null;
  const where = [`deleted_at IS NULL`, `approval = 'approved'`, scopeClause(req, params, centreId)];
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`concat_ws(' ', first_name, other_names, surname, programme, position, department, staff_department, matric_no, phone, email) LIKE $${params.length}`);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filter = where.join(" AND ");
  const [{ rows }, { rows: [count] }] = await Promise.all([
    query(`SELECT * FROM members WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params),
    query(`SELECT count(*) AS total FROM members WHERE ${filter}`, params)
  ]);
  const list = await centres();
  const total = count.total;
  const ctx = audit.contextFrom(req);
  if (q && offset === 0) await audit.log(ctx, "directory.search", { details: { query: q, results: total } });
  if (centreId && isAdmin(req) && offset === 0 && req.query.logFilter === "1") await audit.log(ctx, "directory.filter", { details: { centre: list.find((c) => c.id === centreId)?.name || `centre ${centreId}` } });
  res.json({ items: rows.map((row) => fromRow(row, list)), total });
});

router.get("/stats", async (req, res) => {
  const params = [];
  const scope = scopeClause(req, params);
  const where = `deleted_at IS NULL AND approval = 'approved' AND ${scope}`;
  const { rows: [{ pending }] } = await query(`SELECT count(*) AS pending FROM members WHERE deleted_at IS NULL AND approval = 'pending' AND ${scope}`, params);
  const { rows: byCentre } = await query(`SELECT centre_id, count(*) AS total, CAST(SUM(role = 'Staff') AS SIGNED) AS staff FROM members WHERE ${where} GROUP BY centre_id`, params);
  // Running total of members at the end of each of the last six months.
  const { rows: joined } = await query(`SELECT DATE_FORMAT(date_joined, '%Y-%m') AS month, count(*) AS n FROM members WHERE ${where} GROUP BY month`, params);
  const monthly = recentMonths(6).map((month) => ({ month, total: joined.filter((r) => r.month <= month).reduce((sum, r) => sum + r.n, 0) }));
  const list = (await centres()).filter((c) => isAdmin(req) || c.id === req.user.centreId);
  const centreStats = list.map((c) => { const row = byCentre.find((r) => r.centre_id === c.id) || { total: 0, staff: 0 }; return { ...c, total: row.total, staff: row.staff }; });
  const total = centreStats.reduce((sum, c) => sum + c.total, 0), staff = centreStats.reduce((sum, c) => sum + c.staff, 0);
  res.json({ total, staff, students: total - staff, pending, centres: centreStats, monthly });
});

// The stored phone number without spaces, dashes, brackets or dots, and with +234/234 written as 0 (as phoneDigits does).
const STRIPPED_PHONE = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')";
const NORMALISED_PHONE = `CASE WHEN ${STRIPPED_PHONE} LIKE '+234%' THEN CONCAT('0', SUBSTRING(${STRIPPED_PHONE}, 5))
  WHEN ${STRIPPED_PHONE} LIKE '234%' THEN CONCAT('0', SUBSTRING(${STRIPPED_PHONE}, 4)) ELSE ${STRIPPED_PHONE} END`;

// Warns about likely duplicates before saving. Campus pastors don't see names from other centres.
router.post("/duplicates", async (req, res) => {
  const phone = phoneDigits(req.body?.phone).replace(/^\+?234/, "0");
  const email = String(req.body?.email || "").trim().toLowerCase();
  const matric = String(req.body?.matricNo || "").trim().toUpperCase();
  const excludeId = Number(req.body?.excludeId) || 0;
  if (!phone && !email && !matric) return res.json({ matches: [] });
  const { rows } = await query(
    `SELECT * FROM members WHERE deleted_at IS NULL AND id <> $1 AND (
       ($2 <> '' AND ${NORMALISED_PHONE} = $2)
       OR ($3 <> '' AND lower(email) = $3) OR ($4 <> '' AND upper(matric_no) = $4)) LIMIT 5`, [excludeId, phone, email, matric]);
  const list = await centres();
  res.json({ matches: rows.map((row) => {
    const m = fromRow(row, list);
    const reasons = [];
    if (phone && phoneDigits(m.phone).replace(/^\+?234/, "0") === phone) reasons.push("phone number");
    if (email && m.email.toLowerCase() === email) reasons.push("email");
    if (matric && m.matricNo.toUpperCase() === matric) reasons.push("matric number");
    const visible = isAdmin(req) || m.centreId === req.user.centreId;
    return { name: visible ? m.name : "A member", centre: m.centre, reasons };
  }) });
});

// Registrations from the public page waiting for approval, within the user's scope.
router.get("/pending", async (req, res) => {
  const params = [];
  const { rows } = await query(`SELECT * FROM members WHERE deleted_at IS NULL AND approval = 'pending' AND ${scopeClause(req, params)} ORDER BY created_at, id`, params);
  const list = await centres();
  res.json({ items: rows.map((row) => fromRow(row, list)) });
});

async function decide(req, res, decision) {
  const result = await tx(async (client) => {
    const member = await loadMember(req, res, client, true); if (!member) return null;
    if (member.approval !== "pending") { res.status(409).json({ error: `${member.name} has already been ${member.approval}.` }); return null; }
    if (decision === "approve") {
      await client.query("UPDATE members SET approval = 'approved', approved_at = NOW(3), approved_by = $1, updated_at = NOW(3), updated_by = $1 WHERE id = $2", [req.user.id, member.id]);
      await audit.record(client, audit.contextFrom(req), "member.approve", { target: target(member), details: { centre: member.centre } });
    } else {
      await client.query("UPDATE members SET approval = 'rejected', deleted_at = NOW(3), deleted_by = $1 WHERE id = $2", [req.user.id, member.id]);
      const reason = String(req.body?.reason || "").trim().slice(0, 300);
      await audit.record(client, audit.contextFrom(req), "member.reject", { target: target(member), details: { centre: member.centre, ...(reason && { reason }), snapshot: snapshot(member) } });
    }
    return member;
  });
  if (result) res.json({ ok: true, name: result.name, centre: result.centre });
}
router.post("/:id/approve", (req, res) => decide(req, res, "approve"));
router.post("/:id/reject", (req, res) => decide(req, res, "reject"));

router.get("/:id", async (req, res) => {
  const member = await loadMember(req, res); if (!member) return;
  await audit.log(audit.contextFrom(req), "member.view", { target: target(member) });
  res.json(member);
});

router.get("/:id/history", async (req, res) => {
  const member = await loadMember(req, res); if (!member) return;
  const { rows } = await query(
    `SELECT seq, ts, actor_name, actor_email, action, target_label, details FROM audit_log
      WHERE target_type = 'member' AND target_id = $1 AND action <> 'member.view' ORDER BY seq DESC LIMIT 20`, [String(member.id)]);
  res.json({ items: rows.map(audit.rowToEntry) });
});

async function cleanFor(req, res, body) {
  const list = await centres();
  const allowed = isAdmin(req) ? list : list.filter((c) => c.id === req.user.centreId);
  const { data, errors } = clean(body, formOptions(allowed));
  if (Object.keys(errors).length) {
    const elsewhere = list.some((c) => c.institution === body?.institution && c.name === body?.centre);
    if ((errors.institution || errors.centre) && !isAdmin(req) && elsewhere) await denied(req, "campus pastors can only add members to their own centre", "members");
    res.status(400).json({ error: "Some details need attention.", errors });
    return null;
  }
  return { data, centre: list.find((c) => c.institution === data.institution && c.name === data.centre) };
}

router.post("/", async (req, res) => {
  const cleaned = await cleanFor(req, res, req.body); if (!cleaned) return;
  const { columns, values } = toColumns(cleaned.data, cleaned.centre.id);
  const member = await tx(async (client) => {
    const { insertId } = await client.query(
      `INSERT INTO members (${columns.join(", ")}, created_by, updated_by) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}, $${values.length + 1}, $${values.length + 1})`,
      [...values, req.user.id]);
    const created = fromRow(await memberRow(client, insertId), await centres());
    await audit.record(client, audit.contextFrom(req), "member.create", { target: target(created), details: { centre: created.centre, role: created.role } });
    return created;
  });
  res.status(201).json(member);
});

router.put("/:id", async (req, res) => {
  const cleaned = await cleanFor(req, res, req.body); if (!cleaned) return;
  const result = await tx(async (client) => {
    const before = await loadMember(req, res, client, true); if (!before) return null;
    // Optimistic concurrency: refuse to overwrite someone else's newer save.
    if (req.body.updatedAt && req.body.updatedAt !== before.updatedAt) {
      res.status(409).json({ error: "Someone else updated this member while you were editing. Reload to see their changes.", code: "CONFLICT" });
      return null;
    }
    const { columns, values } = toColumns(cleaned.data, cleaned.centre.id);
    const sets = columns.map((column, i) => `${column} = $${i + 1}`);
    await client.query(
      `UPDATE members SET ${sets.join(", ")}, updated_at = NOW(3), updated_by = $${values.length + 1} WHERE id = $${values.length + 2}`,
      [...values, req.user.id, before.id]);
    const after = fromRow(await memberRow(client, before.id), await centres());
    await audit.record(client, audit.contextFrom(req), "member.update", { target: target(after), details: { changes: diff(before, after) } });
    return after;
  });
  if (result) res.json(result);
});

router.delete("/:id", async (req, res) => {
  const removed = await tx(async (client) => {
    const member = await loadMember(req, res, client, true); if (!member) return null;
    await client.query("UPDATE members SET deleted_at = NOW(3), deleted_by = $1 WHERE id = $2", [req.user.id, member.id]);
    await audit.record(client, audit.contextFrom(req), "member.delete", { target: target(member), details: { centre: member.centre, snapshot: snapshot(member) } });
    return member;
  });
  if (removed) res.status(204).end();
});

module.exports = router;
