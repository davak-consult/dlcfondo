-- Least-privilege role for the running app (recommended in production).
-- Run once as the database owner AFTER migrations, e.g.:
--   psql "$OWNER_DATABASE_URL" -v app_password="'a-long-random-password'" -f scripts/create-app-role.sql
-- Then point the app's DATABASE_URL at dlcf_app, and keep running migrations with the owner account.
-- Because dlcf_app doesn't own audit_log, it cannot disable the append-only triggers,
-- and it is only granted SELECT and INSERT on the audit log.
CREATE ROLE dlcf_app LOGIN PASSWORD :app_password;
GRANT USAGE ON SCHEMA public TO dlcf_app;
GRANT SELECT ON centres TO dlcf_app;
GRANT SELECT, INSERT, UPDATE ON users, members TO dlcf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO dlcf_app;
GRANT SELECT, INSERT ON audit_log TO dlcf_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dlcf_app;
