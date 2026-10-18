// Server-side audit log. Entries are written inside the same transaction as the change they
// describe, serialised with an advisory lock, and chained: each hash covers the entry's contents
// plus the previous entry's hash. The database rejects UPDATE/DELETE/TRUNCATE on audit_log.
const crypto = require("crypto");
const { tx, pool } = require("./db");

const CHAIN_LOCK = 482901;
const GENESIS = "GENESIS";
const COLUMNS = ["seq", "ts", "user_id", "actor_email", "actor_name", "actor_role", "actor_centre", "ip", "user_agent", "action", "target_type", "target_id", "target_label", "details", "prev_hash"];

// JSON with sorted keys, so the hash doesn't depend on how PostgreSQL orders jsonb keys.
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
const hashEntry = (entry) => crypto.createHash("sha256").update(canonical(COLUMNS.map((column) => entry[column]))).digest("hex");

function contextFrom(req) {
  return { user: req.user || null, ip: req.ip || null, userAgent: String(req.get?.("user-agent") || "").slice(0, 300) || null };
}

async function record(client, ctx, action, { target = null, details = {}, actor = null } = {}) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK]);
  const { rows: [last] } = await client.query("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const user = actor || ctx.user;
  const entry = {
    seq: last ? Number(last.seq) + 1 : 1,
    ts: new Date().toISOString(),
    user_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    actor_name: user?.fullName ?? null,
    actor_role: user ? (user.role === "regional_admin" ? "Regional admin" : "Campus pastor") : null,
    actor_centre: user?.centreName ?? null,
    ip: ctx.ip ?? null,
    user_agent: ctx.userAgent ?? null,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id != null ? String(target.id) : null,
    target_label: target?.label ?? null,
    details: JSON.parse(JSON.stringify(details ?? {})),
    prev_hash: last?.hash ?? GENESIS
  };
  entry.hash = hashEntry(entry);
  await client.query(
    `INSERT INTO audit_log (${COLUMNS.join(", ")}, hash) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")}, $${COLUMNS.length + 1})`,
    [...COLUMNS.map((column) => column === "details" ? JSON.stringify(entry.details) : entry[column]), entry.hash]
  );
  return entry;
}

// Standalone entry (its own transaction) for events that don't change other data.
const log = (ctx, action, options) => tx((client) => record(client, ctx, action, options));

function rowToEntry(row) {
  return { ...row, seq: Number(row.seq), ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts };
}

// Walks the whole chain in pages, recomputing every hash.
async function verify() {
  let prev = GENESIS, expected = 1, count = 0, head = null;
  for (;;) {
    const { rows } = await pool.query(`SELECT ${COLUMNS.join(", ")}, hash FROM audit_log WHERE seq >= $1 ORDER BY seq LIMIT 2000`, [expected]);
    if (!rows.length) break;
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (entry.seq !== expected) return { ok: false, at: expected, reason: `Entries are missing between #${expected - 1} and #${entry.seq}.` };
      if (entry.prev_hash !== prev) return { ok: false, at: entry.seq, reason: "This entry isn’t linked to the one before it." };
      if (hashEntry(entry) !== entry.hash) return { ok: false, at: entry.seq, reason: "This entry was changed after it was recorded." };
      prev = entry.hash; expected++; count++; head = { seq: entry.seq, hash: entry.hash };
    }
  }
  return { ok: true, entries: count, head };
}

module.exports = { record, log, verify, contextFrom, rowToEntry, hashEntry, canonical, GENESIS };
