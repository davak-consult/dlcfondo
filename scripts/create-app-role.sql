-- Least-privilege database user for the running app (recommended where you can create users,
-- e.g. on a VPS or managed MySQL; Hostinger shared hosting doesn't allow custom grants).
-- Run once as an admin user AFTER migrations, replacing dlcf with your database name and
-- choosing a long random password:
--   mysql -u root -p dlcf < scripts/create-app-role.sql
-- Then point the app's DATABASE_URL at dlcf_app, and keep running migrations with the owner account.
-- dlcf_app can only read and add audit entries, and has no TRIGGER, DROP or ALTER privilege,
-- so it can't remove the append-only triggers or the truncate guard.
CREATE USER 'dlcf_app'@'%' IDENTIFIED BY 'change-me-to-a-long-random-password';
GRANT SELECT ON dlcf.institutions TO 'dlcf_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON dlcf.centres TO 'dlcf_app'@'%';
GRANT SELECT, INSERT, UPDATE ON dlcf.users TO 'dlcf_app'@'%';
GRANT SELECT, INSERT, UPDATE ON dlcf.members TO 'dlcf_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON dlcf.sessions TO 'dlcf_app'@'%';
GRANT SELECT, INSERT ON dlcf.audit_log TO 'dlcf_app'@'%';
GRANT SELECT, UPDATE ON dlcf.audit_chain_lock TO 'dlcf_app'@'%';
GRANT SELECT ON dlcf.schema_migrations TO 'dlcf_app'@'%';
