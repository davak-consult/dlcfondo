-- optional: needs the TRIGGER privilege, which some shared hosts don't grant.
-- Makes the database itself refuse to change or remove audit entries. Without these triggers,
-- the hash chain still detects any change (see "Verify integrity"), but can't prevent it.
DROP TRIGGER IF EXISTS audit_log_no_update;
DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: UPDATE is not allowed';
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: DELETE is not allowed';
