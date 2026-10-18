-- Initial schema: centres, users, sessions, members and the append-only audit log.

CREATE TABLE centres (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  institution text NOT NULL UNIQUE
);

INSERT INTO centres (code, name, institution) VALUES
  ('adeyemi', 'Adeyemi Centre', 'Adeyemi Federal University of Education'),
  ('unimed',  'UNIMED Centre',  'University of Medical Sciences'),
  ('wesley',  'Wesley Centre',  'Wesley University');

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text NOT NULL,
  full_name            text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('regional_admin', 'campus_pastor')),
  centre_id            integer REFERENCES centres(id),
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  is_active            boolean NOT NULL DEFAULT true,
  failed_logins        integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campus_pastor_needs_centre CHECK (role <> 'campus_pastor' OR centre_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Only a SHA-256 of the session token is stored, so a database leak can't be replayed as logins.
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE members (
  id                  bigserial PRIMARY KEY,
  centre_id           integer NOT NULL REFERENCES centres(id),
  first_name          text NOT NULL,
  surname             text NOT NULL,
  other_names         text NOT NULL DEFAULT '',
  gender              text NOT NULL,
  dob                 date,
  state_of_origin     text NOT NULL DEFAULT '',
  phone               text NOT NULL,
  whatsapp            text NOT NULL DEFAULT '',
  email               text NOT NULL DEFAULT '',
  home_address        text NOT NULL DEFAULT '',
  role                text NOT NULL CHECK (role IN ('Student', 'Staff')),
  faculty             text NOT NULL DEFAULT '',
  department          text NOT NULL DEFAULT '',
  programme           text NOT NULL DEFAULT '',
  level               text NOT NULL DEFAULT '',
  matric_no           text NOT NULL DEFAULT '',
  admission_year      text NOT NULL DEFAULT '',
  residence           text NOT NULL DEFAULT '',
  staff_category      text NOT NULL DEFAULT '',
  staff_department    text NOT NULL DEFAULT '',
  position            text NOT NULL DEFAULT '',
  staff_id            text NOT NULL DEFAULT '',
  status              text NOT NULL,
  date_joined         date NOT NULL,
  born_again          text NOT NULL DEFAULT '',
  water_baptism       text NOT NULL DEFAULT '',
  holy_spirit         text NOT NULL DEFAULT '',
  unit                text NOT NULL DEFAULT '',
  leadership          text NOT NULL DEFAULT '',
  home_church         text NOT NULL DEFAULT '',
  notes               text NOT NULL DEFAULT '',
  parent_name         text NOT NULL DEFAULT '',
  parent_relationship text NOT NULL DEFAULT '',
  parent_phone        text NOT NULL DEFAULT '',
  parent_address      text NOT NULL DEFAULT '',
  kin_same_as_parent  boolean NOT NULL DEFAULT false,
  kin_name            text NOT NULL,
  kin_relationship    text NOT NULL,
  kin_phone           text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES users(id)
);
CREATE INDEX members_centre_idx ON members (centre_id) WHERE deleted_at IS NULL;
CREATE INDEX members_created_idx ON members (created_at DESC) WHERE deleted_at IS NULL;

-- Append-only, hash-chained audit log. Each row's hash covers its contents and the previous hash.
CREATE TABLE audit_log (
  seq          bigint PRIMARY KEY,
  ts           timestamptz NOT NULL,
  user_id      uuid,
  actor_email  text,
  actor_name   text,
  actor_role   text,
  actor_centre text,
  ip           text,
  user_agent   text,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  target_label text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text NOT NULL,
  hash         text NOT NULL UNIQUE
);
CREATE INDEX audit_ts_idx ON audit_log (ts DESC);
CREATE INDEX audit_target_idx ON audit_log (target_type, target_id);
CREATE INDEX audit_action_idx ON audit_log (action);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
