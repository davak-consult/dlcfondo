const express = require("express");
const { query } = require("../db");
const audit = require("../audit");
const { centres, fromRow } = require("../members");
const { FIELDS, groupLabel, todayISO } = require("../../public/member-schema.js");
const { sendCsv } = require("../csv");

const router = express.Router();
const scope = (req) => req.user.role === "regional_admin" ? { where: "TRUE", params: [] } : { where: "centre_id = $1", params: [req.user.centreId] };

router.get("/members.csv", async (req, res) => {
  const { where, params } = scope(req);
  const { rows } = await query(`SELECT * FROM members WHERE deleted_at IS NULL AND ${where} ORDER BY centre_id, surname, first_name`, params);
  const list = await centres();
  const columns = FIELDS.filter((f) => f.type !== "checkbox");
  const members = rows.map((row) => fromRow(row, list));
  await audit.log(audit.contextFrom(req), "export.csv", { details: { report: "the member directory", rows: members.length } });
  sendCsv(res, `dlcf-ondo-members-${todayISO()}.csv`, [
    ["Member ID", "Full name", "Centre", ...columns.map(groupLabel), "Record created", "Last updated"],
    ...members.map((m) => [m.id, m.name, m.centre, ...columns.map((f) => m[f.key]), m.createdAt.slice(0, 10), m.updatedAt.slice(0, 10)])
  ]);
});

router.get("/monthly.csv", async (req, res) => {
  const { where, params } = scope(req);
  const list = (await centres()).filter((c) => req.user.role === "regional_admin" || c.id === req.user.centreId);
  const { rows } = await query(
    `SELECT to_char(m, 'YYYY-MM') AS month, c.id AS centre_id,
            (SELECT count(*)::int FROM members WHERE deleted_at IS NULL AND ${where} AND centre_id = c.id AND date_joined >= m AND date_joined < m + interval '1 month') AS joined
       FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m
       CROSS JOIN centres c ORDER BY m, c.id`, params);
  const months = [...new Set(rows.map((r) => r.month))];
  const body = months.map((month) => {
    const counts = list.map((c) => rows.find((r) => r.month === month && r.centre_id === c.id)?.joined || 0);
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    return [label, ...counts, counts.reduce((a, b) => a + b, 0)];
  });
  const { rows: totals } = await query(`SELECT centre_id, count(*)::int AS total FROM members WHERE deleted_at IS NULL AND ${where} GROUP BY centre_id`, params);
  const totalRow = list.map((c) => totals.find((t) => t.centre_id === c.id)?.total || 0);
  await audit.log(audit.contextFrom(req), "export.csv", { details: { report: "the monthly membership overview", rows: body.length + 1 } });
  sendCsv(res, `dlcf-ondo-monthly-${todayISO()}.csv`, [["Month", ...list.map((c) => `${c.name} — joined`), "Total joined"], ...body, ["Current total", ...totalRow, totalRow.reduce((a, b) => a + b, 0)]]);
});

module.exports = router;
