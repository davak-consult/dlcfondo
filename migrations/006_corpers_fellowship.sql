-- Corpers Fellowship: a fellowship for NYSC corps members, organised like an institution with its own
-- fellowship centres. Its members are "Corps member"s with a state code, PPA and lodge address.

ALTER TABLE institutions ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'campus';
INSERT INTO institutions (code, name, short_name, kind) VALUES ('corpers', 'Corpers Fellowship', 'Corpers', 'corpers');
INSERT INTO centres (code, name, institution_id) SELECT 'corpers', 'Corpers Fellowship Centre', id FROM institutions WHERE code = 'corpers';

ALTER TABLE members ADD COLUMN state_code VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN ppa VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN lodge_address VARCHAR(300) NOT NULL DEFAULT '';
ALTER TABLE members DROP CONSTRAINT members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role IN ('Student', 'Staff', 'Corps member'));
