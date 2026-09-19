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
  connection_disclosure_at timestamptz,
  real_name_verified_at timestamptz,
  CONSTRAINT accounts_status_check CHECK (status IN ('active', 'locked', 'pending_deletion', 'deleted'))
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS connection_disclosure_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS real_name_verified_at timestamptz;

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

CREATE TABLE IF NOT EXISTS relay_grants (
  relay_grant_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  kind text NOT NULL,
  bytes_total bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  period_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT relay_grants_kind_check CHECK (kind IN ('promo', 'plugin', 'subscription', 'free')),
  CONSTRAINT relay_grants_bytes_check CHECK (bytes_total >= 0),
  UNIQUE (account_id, kind, period_start)
);

CREATE TABLE IF NOT EXISTS remote_sessions (
  remote_session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  host_device_id uuid NOT NULL REFERENCES host_devices (host_device_id),
  host_account_id uuid NOT NULL REFERENCES accounts (account_id),
  controller_fingerprint text NOT NULL,
  host_fingerprint text NOT NULL,
  state text NOT NULL,
  cross_account boolean NOT NULL,
  bitrate_kbps integer NOT NULL,
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  direct_started_at timestamptz,
  direct_stopped_at timestamptz,
  punch_result text,
  reported_bitrate_kbps integer,
  CONSTRAINT remote_sessions_state_check CHECK (state IN ('awaiting_host_consent', 'active', 'relay_stopped', 'closed', 'rejected'))
);

CREATE TABLE IF NOT EXISTS relay_tickets (
  relay_ticket_id uuid PRIMARY KEY,
  remote_session_id uuid NOT NULL REFERENCES remote_sessions (remote_session_id),
  secret_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  admitted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_ledger (
  relay_ledger_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  relay_grant_id uuid NOT NULL REFERENCES relay_grants (relay_grant_id),
  remote_session_id uuid NOT NULL REFERENCES remote_sessions (remote_session_id),
  bytes bigint NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT relay_ledger_bytes_check CHECK (bytes > 0)
);

CREATE TABLE IF NOT EXISTS relay_heartbeats (
  heartbeat_id uuid PRIMARY KEY,
  remote_session_id uuid NOT NULL REFERENCES remote_sessions (remote_session_id),
  bytes_reported bigint NOT NULL,
  duration_seconds integer NOT NULL,
  directive text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

ALTER TABLE host_devices ADD COLUMN IF NOT EXISTS device_code text;
ALTER TABLE host_devices ADD COLUMN IF NOT EXISTS temp_password_hash text;
ALTER TABLE host_devices ADD COLUMN IF NOT EXISTS accepting_connections boolean NOT NULL DEFAULT true;
ALTER TABLE remote_sessions ADD COLUMN IF NOT EXISTS controller_phone_mask text;
ALTER TABLE remote_sessions ADD COLUMN IF NOT EXISTS input_revoked boolean NOT NULL DEFAULT false;
ALTER TABLE remote_sessions DROP CONSTRAINT IF EXISTS remote_sessions_state_check;
ALTER TABLE remote_sessions ADD CONSTRAINT remote_sessions_state_check
  CHECK (state IN ('awaiting_host_consent', 'active', 'relay_stopped', 'closed', 'rejected'));
CREATE UNIQUE INDEX IF NOT EXISTS host_devices_device_code
  ON host_devices (device_code)
  WHERE device_code IS NOT NULL AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS orders (
  order_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  plan text NOT NULL,
  amount_cents integer NOT NULL,
  price_version text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT orders_plan_check CHECK (plan IN ('yearly', 'monthly')),
  CONSTRAINT orders_state_check CHECK (state IN ('unfinished', 'confirming', 'opened', 'closed')),
  CONSTRAINT orders_amount_check CHECK (amount_cents > 0)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS wants_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_title_kind text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_title text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_tax_number text;

CREATE TABLE IF NOT EXISTS invoice_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts (account_id),
  wants_invoice boolean NOT NULL,
  title_kind text,
  title text,
  tax_number text,
  updated_at timestamptz NOT NULL,
  CONSTRAINT invoice_profiles_kind_check CHECK (title_kind IS NULL OR title_kind IN ('personal', 'enterprise'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts (account_id),
  plan text NOT NULL,
  amount_cents integer NOT NULL,
  price_version text NOT NULL,
  auto_renew boolean NOT NULL,
  next_charge_at timestamptz,
  reminder_for_charge_at timestamptz,
  opened_order_id uuid NOT NULL REFERENCES orders (order_id),
  charge_failed_at timestamptz,
  charge_channel text,
  next_retry_at timestamptz,
  retries_remaining integer,
  entitlement_ends_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS charge_failed_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS charge_channel text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS retries_remaining integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS entitlement_ends_at timestamptz;

CREATE TABLE IF NOT EXISTS renewal_reminders (
  renewal_reminder_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (account_id),
  subscription_id uuid NOT NULL REFERENCES subscriptions (subscription_id),
  charge_at timestamptz NOT NULL,
  channel text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT renewal_reminders_channel_check CHECK (channel IN ('app', 'email', 'wechat', 'alipay')),
  CONSTRAINT renewal_reminders_status_check CHECK (status IN ('queued', 'recorded')),
  UNIQUE (subscription_id, charge_at, channel)
);
`;
