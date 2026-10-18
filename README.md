# DLCF Ondo Region — Member Management

A web app for Deeper Life Campus Fellowship, Ondo Region. It keeps member records for the fellowship centres, gives each pastor their own sign-in, and records every action in a tamper-evident audit log.

- **Regional admin:** sees every centre, manages user accounts and reviews the audit log.
- **Campus pastors:** see and manage members of their own centre only. The server enforces this, so it holds even if someone edits the page in their browser.

## How it's built

| Part | What it is |
|---|---|
| `src/` | Node.js (Express) API server |
| `public/` | The dashboard pages, served by the same server |
| `public/member-schema.js` | Member fields and validation rules, used by **both** the browser and the server |
| `migrations/` | MySQL/MariaDB schema, applied in order |
| `scripts/` | Setup and maintenance commands |
| `test/` | Automated API tests (run against a real MariaDB or MySQL) |

Data lives in MySQL or MariaDB (MySQL 8.0.16+ or MariaDB 10.5+), such as the database included with Hostinger hosting. Nothing is stored in the browser except the sign-in cookie.

## Security in brief

- **Passwords:** hashed with Argon2id. New accounts get a one-time password that must be changed at first sign-in.
- **Locked accounts:** an account locks for 15 minutes after 5 wrong passwords. Sign-in attempts are also rate-limited per network.
- **Sessions:** a random token in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie. Only its SHA-256 is stored in the database. Sessions end after 30 minutes idle or 12 hours.
- **Password changes and account changes:** changing a password signs out the user's other devices. Deactivating an account, or changing its role or centre, signs it out everywhere.
- **Cross-site requests:** changes need a custom header and a matching `Origin`, which blocks requests forged from other websites.
- **Browser protections:** a strict Content-Security-Policy blocks scripts from other sites and stops the page being embedded elsewhere. Other security headers come from Helmet.
- **Validation:** all input is validated on the server with the same rules as the form. Unknown fields are dropped.
- **Saving changes:** if two people edit the same member, the second save is refused rather than silently overwriting the first.
- **Removed members:** they are kept in the database, hidden, with a snapshot in the audit log.
- **CSV exports:** spreadsheet formulas in cells are neutralised, so a value like `=HYPERLINK(...)` can't run.

## Audit log

Every sign-in, failed sign-in, lockout, page visit, member view, add, edit (with before/after values per field), removal, search, export, user-account change, password reset and denied access attempt is recorded. Each entry records who did it (name, email, role, centre), when, their IP address and device.

What makes it tamper-evident:

1. **Same transaction:** each entry is written in the same database transaction as the change it describes. The change and its log entry are saved together or not at all.
2. **Linked entries:** each entry stores a SHA-256 hash of its contents plus the previous entry's hash. Changing, removing or reordering any entry breaks the link at that point.
3. **Database rules:** triggers make the database refuse `UPDATE` and `DELETE` on the audit table, and a foreign key from an empty guard table makes it refuse `TRUNCATE`. Some shared hosts don't let the database user create triggers; the app then logs a warning at start-up and keeps working, and point 5 still catches any change.
4. **Least privilege:** where you can create database users (a VPS or managed MySQL), the app should connect as a user that can only *read and add* audit entries and can't remove those rules (see `scripts/create-app-role.sql`). Hostinger shared hosting doesn't offer this.
5. **Checking:** **Verify integrity** in the dashboard, or `npm run verify-audit` from a scheduled job, re-checks the whole log. Export the JSON, or note the "latest fingerprint", from time to time. Even someone with full database control then can't rewrite history without it showing.

## Running it locally

Needs Node.js 20+ and Docker.

```bash
npm install
docker compose up -d db          # MariaDB on localhost:3307 (dev + test databases)
npm run migrate
npm run create-admin -- --email you@example.com --name "Your Name"   # prints a one-time password
npm run dev                      # http://localhost:3000
```

Run the tests (they reset the `dlcf_test` database):

```bash
npm test
```

## Deploying

You need a host that runs Node.js 20+ and a **MySQL or MariaDB database with automated backups**.

### Hostinger (Node.js web app + included MySQL)

1. **Create the database.** In hPanel go to **Databases → Management** and create a database and user. Note the database name, user and password (they start with your account prefix, e.g. `u897516394_`).
2. **Create the Node.js app.** In hPanel add a **Node.js** web app for the domain, connected to this GitHub repository (or upload a zip). Choose Node.js 20 or newer. Build command: `npm ci --omit=dev`. Start command: `npm start`.
3. **Set the environment variables** in the app's settings:
   - `NODE_ENV=production`, `TRUST_PROXY=1`, `MIGRATE_ON_START=true`
   - `DB_HOST=localhost`, `DB_PORT=3306`, `DB_NAME=…`, `DB_USER=…`, `DB_PASSWORD=…` (from step 1)
   - Leave `COOKIE_SECURE` unset (it defaults to on) and make sure the domain has SSL enabled.
4. **Deploy**, then check `https://your-domain/healthz` returns `{"ok":true}`. The start-up log shows the migrations that ran. If it says `skipped 002_audit_append_only.sql`, your plan doesn't allow database triggers; everything still works and tampering is still detected.
5. **Create the first admin** over SSH, from the app's folder: `npm run create-admin -- --email ... --name "..."`. The same `DB_*` variables must be set in that shell (e.g. `export DB_NAME=...`).
6. **Schedule the integrity check.** In hPanel **Advanced → Cron Jobs**, add a daily job that runs `npm run verify-audit` in the app's folder.

Hostinger keeps automatic backups of your databases; you can also download one from **Databases → Backups**.

### Other hosts

Any host that runs Node.js or Docker works with any MySQL 8.0.16+ or MariaDB 10.5+ database. Steps:

1. **Create the database.** Turn on automated backups and point-in-time recovery if offered.
2. **Configure the app.** Deploy this repository (the `Dockerfile` runs migrations, then starts the server) and set the environment variables from `.env.example`:
   - `DATABASE_URL` (`mysql://user:password@host:3306/name`), plus `DATABASE_SSL=true` if the database requires TLS.
   - `TRUST_PROXY=1` when running behind the host's load balancer, so IP addresses are logged correctly.
   - Leave `COOKIE_SECURE` unset, so it defaults to on.
3. **Use HTTPS.** Serve the site over HTTPS only; all of the hosts above do this automatically. Sign-in cookies are marked `Secure` and won't work over plain HTTP.
4. **Restrict the app's database user.** Run `scripts/create-app-role.sql` once as an admin user (edit the database name and password first). Then switch the app's `DATABASE_URL` to the new `dlcf_app` user. Keep using the owner account for migrations.
5. **Create the first admin.** Run `npm run create-admin -- --email ... --name "..."` once (most hosts have a "run command" or shell option). Sign in with the one-time password, then add campus pastors under **Users**.
6. **Schedule the integrity check.** Add a daily job that runs `npm run verify-audit`. It exits with an error if the log was tampered with, so your host can alert you.

Health check endpoint: `GET /healthz`.

## Day-to-day operations

- **Fellowship centres:** each institution (Adeyemi, UNIMED, Wesley) can have any number of fellowship centres. The regional admin adds and renames them on the **Fellowship centres** page, then assigns each campus pastor to one centre under **Users**. A pastor sees only the members of their own centre. A centre can only be removed if no member or user has ever been assigned to it.
- **Forgotten password:** the regional admin opens **Users** and clicks **Reset password**, then gives the one-time password to the person directly.
- **Someone leaves:** **Deactivate** their account. They're signed out immediately and their history stays in the audit log.
- **Backups:** rely on the database provider's backups. Test a restore at least once.
- **Personal data:** the records include contact details, family details and pastoral notes. Only give accounts to people who need them, deactivate accounts promptly, and keep the consent confirmation on the add-member form. Under the Nigeria Data Protection Act, consider who the data controller is and how members can ask to see or correct their data.

## Configuration

See `.env.example` for all settings: session lengths, lockout threshold, proxy trust and running migrations on start.
