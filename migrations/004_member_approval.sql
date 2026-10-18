-- Self-registration: members who register on the public page wait for their centre's pastor
-- (or the regional admin) to approve them. Everyone added by staff is approved already.
ALTER TABLE members ADD COLUMN approval VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE members ADD COLUMN approved_at DATETIME(3) NULL;
ALTER TABLE members ADD COLUMN approved_by CHAR(36) NULL;
ALTER TABLE members ADD CONSTRAINT members_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users (id);
ALTER TABLE members ADD CONSTRAINT members_approval_check CHECK (approval IN ('pending', 'approved', 'rejected'));
CREATE INDEX members_approval_idx ON members (centre_id, approval);
