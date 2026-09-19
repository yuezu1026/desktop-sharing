/** 登录会话与被控设备分表。取消授权不删除行，移除设备才从列表消失。 */

export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  account_id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  email text UNIQUE,
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  recovery_code_hash text,
  password_failure_count integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  lock_reason text,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT accounts_status_check CHECK (status IN ('active', 'locked', 'pending_deletion', 'deleted'))
);

CREATE TABLE IF NOT EXISTS login_sessions (
  login_session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  token_hash text NOT NULL UNIQUE,
  city text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS host_devices (
  host_device_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  display_name text NOT NULL,
  platform text NOT NULL,
  hardware_fingerprint text NOT NULL,
  connection_state text NOT NULL,
  authorization_state text NOT NULL,
  last_seen_at timestamptz,
  idle_warning_sent_at timestamptz,
  removed_at timestamptz,
  unbound_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT host_devices_connection_check CHECK (connection_state IN ('online', 'offline', 'never_connected')),
  CONSTRAINT host_devices_authorization_check CHECK (authorization_state IN ('authorized', 'needs_confirmation', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS host_devices_live_fingerprint
  ON host_devices (account_id, hardware_fingerprint)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS verification_challenges (
  challenge_id uuid PRIMARY KEY,
  purpose text NOT NULL,
  phone text,
  email text,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  account_id uuid
);

CREATE TABLE IF NOT EXISTS account_notices (
  account_notice_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id uuid PRIMARY KEY,
  account_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
`;
