-- Institutions (Adeyemi, UNIMED, Wesley) each have any number of fellowship centres.
-- The three existing centres become the first fellowship centre of their institution, so
-- existing members, pastors and audit entries keep pointing at the same centre ids.

CREATE TABLE institutions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(40) NOT NULL UNIQUE,
  name       VARCHAR(200) NOT NULL UNIQUE,
  short_name VARCHAR(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO institutions (code, name, short_name) VALUES
  ('adeyemi', 'Adeyemi Federal University of Education', 'Adeyemi'),
  ('unimed',  'University of Medical Sciences',          'UNIMED'),
  ('wesley',  'Wesley University',                       'Wesley');

ALTER TABLE centres ADD COLUMN institution_id INT NULL;
UPDATE centres c JOIN institutions i ON i.name = c.institution SET c.institution_id = i.id;
ALTER TABLE centres MODIFY institution_id INT NOT NULL;
ALTER TABLE centres ADD CONSTRAINT centres_institution_fk FOREIGN KEY (institution_id) REFERENCES institutions (id);
ALTER TABLE centres DROP COLUMN institution;
ALTER TABLE centres ADD CONSTRAINT centres_institution_name_unique UNIQUE (institution_id, name);
