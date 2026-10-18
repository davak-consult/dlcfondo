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
| `migrations/` | PostgreSQL schema, applied in order |
| `scripts/` | Setup and maintenance commands |
| `test/` | Automated API tests (run against a real PostgreSQL) |

Data lives in PostgreSQL. Nothing is stored in the browser except the sign-in cookie.

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
3. **Database rules:** PostgreSQL refuses `UPDATE`, `DELETE` and `TRUNCATE` on the audit table.
4. **Least privilege:** in production, the app connects with a role that can only *read and add* audit entries, and can't switch off those rules (see `scripts/create-app-role.sql`).
5. **Checking:** **Verify integrity** in the dashboard, or `npm run verify-audit` from a scheduled job, re-checks the whole log. Export the JSON, or note the "latest fingerprint", from time to time. Even someone with full database control then can't rewrite history without it showing.

## Running it locally

Needs Node.js 20+ and Docker.

```bash
npm install
docker compose up -d db          # PostgreSQL on localhost:5433 (dev + test databases)
npm run migrate
npm run create-admin -- --email you@example.com --name "Your Name"   # prints a one-time password
npm run dev                      # http://localhost:3000
```

Run the tests (they reset the `dlcf_test` database):

```bash
npm test
```

## Deploying

You need a **managed PostgreSQL database with automated daily backups** and a host that runs Node.js or Docker. Any of these combinations work:

- **Render**, **Railway** or **Fly.io** to run the app (Docker or Node), and
- their own Postgres, or **Neon**, **Supabase** or **DigitalOcean Managed PostgreSQL** for the database.

Steps:

1. **Create the database.** Turn on automated backups and point-in-time recovery if offered.
2. **Configure the app.** Deploy this repository (the `Dockerfile` runs migrations, then starts the server) and set the environment variables from `.env.example`:
   - `DATABASE_URL` and `DATABASE_SSL=true`.
   - `TRUST_PROXY=1` when running behind the host's load balancer, so IP addresses are logged correctly.
   - Leave `COOKIE_SECURE` unset, so it defaults to on.
3. **Use HTTPS.** Serve the site over HTTPS only; all of the hosts above do this automatically. Sign-in cookies are marked `Secure` and won't work over plain HTTP.
4. **Restrict the app's database role.** Run `scripts/create-app-role.sql` once with the owner account. Then switch the app's `DATABASE_URL` to the new `dlcf_app` user. Keep using the owner account for migrations.
5. **Create the first admin.** Run `npm run create-admin -- --email ... --name "..."` once (most hosts have a "run command" or shell option). Sign in with the one-time password, then add campus pastors under **Users**.
6. **Schedule the integrity check.** Add a daily job that runs `npm run verify-audit`. It exits with an error if the log was tampered with, so your host can alert you.

Health check endpoint: `GET /healthz`.

## Day-to-day operations

- **Forgotten password:** the regional admin opens **Users** and clicks **Reset password**, then gives the one-time password to the person directly.
- **Someone leaves:** **Deactivate** their account. They're signed out immediately and their history stays in the audit log.
- **Backups:** rely on the database provider's backups. Test a restore at least once.
- **Personal data:** the records include contact details, family details and pastoral notes. Only give accounts to people who need them, deactivate accounts promptly, and keep the consent confirmation on the add-member form. Under the Nigeria Data Protection Act, consider who the data controller is and how members can ask to see or correct their data.

## Configuration

See `.env.example` for all settings: session lengths, lockout threshold, proxy trust and running migrations on start.
