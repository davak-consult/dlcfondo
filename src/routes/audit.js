const express = require("express");
const { query } = require("../db");
const audit = require("../audit");
const { categories, actionsIn, describe, category } = require("../../public/audit-actions.js");
const { sendCsv } = require("../csv");
const { todayISO } = require("../../public/member-schema.js");

const router = express.Router();
const FIELDS = "seq, ts, user_id, actor_email, actor_name, actor_role, actor_centre, ip, user_agent, action, target_type, target_id, target_label, details, prev_hash, hash";

function filters(req) {
  const where = [], params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q) add(`concat_ws(' ', action, actor_name, actor_email, target_label, details::text) ILIKE ?`, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (req.query.category && categories().includes(req.query.category)) add("action = ANY(?)", actionsIn(req.query.category));
  if (req.query.actor) add("actor_email = ?", String(req.query.actor));
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "")) add("ts >= ?::date", req.query.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "")) add("ts < ?::date + 1", req.query.to);
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

router.get("/", async (req, res) => {
  const { where, params } = filters(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  if (req.query.open === "1") await audit.log(audit.contextFrom(req), "audit.view");
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(`SELECT ${FIELDS} FROM audit_log ${where} ORDER BY seq DESC LIMIT ${limit} OFFSET ${offset}`, params),
    query(`SELECT count(*)::int AS total FROM audit_log ${where}`, params)
  ]);
  res.json({ items: rows.map(audit.rowToEntry), total });
});

router.get("/actors", async (req, res) => {
  const { rows } = await query("SELECT actor_email AS email, max(actor_name) AS name FROM audit_log WHERE actor_email IS NOT NULL GROUP BY actor_email ORDER BY 2");
  res.json({ items: rows, categories: categories() });
});

router.post("/verify", async (req, res) => {
  const result = await audit.verify();
  await audit.log(audit.contextFrom(req), "audit.verify", { details: result.ok ? { ok: true, entries: result.entries } : { ok: false, at: result.at, reason: result.reason } });
  res.json(result);
});

router.get("/export.json", async (req, res) => {
  await audit.log(audit.contextFrom(req), "audit.export", { details: { format: "JSON" } });
  const { rows } = await query(`SELECT ${FIELDS} FROM audit_log ORDER BY seq`);
  const integrity = await audit.verify();
  res.set({ "Content-Disposition": `attachment; filename="dlcf-ondo-audit-${todayISO()}.json"`, "Cache-Control": "no-store" });
  res.json({ exportedAt: new Date().toISOString(), exportedBy: req.user.email, integrity, hashing: "SHA-256 over canonical (sorted-key) JSON of [seq, ts, user_id, actor_email, actor_name, actor_role, actor_centre, ip, user_agent, action, target_type, target_id, target_label, details, prev_hash]", entries: rows.map(audit.rowToEntry) });
});

router.get("/export.csv", async (req, res) => {
  await audit.log(audit.contextFrom(req), "audit.export", { details: { format: "CSV" } });
  const { rows } = await query(`SELECT ${FIELDS} FROM audit_log ORDER BY seq`);
  sendCsv(res, `dlcf-ondo-audit-${todayISO()}.csv`, [
    ["Entry", "Timestamp (UTC)", "Name", "Email", "Role", "Centre", "IP address", "Category", "Action", "Description", "Record type", "Record ID", "Record", "Details", "Previous hash", "Hash"],
    ...rows.map(audit.rowToEntry).map((e) => [e.seq, e.ts, e.actor_name, e.actor_email, e.actor_role, e.actor_centre, e.ip, category(e), e.action, describe(e), e.target_type, e.target_id, e.target_label, JSON.stringify(e.details), e.prev_hash, e.hash])
  ]);
});

module.exports = router;
