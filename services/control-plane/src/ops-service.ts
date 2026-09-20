import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { type Failure } from "./account-service.js";
import type { AppConfig } from "./config.js";
import {
  assertPasswordAcceptable,
  createRecoveryCode,
  createToken,
  hashPassword,
  hashSecret,
  maskPhone,
  normalizeEmail,
  normalizeMainlandPhone,
  verifyPassword,
} from "./passwords.js";
import { fraudNotice } from "./session-service.js";
import { createTotpSecret, totpMatches } from "./totp.js";

/** 与用户侧密码连续失败锁定同一次数。内部台没有另定数字。 */
const STAFF_FAILURE_LIMIT = 5;
/** 单次补偿超过免费额度的 10 倍要第二个人复核。已定。 */
const COMPENSATION_REVIEW_MULTIPLE = 10;
const LOGIN_FAILED = "账号或密码错误";

const CHANNEL_CONSOLE: Record<string, string> = {
  wechat: "https://pay.weixin.qq.com/",
  alipay: "https://b.alipay.com/",
};

type StaffRow = {
  staff_id: string;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  totp_secret: string | null;
  totp_confirmed_at: Date | null;
  password_failure_count: number;
};

type Json = Record<string, unknown>;

function fail(status: number, code: string, message: string, extra?: Json): Failure {
  return { ok: false, status, code, message, extra };
}

function allowed(role: string, action: "query" | "compensate" | "ban" | "refund" | "staff"): boolean {
  if (role === "admin") return true;
  if (action === "query") return role === "support" || role === "risk" || role === "finance";
  if (action === "compensate") return role === "support";
  if (action === "ban") return role === "risk";
  if (action === "refund") return role === "finance";
  return false;
}

/** 运营台账号和用户账号不是同一张表。没有自助注册，也没有记住设备。 */
export class OpsService {
  private dummyHash = "";

  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly now: () => Date,
  ) {}

  async ensureBootstrap(): Promise<void> {
    const email = this.config.opsBootstrapEmail ? normalizeEmail(this.config.opsBootstrapEmail) : null;
    const password = this.config.opsBootstrapPassword ?? "";
    if (!email || assertPasswordAcceptable(password)) return;
    const existing = await this.pool.query("SELECT 1 FROM staff_accounts LIMIT 1");
    if (existing.rowCount) return;
    await this.pool.query(
      `INSERT INTO staff_accounts
        (staff_id, email, password_hash, role, status, password_failure_count, created_at)
       VALUES ($1, $2, $3, 'admin', 'active', 0, $4)`,
      [randomUUID(), email, await hashPassword(password), this.now()],
    );
  }

  async login(
    emailRaw: string | null,
    password: string | null,
    totpCode: string | null,
    recoveryCode: string | null,
  ): Promise<Json | Failure> {
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    if (!email || !password) {
      await this.burn(password ?? "missing");
      return fail(401, "staff_login_failed", LOGIN_FAILED);
    }
    const found = await this.pool.query<StaffRow>(
      `SELECT staff_id, email, password_hash, role, status, totp_secret, totp_confirmed_at, password_failure_count
         FROM staff_accounts WHERE email = $1`,
      [email],
    );
    const staff = found.rows[0];
    if (!staff) {
      await this.burn(password);
      return fail(401, "staff_login_failed", LOGIN_FAILED);
    }
    const matched = await verifyPassword(password, staff.password_hash);
    if (!matched) {
      await this.noteFailure(staff);
      return fail(401, "staff_login_failed", LOGIN_FAILED);
    }
    if (staff.status === "disabled") return fail(403, "staff_disabled", "账号已停用");
    if (staff.status === "locked") return fail(403, "staff_locked", "账号已锁定");
    if (!staff.totp_confirmed_at) return this.beginSetup(staff);
    const recoveryOk = await this.consumeRecovery(staff.staff_id, recoveryCode);
    const totpOk = Boolean(totpCode && staff.totp_secret && totpMatches(staff.totp_secret, totpCode, this.now().getTime()));
    if (!recoveryOk && !totpOk) {
      const remaining = await this.noteFailure(staff);
      if (remaining < 0) return fail(403, "staff_locked", "账号已锁定");
      return fail(401, "staff_totp_invalid", "动态码不正确", { attemptsRemaining: remaining });
    }
    await this.pool.query(
      "UPDATE staff_accounts SET password_failure_count = 0 WHERE staff_id = $1",
      [staff.staff_id],
    );
    const token = await this.issue(staff.staff_id, "access");
    return { ok: true, token, role: staff.role };
  }

  async confirmTotp(setupToken: string | null, code: string | null): Promise<Json | Failure> {
    const staff = await this.staffFromToken(setupToken, "setup");
    if (!staff || !staff.totp_secret || !code || !totpMatches(staff.totp_secret, code, this.now().getTime())) {
      return fail(401, "staff_totp_invalid", "动态码不正确");
    }
    const now = this.now();
    await this.pool.query(
      "UPDATE staff_accounts SET totp_confirmed_at = $2 WHERE staff_id = $1",
      [staff.staff_id, now],
    );
    await this.pool.query(
      "UPDATE staff_sessions SET revoked_at = $2 WHERE staff_id = $1 AND purpose = 'setup' AND revoked_at IS NULL",
      [staff.staff_id, now],
    );
    const recoveryCode = await this.replaceRecoveryCode(staff.staff_id, now);
    await this.audit(staff.staff_id, "staff.totp", null, null, { confirmed: true }, null);
    return { ok: true, recoveryCode };
  }

  async changePassword(token: string | null, currentPassword: string, nextPassword: string): Promise<Json | Failure> {
    const staff = await this.staffFromToken(token, "access");
    if (!staff) return fail(401, "staff_login_failed", LOGIN_FAILED);
    if (!(await verifyPassword(currentPassword, staff.password_hash))) return fail(401, "staff_login_failed", LOGIN_FAILED);
    const rejected = assertPasswordAcceptable(nextPassword);
    if (rejected) return fail(400, rejected, "密码不可用");
    const now = this.now();
    await this.pool.query("UPDATE staff_accounts SET password_hash = $2 WHERE staff_id = $1", [
      staff.staff_id,
      await hashPassword(nextPassword),
    ]);
    await this.pool.query(
      "UPDATE staff_sessions SET revoked_at = $2 WHERE staff_id = $1 AND revoked_at IS NULL",
      [staff.staff_id, now],
    );
    await this.audit(staff.staff_id, "staff.password", null, null, { relogin: true }, null);
    return { ok: true, relogin: true };
  }

  async createStaff(token: string | null, emailRaw: string, password: string, role: string): Promise<Json | Failure> {
    const actor = await this.require(token, "staff");
    if ("code" in actor) return actor;
    const email = normalizeEmail(emailRaw);
    if (!email) return fail(400, "email_invalid", "邮箱格式不正确");
    if (role !== "support" && role !== "risk" && role !== "finance" && role !== "admin") {
      return fail(400, "role_invalid", "角色不正确");
    }
    const rejected = assertPasswordAcceptable(password);
    if (rejected) return fail(400, rejected, "密码不可用");
    const staffId = randomUUID();
    const now = this.now();
    try {
      await this.pool.query(
        `INSERT INTO staff_accounts
          (staff_id, email, password_hash, role, status, password_failure_count, created_at)
         VALUES ($1, $2, $3, $4, 'active', 0, $5)`,
        [staffId, email, await hashPassword(password), role, now],
      );
    } catch {
      return fail(409, "staff_exists", "这个内部账号已经有了");
    }
    await this.audit(actor.staffId, "staff.create", null, null, { staffId, role }, null);
    return { ok: true, staffId, role };
  }

  async disableStaff(token: string | null, staffId: string): Promise<Json | Failure> {
    const actor = await this.require(token, "staff");
    if ("code" in actor) return actor;
    if (actor.staffId === staffId) return fail(400, "staff_self_disable", "不能停用自己");
    const now = this.now();
    const updated = await this.pool.query(
      `UPDATE staff_accounts
          SET status = 'disabled', disabled_at = $2
        WHERE staff_id = $1 AND status <> 'disabled'`,
      [staffId, now],
    );
    if (!updated.rowCount) return fail(404, "staff_missing", "内部账号不存在");
    await this.pool.query(
      "UPDATE staff_sessions SET revoked_at = $2 WHERE staff_id = $1 AND revoked_at IS NULL",
      [staffId, now],
    );
    await this.audit(actor.staffId, "staff.disable", null, { status: "active" }, { status: "disabled" }, null);
    return { ok: true, status: "disabled" };
  }

  async lookupUser(token: string | null, phoneRaw: string | null): Promise<Json | Failure> {
    const actor = await this.require(token, "query");
    if ("code" in actor) return actor;
    const phone = phoneRaw ? normalizeMainlandPhone(phoneRaw) : null;
    if (!phone) return fail(400, "phone_invalid", "手机号格式不正确");
    const found = await this.pool.query<{
      account_id: string;
      status: string;
      lock_reason: string | null;
      real_name_verified_at: Date | null;
    }>(
      `SELECT account_id, status, lock_reason, real_name_verified_at
         FROM accounts WHERE phone = $1`,
      [phone],
    );
    const account = found.rows[0];
    if (!account) return fail(404, "account_missing", "没有这个用户");
    const devices = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM host_devices
        WHERE account_id = $1 AND removed_at IS NULL AND authorization_state = 'authorized'`,
      [account.account_id],
    );
    return {
      ok: true,
      accountId: account.account_id,
      phoneMask: maskPhone(phone),
      status: account.status,
      lockReason: account.lock_reason,
      realNameVerified: account.real_name_verified_at !== null,
      deviceCount: devices.rows[0]?.total ?? 0,
    };
  }

  async meter(token: string | null, accountId: string): Promise<Json | Failure> {
    const actor = await this.require(token, "query");
    if ("code" in actor) return actor;
    if (!isUuid(accountId)) return fail(400, "account_invalid", "账号不正确");
    const grants = await this.pool.query<{
      kind: string;
      bytes_total: string;
      remaining: string;
    }>(
      `SELECT g.kind,
              g.bytes_total::text,
              (g.bytes_total - COALESCE((SELECT SUM(bytes) FROM relay_ledger l WHERE l.relay_grant_id = g.relay_grant_id), 0))::text AS remaining
         FROM relay_grants g
        WHERE g.account_id = $1
        ORDER BY g.created_at DESC
        LIMIT 20`,
      [accountId],
    );
    const ledger = await this.pool.query<{ bytes: string; created_at: Date; remote_session_id: string; kind: string }>(
      `SELECT l.bytes::text, l.created_at, l.remote_session_id, g.kind
         FROM relay_ledger l
         JOIN relay_grants g ON g.relay_grant_id = l.relay_grant_id
        WHERE l.account_id = $1
        ORDER BY l.created_at DESC
        LIMIT 50`,
      [accountId],
    );
    return {
      ok: true,
      grants: grants.rows.map((row) => ({
        kind: row.kind,
        bytesTotal: Number(row.bytes_total),
        remaining: Number(row.remaining),
      })),
      ledger: ledger.rows.map((row) => ({
        bytes: Number(row.bytes),
        createdAt: row.created_at.toISOString(),
        remoteSessionId: row.remote_session_id,
        kind: row.kind,
      })),
    };
  }

  async orders(token: string | null, accountId: string): Promise<Json | Failure> {
    const actor = await this.require(token, "query");
    if ("code" in actor) return actor;
    if (!isUuid(accountId)) return fail(400, "account_invalid", "账号不正确");
    const rows = await this.pool.query<{
      order_id: string;
      state: string;
      amount_cents: number;
      price_version: string;
      pay_channel: string | null;
      created_at: Date;
    }>(
      `SELECT order_id, state, amount_cents, price_version, pay_channel, created_at
         FROM orders WHERE account_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [accountId],
    );
    return {
      ok: true,
      orders: rows.rows.map((row) => ({
        orderId: row.order_id,
        state: row.state,
        amountCents: row.amount_cents,
        priceVersion: row.price_version,
        payChannel: row.pay_channel,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  async compensate(token: string | null, accountId: string, bytes: number, reason: string): Promise<Json | Failure> {
    const actor = await this.require(token, "compensate");
    if ("code" in actor) return actor;
    const rejected = this.compensationInput(accountId, bytes, reason);
    if (rejected) return rejected;
    const threshold = this.config.freeRelayBytes * COMPENSATION_REVIEW_MULTIPLE;
    const now = this.now();
    if (bytes > threshold) {
      const approvalId = randomUUID();
      await this.pool.query(
        `INSERT INTO compensation_approvals
          (approval_id, account_id, bytes_total, reason, requested_by, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [approvalId, accountId, bytes, reason.trim(), actor.staffId, now],
      );
      await this.audit(actor.staffId, "compensation.request", accountId, null, { bytes, approvalId }, reason.trim());
      return { ok: true, status: "pending", approvalId };
    }
    await this.openCompensation(accountId, bytes, reason.trim(), actor.staffId, null, now);
    return { ok: true, status: "opened" };
  }

  async approveCompensation(token: string | null, approvalId: string): Promise<Json | Failure> {
    const actor = await this.require(token, "compensate");
    if ("code" in actor) return actor;
    if (!isUuid(approvalId)) return fail(400, "approval_invalid", "复核单不正确");
    const found = await this.pool.query<{
      account_id: string;
      bytes_total: string;
      reason: string;
      requested_by: string;
      status: string;
    }>(
      `SELECT account_id, bytes_total::text, reason, requested_by, status
         FROM compensation_approvals WHERE approval_id = $1`,
      [approvalId],
    );
    const row = found.rows[0];
    if (!row || row.status !== "pending") return fail(404, "approval_missing", "没有待复核的补偿");
    if (row.requested_by === actor.staffId) return fail(409, "approval_same_staff", "不能复核自己提交的补偿");
    const now = this.now();
    const updated = await this.pool.query(
      `UPDATE compensation_approvals
          SET status = 'opened', approved_by = $2
        WHERE approval_id = $1 AND status = 'pending'`,
      [approvalId, actor.staffId],
    );
    if (!updated.rowCount) return fail(404, "approval_missing", "没有待复核的补偿");
    await this.openCompensation(row.account_id, Number(row.bytes_total), row.reason, row.requested_by, actor.staffId, now);
    return { ok: true, status: "opened" };
  }

  async setBan(token: string | null, accountId: string, banned: boolean, reason: string): Promise<Json | Failure> {
    const actor = await this.require(token, "ban");
    if ("code" in actor) return actor;
    if (!isUuid(accountId)) return fail(400, "account_invalid", "账号不正确");
    if (!reason.trim()) return fail(400, "reason_required", "需要填写原因");
    const now = this.now();
    const status = banned ? "locked" : "active";
    const updated = await this.pool.query(
      `UPDATE accounts
          SET status = $2, lock_reason = $3, updated_at = $4
        WHERE account_id = $1 AND status <> 'deleted'`,
      [accountId, status, banned ? reason.trim() : null, now],
    );
    if (!updated.rowCount) return fail(404, "account_missing", "没有这个用户");
    await this.audit(actor.staffId, banned ? "account.ban" : "account.unban", accountId, null, { status }, reason.trim());
    return { ok: true, status };
  }

  async whitelist(token: string | null, hostDeviceId: string, controllerAccountId: string, reason: string, fraudAcknowledged: boolean): Promise<Json | Failure> {
    const actor = await this.require(token, "ban");
    if ("code" in actor) return actor;
    if (!isUuid(hostDeviceId) || !isUuid(controllerAccountId)) return fail(400, "account_invalid", "账号不正确");
    if (!reason.trim()) return fail(400, "reason_required", "需要填写原因");
    if (!fraudAcknowledged) {
      return fail(400, "fraud_ack_required", "例外加白也要再确认一次反诈", { fraudLines: fraudNotice() });
    }
    const now = this.now();
    await this.pool.query(
      `INSERT INTO host_trusted_controllers
        (host_device_id, controller_account_id, fraud_acknowledged_at, created_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT DO NOTHING`,
      [hostDeviceId, controllerAccountId, now],
    );
    await this.pool.query(
      `INSERT INTO controller_family_devices (controller_account_id, host_device_id, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [controllerAccountId, hostDeviceId, now],
    );
    await this.audit(actor.staffId, "trust.exception", controllerAccountId, null, { hostDeviceId }, reason.trim());
    return { ok: true, skipsConsent: false };
  }

  async refundJump(token: string | null, orderId: string): Promise<Json | Failure> {
    const actor = await this.require(token, "refund");
    if ("code" in actor) return actor;
    if (!isUuid(orderId)) return fail(400, "order_invalid", "订单不正确");
    const found = await this.pool.query<{ pay_channel: string | null; state: string }>(
      "SELECT pay_channel, state FROM orders WHERE order_id = $1",
      [orderId],
    );
    const order = found.rows[0];
    if (!order) return fail(404, "order_missing", "订单不存在");
    const channel = order.pay_channel === "wechat" || order.pay_channel === "alipay" ? order.pay_channel : null;
    await this.audit(actor.staffId, "refund.jump", null, null, { orderId, channel }, null);
    return {
      ok: true,
      jump: true,
      channel,
      url: channel ? CHANNEL_CONSOLE[channel] : null,
      urls: channel ? undefined : CHANNEL_CONSOLE,
      state: order.state,
    };
  }

  private compensationInput(accountId: string, bytes: number, reason: string): Failure | null {
    if (!isUuid(accountId)) return fail(400, "account_invalid", "账号不正确");
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return fail(400, "bytes_invalid", "补偿字节数不正确");
    if (!reason.trim()) return fail(400, "reason_required", "需要填写原因");
    return null;
  }

  private async openCompensation(
    accountId: string,
    bytes: number,
    reason: string,
    requestedBy: string,
    approvedBy: string | null,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO relay_grants
        (relay_grant_id, account_id, kind, bytes_total, expires_at, period_start, created_at)
       VALUES ($1, $2, 'compensation', $3, clock_timestamp() + interval '6 months', clock_timestamp(), clock_timestamp())`,
      [randomUUID(), accountId, bytes],
    );
    const minutes = Math.floor((bytes * 8) / (this.config.displayMinuteFloorKbps * 1000 * 60));
    const body = minutes > 0 ? `因为${reason}，补偿了你 ${minutes} 分钟` : `因为${reason}，补偿了你 ${bytes} 字节`;
    await this.pool.query(
      `INSERT INTO account_notices (account_notice_id, account_id, kind, body, created_at)
       VALUES ($1, $2, 'compensation', $3, $4)`,
      [randomUUID(), accountId, body, now],
    );
    await this.audit(approvedBy ?? requestedBy, "compensation.open", accountId, null, { bytes, requestedBy, approvedBy }, reason);
  }

  private async beginSetup(staff: StaffRow): Promise<Json> {
    let secret = staff.totp_secret;
    if (!secret) {
      secret = createTotpSecret();
      await this.pool.query("UPDATE staff_accounts SET totp_secret = $2 WHERE staff_id = $1", [staff.staff_id, secret]);
    }
    const setupToken = await this.issue(staff.staff_id, "setup");
    return { ok: true, setupRequired: true, totpSecret: secret, setupToken };
  }

  private async issue(staffId: string, purpose: "setup" | "access"): Promise<string> {
    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.tokenTtlMinutes * 60 * 1000);
    await this.pool.query(
      `INSERT INTO staff_sessions
        (staff_session_id, staff_id, token_hash, purpose, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), staffId, hashSecret(token), purpose, now, expiresAt],
    );
    return token;
  }

  private async require(token: string | null, action: "query" | "compensate" | "ban" | "refund" | "staff"): Promise<{ staffId: string; role: string } | Failure> {
    const staff = await this.staffFromToken(token, "access");
    if (!staff) return fail(401, "staff_login_failed", LOGIN_FAILED);
    if (!allowed(staff.role, action)) return fail(403, "staff_forbidden", "这个角色不能做这件事");
    return { staffId: staff.staff_id, role: staff.role };
  }

  private async staffFromToken(token: string | null, purpose: "setup" | "access"): Promise<StaffRow | null> {
    if (!token) return null;
    const found = await this.pool.query<StaffRow>(
      `SELECT a.staff_id, a.email, a.password_hash, a.role, a.status, a.totp_secret, a.totp_confirmed_at, a.password_failure_count
         FROM staff_sessions s
         JOIN staff_accounts a ON a.staff_id = s.staff_id
        WHERE s.token_hash = $1 AND s.purpose = $2 AND s.revoked_at IS NULL AND s.expires_at > $3
          AND a.status = 'active'`,
      [hashSecret(token), purpose, this.now()],
    );
    return found.rows[0] ?? null;
  }

  private async noteFailure(staff: StaffRow): Promise<number> {
    const nextCount = staff.password_failure_count + 1;
    if (nextCount >= STAFF_FAILURE_LIMIT) {
      await this.pool.query(
        "UPDATE staff_accounts SET password_failure_count = $2, status = 'locked' WHERE staff_id = $1",
        [staff.staff_id, nextCount],
      );
      await this.pool.query(
        "UPDATE staff_sessions SET revoked_at = $2 WHERE staff_id = $1 AND revoked_at IS NULL",
        [staff.staff_id, this.now()],
      );
      const admins = await this.pool.query<{ staff_id: string }>(
        "SELECT staff_id FROM staff_accounts WHERE role = 'admin' AND status = 'active' AND staff_id <> $1",
        [staff.staff_id],
      );
      for (const admin of admins.rows) {
        await this.pool.query(
          `INSERT INTO staff_notices (staff_notice_id, staff_id, kind, body, created_at)
           VALUES ($1, $2, 'staff_locked', $3, $4)`,
          [randomUUID(), admin.staff_id, staff.email, this.now()],
        );
      }
      await this.audit(staff.staff_id, "staff.lock", null, null, { status: "locked" }, null);
      return -1;
    }
    await this.pool.query(
      "UPDATE staff_accounts SET password_failure_count = $2 WHERE staff_id = $1",
      [staff.staff_id, nextCount],
    );
    return STAFF_FAILURE_LIMIT - nextCount;
  }

  private async consumeRecovery(staffId: string, recoveryCode: string | null): Promise<boolean> {
    if (!recoveryCode?.trim()) return false;
    const updated = await this.pool.query(
      `UPDATE staff_recovery_codes
          SET used_at = $3
        WHERE staff_id = $1 AND code_hash = $2 AND used_at IS NULL`,
      [staffId, hashSecret(recoveryCode.trim()), this.now()],
    );
    return Boolean(updated.rowCount);
  }

  private async replaceRecoveryCode(staffId: string, now: Date): Promise<string> {
    await this.pool.query("DELETE FROM staff_recovery_codes WHERE staff_id = $1 AND used_at IS NULL", [staffId]);
    const recoveryCode = createRecoveryCode();
    await this.pool.query(
      `INSERT INTO staff_recovery_codes (code_id, staff_id, code_hash, created_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), staffId, hashSecret(recoveryCode), now],
    );
    return recoveryCode;
  }

  private async burn(password: string): Promise<void> {
    if (!this.dummyHash) this.dummyHash = await hashPassword("not-a-real-staff-password");
    await verifyPassword(password, this.dummyHash);
  }

  private async audit(
    staffId: string,
    action: string,
    targetAccountId: string | null,
    beforeValue: Json | null,
    afterValue: Json | null,
    reason: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO staff_audit
        (staff_audit_id, staff_id, action, target_account_id, before_value, after_value, reason, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [randomUUID(), staffId, action, targetAccountId, JSON.stringify(beforeValue), JSON.stringify(afterValue), reason, this.now()],
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function routeOps(ops: OpsService, method: string, pathname: string, body: Json, token: string | null, phone: string | null): Promise<Json | Failure | null> {
  if (method === "POST" && pathname === "/v1/ops/sessions") {
    return ops.login(text(body, "email"), text(body, "password"), text(body, "totpCode"), text(body, "recoveryCode"));
  }
  if (method === "POST" && pathname === "/v1/ops/totp") {
    return ops.confirmTotp(text(body, "setupToken"), text(body, "totpCode"));
  }
  if (method === "POST" && pathname === "/v1/ops/password") {
    return ops.changePassword(token, text(body, "currentPassword") ?? "", text(body, "nextPassword") ?? "");
  }
  if (method === "POST" && pathname === "/v1/ops/staff") {
    return ops.createStaff(token, text(body, "email") ?? "", text(body, "password") ?? "", text(body, "role") ?? "");
  }
  const disableStaff = pathname.match(/^\/v1\/ops\/staff\/([^/]+)\/disable$/);
  if (method === "POST" && disableStaff?.[1]) return ops.disableStaff(token, disableStaff[1]);
  const userMeter = pathname.match(/^\/v1\/ops\/users\/([^/]+)\/meter$/);
  if (method === "GET" && userMeter?.[1]) return ops.meter(token, userMeter[1]);
  const userOrders = pathname.match(/^\/v1\/ops\/users\/([^/]+)\/orders$/);
  if (method === "GET" && userOrders?.[1]) return ops.orders(token, userOrders[1]);
  if (method === "GET" && pathname === "/v1/ops/users") return ops.lookupUser(token, phone);
  if (method === "POST" && pathname === "/v1/ops/compensations") {
    return ops.compensate(token, text(body, "accountId") ?? "", integer(body, "bytes"), text(body, "reason") ?? "");
  }
  const approve = pathname.match(/^\/v1\/ops\/compensations\/([^/]+)\/approve$/);
  if (method === "POST" && approve?.[1]) return ops.approveCompensation(token, approve[1]);
  const ban = pathname.match(/^\/v1\/ops\/users\/([^/]+)\/ban$/);
  if (method === "POST" && ban?.[1]) {
    return ops.setBan(token, ban[1], body.banned === true, text(body, "reason") ?? "");
  }
  if (method === "POST" && pathname === "/v1/ops/trusted-pairs") {
    return ops.whitelist(
      token,
      text(body, "hostDeviceId") ?? "",
      text(body, "controllerAccountId") ?? "",
      text(body, "reason") ?? "",
      body.fraudAcknowledged === true,
    );
  }
  const refund = pathname.match(/^\/v1\/ops\/orders\/([^/]+)\/refund-jump$/);
  if (method === "GET" && refund?.[1]) return ops.refundJump(token, refund[1]);
  if (pathname.startsWith("/v1/ops")) return fail(404, "not_found", "路径不存在");
  return null;
}

function text(body: Json, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function integer(body: Json, key: string): number {
  const value = body[key];
  return typeof value === "number" ? value : -1;
}
