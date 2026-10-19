const express = require("express");
const { query } = require("../db");
const audit = require("../audit");
const { centres, fromRow, recentMonths } = require("../members");
const { FIELDS, groupLabel, todayISO } = require("../../public/member-schema.js");
const { sendCsv } = require("../csv");

const router = express.Router();
const { scopeWhere, visibleCentres } = require("../scope");
const scope = (req) => { const params = []; return { where: scopeWhere(req.user, params), params }; };

router.get("/members.csv", async (req, res) => {
  const { where, params } = scope(req);
  const { rows } = await query(`SELECT * FROM members WHERE deleted_at IS NULL AND approval = 'approved' AND ${where} ORDER BY centre_id, surname, first_name`, params);
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
  const list = visibleCentres(req.user, await centres());
  const months = recentMonths(12);
  const { rows } = await query(
    `SELECT DATE_FORMAT(date_joined, '%Y-%m') AS month, centre_id, count(*) AS joined FROM members
      WHERE deleted_at IS NULL AND approval = 'approved' AND ${where} AND date_joined >= '${months[0]}-01' GROUP BY month, centre_id`, params);
  const body = months.map((month) => {
    const counts = list.map((c) => rows.find((r) => r.month === month && r.centre_id === c.id)?.joined || 0);
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    return [label, ...counts, counts.reduce((a, b) => a + b, 0)];
  });
  const { rows: totals } = await query(`SELECT centre_id, count(*) AS total FROM members WHERE deleted_at IS NULL AND approval = 'approved' AND ${where} GROUP BY centre_id`, params);
  const totalRow = list.map((c) => totals.find((t) => t.centre_id === c.id)?.total || 0);
  await audit.log(audit.contextFrom(req), "export.csv", { details: { report: "the monthly membership overview", rows: body.length + 1 } });
  sendCsv(res, `dlcf-ondo-monthly-${todayISO()}.csv`, [["Month", ...list.map((c) => `${c.name} — joined`), "Total joined"], ...body, ["Current total", ...totalRow, totalRow.reduce((a, b) => a + b, 0)]]);
});

module.exports = router;
