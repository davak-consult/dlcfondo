const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const audit = require("../src/audit");

let admin, adeyemiPastor;
before(async () => {
  await h.resetDatabase();
  await h.createUser({ email: "admin@dlcf.test", name: "Regional Admin" });
  await h.createUser({ email: "adeyemi@dlcf.test", name: "Adeyemi Pastor", role: "campus_pastor", centreId: 1 });
  admin = await h.signedIn("admin@dlcf.test");
  adeyemiPastor = await h.signedIn("adeyemi@dlcf.test");
});
after(() => h.pool.end());

describe("security basics", () => {
  test("security headers are set", async () => {
    const res = await h.request(h.app).get("/");
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(res.headers["content-security-policy"], /script-src 'self'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-powered-by"], undefined);
  });
  test("API requires sign-in", async () => {
    assert.equal((await h.request(h.app).get("/api/members")).status, 401);
  });
  test("mutations without the anti-CSRF header are blocked", async () => {
    const res = await admin.raw.post("/api/members").send(h.validMember());
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "CSRF");
  });
  test("mutations from another origin are blocked", async () => {
    const res = await admin.post("/api/members").set("Origin", "https://evil.example").send(h.validMember());
    assert.equal(res.status, 403);
  });
  test("session cookie is httpOnly and SameSite=Strict", async () => {
    const res = await h.client().post("/api/auth/login").send({ email: "admin@dlcf.test", password: h.PASSWORD });
    const cookie = res.headers["set-cookie"].join(";");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });
  test("malformed JSON gets a clean 400", async () => {
    const res = await admin.post("/api/members").set("Content-Type", "application/json").send("{bad");
    assert.equal(res.status, 400);
    assert.doesNotMatch(JSON.stringify(res.body), /SyntaxError|at /);
  });
});

describe("sign-in", () => {
  test("wrong password and unknown email give the same message and are audited", async () => {
    const a = await h.client().post("/api/auth/login").send({ email: "admin@dlcf.test", password: "nope-nope-nope" });
    const b = await h.client().post("/api/auth/login").send({ email: "ghost@dlcf.test", password: "nope-nope-nope" });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
    const last = await h.lastAudit();
    assert.equal(last.action, "auth.login_failed");
    assert.equal(last.details.reason, "no account with this email");
  });
  test("account locks after 5 failures and the lock is audited", async () => {
    await h.createUser({ email: "lockme@dlcf.test" });
    for (let i = 0; i < 5; i++) await h.client().post("/api/auth/login").send({ email: "lockme@dlcf.test", password: "wrong-password-x" });
    const res = await h.client().post("/api/auth/login").send({ email: "lockme@dlcf.test", password: h.PASSWORD });
    assert.equal(res.status, 423);
    assert.ok((await h.auditActions()).includes("auth.locked"));
  });
  test("temporary password forces a change before anything else", async () => {
    await h.createUser({ email: "new@dlcf.test", mustChange: true });
    const c = await h.signedIn("new@dlcf.test");
    assert.equal((await c.get("/api/members")).status, 403);
    assert.equal((await c.post("/api/auth/password").send({ currentPassword: h.PASSWORD, newPassword: "short" })).status, 400);
    assert.equal((await c.post("/api/auth/password").send({ currentPassword: h.PASSWORD, newPassword: "new-password-123" })).status, 400, "contains email name");
    assert.equal((await c.post("/api/auth/password").send({ currentPassword: h.PASSWORD, newPassword: "Blessed-Assurance-7" })).status, 200);
    assert.equal((await c.get("/api/members")).status, 200);
  });
  test("logout ends the session", async () => {
    const c = await h.signedIn("admin@dlcf.test");
    assert.equal((await c.post("/api/auth/logout")).status, 204);
    assert.equal((await c.get("/api/auth/me")).status, 401);
  });
});

describe("members", () => {
  let memberId, updatedAt;
  test("validation errors come back per field", async () => {
    const res = await admin.post("/api/members").send(h.validMember({ phone: "123", firstName: "", level: "900 level" }));
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.phone && res.body.errors.firstName && res.body.errors.level);
  });
  test("create is saved with an audit entry in the same transaction", async () => {
    const res = await admin.post("/api/members").send(h.validMember({ unknownField: "x", position: "should be dropped" }));
    assert.equal(res.status, 201);
    assert.equal(res.body.centre, "UNIMED Centre");
    assert.equal(res.body.phone, "0803 123 4567");
    assert.equal(res.body.position, "", "hidden staff field is cleared");
    assert.equal(res.body.unknownField, undefined);
    memberId = res.body.id; updatedAt = res.body.updatedAt;
    const last = await h.lastAudit();
    assert.equal(last.action, "member.create");
    assert.equal(last.target_id, String(memberId));
  });
  test("only workers have a unit: required for workers, cleared for non-workers", async () => {
    const res = await admin.post("/api/members").send(h.validMember({ isWorker: "Yes", phone: "08030000020" }));
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.unit);
    assert.ok((await admin.post("/api/members").send(h.validMember({ isWorker: "", phone: "08030000021" }))).body.errors.isWorker);
    const ok = await admin.post("/api/members").send(h.validMember({ isWorker: "No", unit: "Choir", leadership: "Unit leader", phone: "08030000022", firstName: "Nonworker" }));
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.unit, ok.body.leadership], ["", ""]);
  });
  test("students must give their faculty, department and level", async () => {
    const res = await admin.post("/api/members").send(h.validMember({ faculty: "", department: "", level: "", phone: "08030000023" }));
    assert.equal(res.status, 400);
    assert.deepEqual(["faculty", "department", "level"].filter((k) => res.body.errors[k]), ["faculty", "department", "level"]);
  });
  test("viewing a profile is audited", async () => {
    await admin.get(`/api/members/${memberId}`).expect(200);
    assert.equal((await h.lastAudit()).action, "member.view");
  });
  test("update records a field-level diff", async () => {
    const res = await admin.put(`/api/members/${memberId}`).send({ ...h.validMember({ status: "Active", isWorker: "Yes", unit: "Choir" }), updatedAt });
    assert.equal(res.status, 200);
    const last = await h.lastAudit();
    assert.equal(last.action, "member.update");
    assert.deepEqual(last.details.changes.map((c) => [c.field, c.from, c.to]), [["status", "New member", "Active"], ["isWorker", "No", "Yes"], ["unit", "", "Choir"]]);
  });
  test("a stale edit is refused instead of overwriting newer changes", async () => {
    const res = await admin.put(`/api/members/${memberId}`).send({ ...h.validMember(), updatedAt });
    assert.equal(res.status, 409);
  });
  test("search is audited and finds by matric / phone", async () => {
    const res = await admin.get("/api/members?q=0803 123");
    assert.equal(res.body.total, 1);
    assert.equal((await h.lastAudit()).action, "directory.search");
  });
  test("duplicate check finds same phone", async () => {
    const res = await admin.post("/api/members/duplicates").send({ phone: "+2348031234567" });
    assert.equal(res.body.matches.length, 1);
    assert.deepEqual(res.body.matches[0].reasons, ["phone number"]);
  });
  test("CSV export neutralises spreadsheet formulas and is audited", async () => {
    await admin.post("/api/members").send(h.validMember({ firstName: "=HYPERLINK(\"x\")", phone: "08039998888" }));
    const res = await admin.get("/api/reports/members.csv");
    assert.equal(res.status, 200);
    assert.match(res.text, /"'=HYPERLINK\(""x""\)"/);
    assert.equal((await h.lastAudit()).action, "export.csv");
  });
  test("delete is soft, hides the member and stores a snapshot", async () => {
    assert.equal((await admin.delete(`/api/members/${memberId}`)).status, 204);
    assert.equal((await admin.get(`/api/members/${memberId}`)).status, 404);
    const last = audit.rowToEntry((await h.pool.query("SELECT * FROM audit_log WHERE action = 'member.delete'")).rows[0]);
    assert.equal(last.details.snapshot.firstName, "Adaeze");
    const { rows: [row] } = await h.pool.query("SELECT deleted_at FROM members WHERE id = $1", [memberId]);
    assert.ok(row.deleted_at);
  });
});

describe("campus pastor scope", () => {
  let otherCentreMember;
  before(async () => {
    otherCentreMember = (await admin.post("/api/members").send(h.validMember({ phone: "08030000001" }))).body.id;
    await admin.post("/api/members").send(h.validMember({ institution: "Adeyemi Federal University of Education", centre: "Adeyemi Centre", phone: "08030000002", firstName: "Tola" }));
  });
  test("only sees their own centre", async () => {
    const res = await adeyemiPastor.get("/api/members?centreId=2");
    assert.ok(res.body.items.length >= 1);
    assert.ok(res.body.items.every((m) => m.centre === "Adeyemi Centre"));
    const stats = await adeyemiPastor.get("/api/members/stats");
    assert.deepEqual(stats.body.centres.map((c) => c.name), ["Adeyemi Centre"]);
  });
  test("opening another centre's member is a 404 and is audited", async () => {
    assert.equal((await adeyemiPastor.get(`/api/members/${otherCentreMember}`)).status, 404);
    assert.equal((await h.lastAudit()).action, "access.denied");
  });
  test("can't add a member to another centre", async () => {
    const res = await adeyemiPastor.post("/api/members").send(h.validMember({ phone: "08030000003" }));
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.institution);
    assert.equal((await h.lastAudit()).action, "access.denied");
  });
  test("can't open users or audit areas", async () => {
    assert.equal((await adeyemiPastor.get("/api/users")).status, 403);
    assert.equal((await adeyemiPastor.get("/api/audit")).status, 403);
    assert.equal((await h.lastAudit()).action, "access.denied");
  });
});

describe("user management", () => {
  let pastorId, tempPassword;
  test("admin creates a campus pastor with a one-time password", async () => {
    const res = await admin.post("/api/users").send({ email: "wesley@dlcf.test", fullName: "Wesley Pastor", role: "campus_pastor", centreId: 3 });
    assert.equal(res.status, 201);
    assert.match(res.body.temporaryPassword, /^\w{4}-\w{5}-\w{5}$/);
    pastorId = res.body.user.id; tempPassword = res.body.temporaryPassword;
  });
  test("campus pastor without a centre is rejected", async () => {
    const res = await admin.post("/api/users").send({ email: "x@dlcf.test", fullName: "X", role: "campus_pastor" });
    assert.equal(res.status, 400);
  });
  test("deactivating signs the user out everywhere", async () => {
    const pastor = await h.signedIn("wesley@dlcf.test", tempPassword);
    assert.equal((await admin.patch(`/api/users/${pastorId}`).send({ isActive: false })).status, 200);
    assert.equal((await pastor.get("/api/auth/me")).status, 401);
    assert.equal((await h.client().post("/api/auth/login").send({ email: "wesley@dlcf.test", password: tempPassword })).status, 401);
    const last = audit.rowToEntry((await h.pool.query("SELECT * FROM audit_log WHERE action = 'user.update' ORDER BY seq DESC LIMIT 1")).rows[0]);
    assert.equal(last.target_id, pastorId);
    assert.deepEqual(last.details.changes, [{ label: "Status", from: "Active", to: "Deactivated" }]);
  });
  test("admin can't deactivate themselves", async () => {
    const me = (await admin.get("/api/auth/me")).body.user;
    assert.equal((await admin.patch(`/api/users/${me.id}`).send({ isActive: false })).status, 400);
  });
  test("password reset issues a new one-time password", async () => {
    await admin.patch(`/api/users/${pastorId}`).send({ isActive: true });
    const res = await admin.post(`/api/users/${pastorId}/reset-password`);
    assert.equal(res.status, 200);
    const c = await h.signedIn("wesley@dlcf.test", res.body.temporaryPassword);
    assert.equal((await c.get("/api/auth/me")).body.user.mustChangePassword, true);
  });
});

describe("fellowship centres", () => {
  let roadCentre, roadPastor;
  test("admin adds a centre under an institution; duplicates are refused", async () => {
    const res = await admin.post("/api/centres").send({ institutionId: 1, name: "  FUTA  Road Centre " });
    assert.equal(res.status, 201);
    roadCentre = res.body.centre;
    assert.equal(roadCentre.name, "FUTA Road Centre");
    assert.equal(roadCentre.institution, "Adeyemi Federal University of Education");
    assert.equal((await h.lastAudit()).action, "centre.create");
    const dupe = await admin.post("/api/centres").send({ institutionId: 1, name: "futa road centre" });
    assert.equal(dupe.status, 400);
    assert.ok(dupe.body.errors.name);
    assert.equal((await admin.post("/api/centres").send({ institutionId: 99, name: "Nowhere" })).body.errors.institutionId, "Choose an institution.");
  });
  test("the same name is allowed under a different institution", async () => {
    assert.equal((await admin.post("/api/centres").send({ institutionId: 2, name: "FUTA Road Centre" })).status, 201);
  });
  test("lists institutions with their centres and counts", async () => {
    const res = await admin.get("/api/centres");
    assert.deepEqual(res.body.institutions.map((i) => i.shortName), ["Adeyemi", "UNIMED", "Wesley"]);
    const adeyemi = res.body.centres.filter((c) => c.institutionId === 1).map((c) => c.name);
    assert.deepEqual(adeyemi, ["Adeyemi Centre", "FUTA Road Centre"]);
    assert.ok(res.body.centres.find((c) => c.name === "Adeyemi Centre").pastors >= 1);
  });
  test("members go to the chosen centre, which must belong to the institution", async () => {
    const wrong = await admin.post("/api/members").send(h.validMember({ institution: "Wesley University", centre: "FUTA Road Centre", phone: "08030000010" }));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.errors.centre, /under this institution/);
    const res = await admin.post("/api/members").send(h.validMember({ institution: "Adeyemi Federal University of Education", centre: "FUTA Road Centre", phone: "08030000011", firstName: "Bisi" }));
    assert.equal(res.status, 201);
    assert.equal(res.body.centreId, roadCentre.id);
    assert.equal(res.body.centre, "FUTA Road Centre");
  });
  test("a pastor of the new centre sees only that centre, not the rest of the institution", async () => {
    await h.createUser({ email: "road@dlcf.test", name: "Road Pastor", role: "campus_pastor", centreId: roadCentre.id });
    roadPastor = await h.signedIn("road@dlcf.test");
    const mine = await roadPastor.get("/api/members");
    assert.ok(mine.body.items.length >= 1);
    assert.ok(mine.body.items.every((m) => m.centre === "FUTA Road Centre"));
    assert.ok((await adeyemiPastor.get("/api/members")).body.items.every((m) => m.centre === "Adeyemi Centre"));
    const other = await roadPastor.post("/api/members").send(h.validMember({ institution: "Adeyemi Federal University of Education", centre: "Adeyemi Centre", phone: "08030000012" }));
    assert.equal(other.status, 400);
    assert.equal((await h.lastAudit()).action, "access.denied");
  });
  test("moving a member to another centre is recorded as a change", async () => {
    const { body: [member] } = { body: (await admin.get("/api/members?q=Bisi")).body.items };
    const res = await admin.put(`/api/members/${member.id}`).send({ ...member, centre: "Adeyemi Centre" });
    assert.equal(res.status, 200);
    assert.equal(res.body.centre, "Adeyemi Centre");
    assert.deepEqual((await h.lastAudit()).details.changes.map((c) => [c.field, c.from, c.to]), [["centre", "FUTA Road Centre", "Adeyemi Centre"]]);
  });
  test("renaming is audited; removing is refused while anyone is assigned", async () => {
    assert.equal((await admin.patch(`/api/centres/${roadCentre.id}`).send({ name: "FUTA Road" })).body.centre.name, "FUTA Road");
    assert.equal((await h.lastAudit()).action, "centre.update");
    const blocked = await admin.delete(`/api/centres/${roadCentre.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /has 1 user account/);
  });
  test("an unused centre can be removed", async () => {
    const { body: { centre } } = await admin.post("/api/centres").send({ institutionId: 3, name: "Temporary" });
    assert.equal((await admin.delete(`/api/centres/${centre.id}`)).status, 204);
    assert.equal((await h.lastAudit()).action, "centre.delete");
    assert.ok(!(await admin.get("/api/centres")).body.centres.some((c) => c.id === centre.id));
  });
  test("pastors can't manage centres", async () => {
    assert.equal((await roadPastor.get("/api/centres")).status, 403);
    assert.equal((await adeyemiPastor.post("/api/centres").send({ institutionId: 1, name: "Mine" })).status, 403);
  });
});

describe("public registration and approval", () => {
  const visitor = () => h.client();
  const registration = (overrides = {}) => ({ ...h.validMember({ institution: "Adeyemi Federal University of Education", centre: "Adeyemi Centre", firstName: "Femi", surname: "Ojo", phone: "08070000001" }), consent: true, ...overrides });
  let pendingId;
  test("anyone can list institutions and centres", async () => {
    const res = await visitor().get("/api/public/centres");
    assert.equal(res.status, 200);
    assert.ok(res.body.centres["Adeyemi Federal University of Education"].includes("Adeyemi Centre"));
  });
  test("the registration page is served without signing in", async () => {
    const res = await h.request(h.app).get("/register");
    assert.equal(res.status, 200);
    assert.match(res.text, /register\.js/);
  });
  test("a registration is saved as pending, ignoring staff-only fields", async () => {
    const res = await visitor().post("/api/public/register").send(registration({ status: "Active", notes: "let me in" }));
    assert.equal(res.status, 201);
    assert.equal(res.body.centre, "Adeyemi Centre");
    const entry = await h.lastAudit();
    assert.equal(entry.action, "member.register");
    assert.equal(entry.user_id, null);
    pendingId = Number(entry.target_id);
    const { rows: [row] } = await h.pool.query("SELECT approval, status, notes, created_by FROM members WHERE id = $1", [pendingId]);
    assert.deepEqual([row.approval, row.status, row.notes, row.created_by], ["pending", "New member", "", null]);
  });
  test("consent, validation and the cross-site header are required", async () => {
    assert.equal((await visitor().post("/api/public/register").send(registration({ consent: false }))).status, 400);
    assert.ok((await visitor().post("/api/public/register").send(registration({ centre: "UNIMED Centre" }))).body.errors.centre);
    assert.equal((await h.request(h.app).post("/api/public/register").send(registration())).status, 403);
  });
  test("bots that fill the hidden field get a reply but nothing is saved", async () => {
    const before = (await h.pool.query("SELECT count(*) AS n FROM members")).rows[0].n;
    assert.equal((await visitor().post("/api/public/register").send(registration({ website: "http://spam" }))).status, 201);
    assert.equal((await h.pool.query("SELECT count(*) AS n FROM members")).rows[0].n, before);
  });
  test("pending members stay out of the directory and stats until approved", async () => {
    assert.ok(!(await admin.get("/api/members?q=Femi")).body.items.length);
    assert.ok((await adeyemiPastor.get("/api/members/stats")).body.pending >= 1);
  });
  test("only that centre's pastor (or the admin) sees and decides on it", async () => {
    assert.ok((await adeyemiPastor.get("/api/members/pending")).body.items.some((m) => m.id === pendingId));
    await h.createUser({ email: "wesley2@dlcf.test", name: "Wesley Pastor", role: "campus_pastor", centreId: 3 });
    const wesley = await h.signedIn("wesley2@dlcf.test");
    assert.ok(!(await wesley.get("/api/members/pending")).body.items.some((m) => m.id === pendingId));
    assert.equal((await wesley.post(`/api/members/${pendingId}/approve`)).status, 404);
  });
  test("approving lists the member; it can't be decided twice", async () => {
    const res = await adeyemiPastor.post(`/api/members/${pendingId}/approve`);
    assert.equal(res.status, 200);
    assert.equal((await h.lastAudit()).action, "member.approve");
    assert.ok((await adeyemiPastor.get("/api/members?q=Femi")).body.items.some((m) => m.id === pendingId));
    assert.equal((await adeyemiPastor.post(`/api/members/${pendingId}/reject`)).status, 409);
  });
  test("rejecting hides the registration and keeps a snapshot in the audit log", async () => {
    await visitor().post("/api/public/register").send(registration({ firstName: "Spam", phone: "08070000002" }));
    const id = Number((await h.lastAudit()).target_id);
    assert.equal((await admin.post(`/api/members/${id}/reject`).send({ reason: "Not a student here" })).status, 200);
    const entry = await h.lastAudit();
    assert.equal(entry.action, "member.reject");
    assert.equal(entry.details.reason, "Not a student here");
    assert.equal(entry.details.snapshot.firstName, "Spam");
    assert.equal((await admin.get(`/api/members/${id}`)).status, 404);
  });
});

describe("audit log", () => {
  test("only whitelisted browser events are accepted", async () => {
    assert.equal((await admin.post("/api/events").send({ action: "nav.view", view: "Members" })).status, 204);
    assert.equal((await admin.post("/api/events").send({ action: "member.delete" })).status, 400);
    assert.equal((await admin.post("/api/events").send({ action: "nav.view", view: "<script>" })).status, 400);
  });
  test("entries record who, where and when", async () => {
    await admin.post("/api/events").send({ action: "help.open" });
    const last = await h.lastAudit();
    assert.equal(last.actor_email, "admin@dlcf.test");
    assert.equal(last.actor_role, "Regional admin");
    assert.ok(last.ip);
  });
  test("chain stays intact under concurrent writes", async () => {
    await Promise.all(Array.from({ length: 25 }, () => admin.post("/api/events").send({ action: "notify.open" })));
    const result = await audit.verify();
    assert.equal(result.ok, true, JSON.stringify(result));
  });
  test("the database refuses to update, delete or truncate audit entries", async () => {
    await assert.rejects(h.pool.query("UPDATE audit_log SET action = 'x' WHERE seq = 1"), /append-only/);
    await assert.rejects(h.pool.query("DELETE FROM audit_log WHERE seq = 1"), /append-only/);
    await assert.rejects(h.pool.query("TRUNCATE audit_log"), /foreign key/i);
  });
  test("API lists, filters and verifies", async () => {
    const all = await admin.get("/api/audit?open=1");
    assert.ok(all.body.total > 20);
    const members = await admin.get("/api/audit?category=Member");
    assert.ok(members.body.items.every((e) => e.action.startsWith("member.")));
    const verified = await admin.post("/api/audit/verify");
    assert.equal(verified.body.ok, true);
    assert.ok(verified.body.head.hash.length === 64);
  });
  test("tampering by a database superuser is detected", async () => {
    const client = await h.pool.connect();
    try {
      await client.query("DROP TRIGGER audit_log_no_update");
      await client.query("UPDATE audit_log SET actor_email = 'someone@else.test' WHERE seq = 3");
      await h.applyMigration("002_audit_append_only.sql");
    } finally { client.release(); }
    const result = await audit.verify();
    assert.equal(result.ok, false);
    assert.equal(result.at, 3);
  });
});
