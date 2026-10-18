-- "Are you a worker?" (Yes/No). Only workers have a unit and leadership role.
-- Existing members in a unit or with a leadership role become workers; everyone else is recorded as not a worker.
ALTER TABLE members ADD COLUMN is_worker VARCHAR(5) NOT NULL DEFAULT '';
UPDATE members SET is_worker = CASE WHEN (unit <> '' AND unit <> 'Not yet in a unit') OR leadership <> '' THEN 'Yes' ELSE 'No' END;
UPDATE members SET unit = '' WHERE is_worker = 'No';
