// CSV with every cell quoted, and spreadsheet formula injection neutralised
// (cells starting with = + - @ tab or CR are prefixed with an apostrophe).
function cell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const toCsv = (rows) => "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");

function sendCsv(res, filename, rows) {
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" });
  res.send(toCsv(rows));
}

module.exports = { toCsv, sendCsv, cell };
