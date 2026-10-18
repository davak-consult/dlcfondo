-- Initial schema: centres, users, sessions, members and the append-only audit log.
-- Works on MySQL 8.0.16+ and MariaDB 10.5+. All timestamps are stored in UTC.

CREATE TABLE centres (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(40) NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  institution VARCHAR(200) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO centres (code, name, institution) VALUES
  ('adeyemi', 'Adeyemi Centre', 'Adeyemi Federal University of Education'),
  ('unimed',  'UNIMED Centre',  'University of Medical Sciences'),
  ('wesley',  'Wesley Centre',  'Wesley University');

-- Emails are compared case-insensitively (the default utf8mb4 collations ignore case).
CREATE TABLE users (
  id                   CHAR(36) NOT NULL PRIMARY KEY,
  email                VARCHAR(254) NOT NULL UNIQUE,
  full_name            VARCHAR(120) NOT NULL,
  role                 VARCHAR(20) NOT NULL,
  centre_id            INT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         DATETIME(3) NULL,
  last_login_at        DATETIME(3) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT users_centre_fk FOREIGN KEY (centre_id) REFERENCES centres (id),
  CONSTRAINT users_role_check CHECK (role IN ('regional_admin', 'campus_pastor')),
  CONSTRAINT campus_pastor_needs_centre CHECK (role <> 'campus_pastor' OR centre_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Only a SHA-256 of the session token is stored, so a database leak can't be replayed as logins.
CREATE TABLE sessions (
  token_hash   CHAR(64) NOT NULL PRIMARY KEY,
  user_id      CHAR(36) NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3) NOT NULL,
  ip           VARCHAR(64) NULL,
  user_agent   VARCHAR(300) NULL,
  INDEX sessions_user_idx (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Field limits match public/member-schema.js (200 characters unless the field says otherwise).
CREATE TABLE members (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  centre_id           INT NOT NULL,
  first_name          VARCHAR(80) NOT NULL,
  surname             VARCHAR(80) NOT NULL,
  other_names         VARCHAR(120) NOT NULL DEFAULT '',
  gender              VARCHAR(20) NOT NULL,
  dob                 DATE NULL,
  state_of_origin     VARCHAR(40) NOT NULL DEFAULT '',
  phone               VARCHAR(40) NOT NULL,
  whatsapp            VARCHAR(40) NOT NULL DEFAULT '',
  email               VARCHAR(254) NOT NULL DEFAULT '',
  home_address        TEXT NOT NULL,
  role                VARCHAR(20) NOT NULL,
  faculty             VARCHAR(200) NOT NULL DEFAULT '',
  department          VARCHAR(200) NOT NULL DEFAULT '',
  programme           VARCHAR(200) NOT NULL DEFAULT '',
  level               VARCHAR(40) NOT NULL DEFAULT '',
  matric_no           VARCHAR(40) NOT NULL DEFAULT '',
  admission_year      VARCHAR(10) NOT NULL DEFAULT '',
  residence           TEXT NOT NULL,
  staff_category      VARCHAR(40) NOT NULL DEFAULT '',
  staff_department    VARCHAR(200) NOT NULL DEFAULT '',
  position            VARCHAR(200) NOT NULL DEFAULT '',
  staff_id            VARCHAR(40) NOT NULL DEFAULT '',
  status              VARCHAR(40) NOT NULL,
  date_joined         DATE NOT NULL,
  born_again          VARCHAR(20) NOT NULL DEFAULT '',
  water_baptism       VARCHAR(20) NOT NULL DEFAULT '',
  holy_spirit         VARCHAR(20) NOT NULL DEFAULT '',
  unit                VARCHAR(60) NOT NULL DEFAULT '',
  leadership          VARCHAR(200) NOT NULL DEFAULT '',
  home_church         VARCHAR(200) NOT NULL DEFAULT '',
  notes               TEXT NOT NULL,
  parent_name         VARCHAR(200) NOT NULL DEFAULT '',
  parent_relationship VARCHAR(40) NOT NULL DEFAULT '',
  parent_phone        VARCHAR(40) NOT NULL DEFAULT '',
  parent_address      TEXT NOT NULL,
  kin_same_as_parent  TINYINT(1) NOT NULL DEFAULT 0,
  kin_name            VARCHAR(200) NOT NULL,
  kin_relationship    VARCHAR(40) NOT NULL,
  kin_phone           VARCHAR(40) NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by          CHAR(36) NULL,
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by          CHAR(36) NULL,
  deleted_at          DATETIME(3) NULL,
  deleted_by          CHAR(36) NULL,
  INDEX members_centre_idx (centre_id, deleted_at),
  INDEX members_created_idx (created_at),
  CONSTRAINT members_centre_fk FOREIGN KEY (centre_id) REFERENCES centres (id),
  CONSTRAINT members_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT members_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT members_deleted_by_fk FOREIGN KEY (deleted_by) REFERENCES users (id),
  CONSTRAINT members_role_check CHECK (role IN ('Student', 'Staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only, hash-chained audit log. Each row's hash covers its contents and the previous hash.
-- details holds JSON text; the app hashes it with sorted keys, so storage order doesn't matter.
CREATE TABLE audit_log (
  seq          BIGINT NOT NULL PRIMARY KEY,
  ts           DATETIME(3) NOT NULL,
  user_id      CHAR(36) NULL,
  actor_email  VARCHAR(254) NULL,
  actor_name   VARCHAR(120) NULL,
  actor_role   VARCHAR(40) NULL,
  actor_centre VARCHAR(120) NULL,
  ip           VARCHAR(64) NULL,
  user_agent   VARCHAR(300) NULL,
  action       VARCHAR(64) NOT NULL,
  target_type  VARCHAR(20) NULL,
  target_id    VARCHAR(64) NULL,
  target_label TEXT NULL,
  details      LONGTEXT NOT NULL,
  prev_hash    CHAR(64) NOT NULL,
  hash         CHAR(64) NOT NULL UNIQUE,
  INDEX audit_ts_idx (ts),
  INDEX audit_target_idx (target_type, target_id),
  INDEX audit_action_idx (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- InnoDB refuses to TRUNCATE a table that another table's foreign key points at.
-- This empty table exists only to make TRUNCATE audit_log fail.
CREATE TABLE audit_log_truncate_guard (
  seq BIGINT NULL,
  CONSTRAINT audit_log_truncate_guard_fk FOREIGN KEY (seq) REFERENCES audit_log (seq)
) ENGINE=InnoDB;

-- One row, locked FOR UPDATE while an audit entry is written, so entries are chained one at a time.
CREATE TABLE audit_chain_lock (
  id TINYINT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT INTO audit_chain_lock (id) VALUES (1);
