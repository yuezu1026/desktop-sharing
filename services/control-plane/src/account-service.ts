import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "./config.js";
import {
  assertPasswordAcceptable,
  createChallengeCode,
  createRecoveryCode,
  createToken,
  hashPassword,
  hashSecret,
  maskPhone,
  normalizeEmail,
  normalizeMainlandPhone,
  secretsMatch,
  verifyPassword,
} from "./passwords.js";

const PASSWORD_FAILURE_LIMIT = 5;
const PASSWORD_LOCK_REASON = "密码错误 5 次";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_DOWNGRADE_DAYS = 90;
const IDLE_WARNING_LEAD_DAYS = 7;
const DELETION_GRACE_DAYS = 30;
const REBIND_COOLDOWN_DAYS = 7;
const AUDIT_RETENTION_DAYS = 183;

export type Failure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
};

type Success<T extends Record<string, unknown>> = { ok: true } & T;

type SessionContext = {
  loginSessionId: string;
  accountId: string;
  phone: string;
  email: string | null;
  status: string;
};

type ChallengePurpose = "register" | "login" | "forgot_password" | "email_bind" | "high_risk";

const CHALLENGE_PURPOSES = new Set<ChallengePurpose>([
  "register",
  "login",
  "forgot_password",
  "email_bind",
  "high_risk",
]);

function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Failure {
  return { ok: false, status, code, message, extra };
}

export class AccountService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly now: () => Date,
  ) {}

  async applySchema(): Promise<void> {
    const { schemaSql } = await import("./schema.js");
    await this.pool.query(schemaSql);
  }

  async createChallenge(input: {
    purpose: string;
    phone: string | null;
    email: string | null;
    token: string | null;
  }): Promise<Success<{ challengeId: string; devCode?: string }> | Failure> {
    if (!CHALLENGE_PURPOSES.has(input.purpose as ChallengePurpose)) {
      return fail(400, "unknown_purpose", "验证码用途不正确");
    }
    const purpose = input.purpose as ChallengePurpose;
    const phone = input.phone ? normalizeMainlandPhone(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (input.phone && !phone) return fail(400, "phone_invalid", "手机号格式不正确");
    if (input.email && !email) return fail(400, "email_invalid", "邮箱格式不正确");
    if ((purpose === "register" || purpose === "login" || purpose === "forgot_password" || purpose === "high_risk") && !phone && purpose !== "high_risk") {
      return fail(400, "phone_required", "需要手机号");
    }
    if (purpose === "email_bind" && !email) {
      return fail(400, "email_required", "需要邮箱");
    }

    let accountId: string | null = null;
    let boundPhone = phone;
    if (purpose === "high_risk" || purpose === "email_bind") {
      const session = await this.requireSession(input.token);
      if (isAuthFailure(session)) return session;
      accountId = session.accountId;
      if (purpose === "high_risk") boundPhone = phone ?? session.phone;
    }

    const code = createChallengeCode();
    const challengeId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + CHALLENGE_TTL_MS);
    await this.pool.query(
      `INSERT INTO verification_challenges
        (challenge_id, purpose, phone, email, code_hash, expires_at, account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [challengeId, purpose, boundPhone, email, hashSecret(code), expiresAt, accountId],
    );
    const payload: Success<{ challengeId: string; devCode?: string }> = { ok: true, challengeId };
    if (this.config.smsDevExpose) payload.devCode = code;
    return payload;
  }

  async register(input: {
    phone: string;
    challengeId: string;
    challengeCode: string;
    password: string;
    city: string | null;
  }): Promise<Success<{ accountId: string; token: string; recoveryCode: string }> | Failure> {
    const passwordError = assertPasswordAcceptable(input.password);
    if (passwordError) return fail(400, passwordError, "密码不可用");
    const phone = normalizeMainlandPhone(input.phone);
    if (!phone) return fail(400, "phone_invalid", "手机号格式不正确");

    return this.withTransaction(async (client) => {
      const consumed = await this.consumeChallenge(client, {
        challengeId: input.challengeId,
        code: input.challengeCode,
        purpose: "register",
        phone,
        email: null,
        accountId: null,
      });
      if (!consumed) return fail(400, "challenge_invalid", "验证码不正确或已过期");

      const existing = await client.query("SELECT account_id FROM accounts WHERE phone = $1", [phone]);
      if (existing.rowCount) return fail(409, "phone_taken", "这个手机号已经注册");

      const accountId = randomUUID();
      const recoveryCode = createRecoveryCode();
      const now = this.now();
      await client.query(
        `INSERT INTO accounts
          (account_id, phone, password_hash, recovery_code_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
        [accountId, phone, await hashPassword(input.password), hashSecret(recoveryCode), now],
      );
      const opened = await this.openSession(client, accountId, input.city, now, false);
      await this.audit(client, accountId, "account.register", {});
      return { ok: true as const, accountId, token: opened.token, recoveryCode };
    });
  }

  async login(input: {
    phone: string | null;
    email: string | null;
    password: string | null;
    challengeId: string | null;
    challengeCode: string | null;
    city: string | null;
  }): Promise<Success<{ token: string; loginSessionId: string }> | Failure> {
    const phone = input.phone ? normalizeMainlandPhone(input.phone) : null;
    const email = input.email ? normalizeEmail(input.email) : null;
    if (input.phone && !phone) return fail(400, "phone_invalid", "手机号格式不正确");
    if (input.email && !email) return fail(400, "email_invalid", "邮箱格式不正确");
    if (Boolean(phone) === Boolean(email)) return fail(400, "login_identity_required", "请使用手机号或已验证邮箱其中一种登录");
    const usingPassword = Boolean(input.password);
    const usingSms = Boolean(input.challengeId && input.challengeCode);
    if (usingSms && !phone) return fail(400, "sms_needs_phone", "短信登录只能使用手机号");
    if (usingPassword === usingSms) {
      return fail(400, "login_factor_required", "请使用密码或短信其中一种登录");
    }

    const found = await this.pool.query<{
      account_id: string;
      password_hash: string;
      status: string;
      lock_reason: string | null;
      password_failure_count: number;
    }>(
      phone
        ? "SELECT account_id, password_hash, status, lock_reason, password_failure_count FROM accounts WHERE phone = $1"
        : "SELECT account_id, password_hash, status, lock_reason, password_failure_count FROM accounts WHERE email = $1 AND email_verified_at IS NOT NULL",
      [phone ?? email],
    );
    const account = found.rows[0];
    if (!account || account.status === "deleted") return fail(401, "login_failed", "手机号或密码不正确");
    if (account.status === "locked") {
      return fail(403, "account_locked", account.lock_reason ?? "账号已锁定");
    }

    if (!usingSms) {
      const matched = await verifyPassword(input.password ?? "", account.password_hash);
      if (!matched) {
        const nextCount = account.password_failure_count + 1;
        const now = this.now();
        if (nextCount >= PASSWORD_FAILURE_LIMIT) {
          await this.pool.query(
            `UPDATE accounts
                SET password_failure_count = $2, status = 'locked', lock_reason = $3, updated_at = $4
              WHERE account_id = $1`,
            [account.account_id, nextCount, PASSWORD_LOCK_REASON, now],
          );
          return fail(403, "account_locked", PASSWORD_LOCK_REASON);
        }
        await this.pool.query(
          "UPDATE accounts SET password_failure_count = $2, updated_at = $3 WHERE account_id = $1",
          [account.account_id, nextCount, now],
        );
        return fail(401, "login_failed", "手机号或密码不正确");
      }
    }

    return this.withTransaction(async (client) => {
      if (usingSms) {
        const consumed = await this.consumeChallenge(client, {
          challengeId: input.challengeId ?? "",
          code: input.challengeCode ?? "",
          purpose: "login",
          phone,
          email: null,
          accountId: null,
        });
        if (!consumed) return fail(401, "login_failed", "验证码不正确或已过期");
      }
      await client.query(
        "UPDATE accounts SET password_failure_count = 0, updated_at = $2 WHERE account_id = $1",
        [account.account_id, this.now()],
      );
      const opened = await this.openSession(client, account.account_id, input.city, this.now(), true);
      await this.audit(client, account.account_id, "session.login", {});
      return { ok: true as const, token: opened.token, loginSessionId: opened.loginSessionId };
    });
  }

  async refresh(token: string | null): Promise<Success<{ token: string }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const nextToken = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.tokenTtlMinutes * 60 * 1000);
    await this.pool.query(
      `UPDATE login_sessions
          SET token_hash = $2, expires_at = $3, last_seen_at = $4
        WHERE login_session_id = $1 AND revoked_at IS NULL`,
      [session.loginSessionId, hashSecret(nextToken), expiresAt, now],
    );
    return { ok: true, token: nextToken };
  }

  async logout(token: string | null): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    await this.pool.query(
      "UPDATE login_sessions SET revoked_at = $2 WHERE login_session_id = $1",
      [session.loginSessionId, this.now()],
    );
    return { ok: true };
  }

  async getAccount(token: string | null): Promise<
    Success<{ phoneMask: string; email: string | null; status: string; deletionRequestedAt: string | null }> | Failure
  > {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const found = await this.pool.query<{ deletion_requested_at: Date | null }>(
      "SELECT deletion_requested_at FROM accounts WHERE account_id = $1",
      [session.accountId],
    );
    return {
      ok: true,
      phoneMask: maskPhone(session.phone),
      email: session.email,
      status: session.status,
      deletionRequestedAt: found.rows[0]?.deletion_requested_at?.toISOString() ?? null,
    };
  }

  async changePassword(token: string | null, oldPassword: string, newPassword: string): Promise<{ ok: true } | Failure> {
    const passwordError = assertPasswordAcceptable(newPassword);
    if (passwordError) return fail(400, passwordError, "密码不可用");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const found = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM accounts WHERE account_id = $1",
        [session.accountId],
      );
      const matched = await verifyPassword(oldPassword, found.rows[0]?.password_hash ?? "");
      if (!matched) return fail(400, "old_password_mismatch", "原密码不正确");
      const now = this.now();
      await client.query(
        `UPDATE accounts
            SET password_hash = $2, recovery_code_hash = NULL, password_failure_count = 0, updated_at = $3
          WHERE account_id = $1`,
        [session.accountId, await hashPassword(newPassword), now],
      );
      await client.query(
        `UPDATE login_sessions
            SET revoked_at = $3
          WHERE account_id = $1 AND login_session_id <> $2 AND revoked_at IS NULL`,
        [session.accountId, session.loginSessionId, now],
      );
      await this.audit(client, session.accountId, "password.change", {});
      return { ok: true as const };
    });
  }

  async forgotPassword(input: {
    phone: string;
    challengeId: string | null;
    challengeCode: string | null;
    recoveryCode: string | null;
    newPassword: string;
  }): Promise<{ ok: true } | Failure> {
    const passwordError = assertPasswordAcceptable(input.newPassword);
    if (passwordError) return fail(400, passwordError, "密码不可用");
    const phone = normalizeMainlandPhone(input.phone);
    if (!phone) return fail(400, "phone_invalid", "手机号格式不正确");
    const usingSms = Boolean(input.challengeId && input.challengeCode);
    const usingRecovery = Boolean(input.recoveryCode && input.recoveryCode.trim());
    if (usingSms === usingRecovery) {
      return fail(400, "recovery_factor_required", "请使用短信或恢复码其中一种找回密码");
    }
    return this.withTransaction(async (client) => {
      const found = await client.query<{
        account_id: string;
        status: string;
        lock_reason: string | null;
        recovery_code_hash: string | null;
      }>("SELECT account_id, status, lock_reason, recovery_code_hash FROM accounts WHERE phone = $1", [phone]);
      const account = found.rows[0];
      if (usingRecovery) {
        const recoveryCode = input.recoveryCode?.trim() ?? "";
        const matched = Boolean(account && account.status !== "deleted" && account.recovery_code_hash && secretsMatch(recoveryCode, account.recovery_code_hash));
        if (!matched) return fail(400, "recovery_invalid", "恢复码不正确或已使用");
      } else {
        const consumed = await this.consumeChallenge(client, {
          challengeId: input.challengeId ?? "",
          code: input.challengeCode ?? "",
          purpose: "forgot_password",
          phone,
          email: null,
          accountId: null,
        });
        if (!consumed) return fail(400, "challenge_invalid", "验证码不正确或已过期");
        if (!account || account.status === "deleted") return fail(404, "account_missing", "账号不存在");
      }
      if (!account || account.status === "deleted") return fail(400, "recovery_invalid", "恢复码不正确或已使用");
      const now = this.now();
      const unlock = account.lock_reason === PASSWORD_LOCK_REASON;
      await client.query(
        `UPDATE accounts
            SET password_hash = $2,
                recovery_code_hash = NULL,
                password_failure_count = 0,
                status = CASE WHEN $4 THEN 'active' ELSE status END,
                lock_reason = CASE WHEN $4 THEN NULL ELSE lock_reason END,
                updated_at = $3
          WHERE account_id = $1`,
        [account.account_id, await hashPassword(input.newPassword), now, unlock],
      );
      await client.query(
        "UPDATE login_sessions SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL",
        [account.account_id, now],
      );
      await this.audit(client, account.account_id, "password.forgot", {});
      return { ok: true as const };
    });
  }

  async rotateRecoveryCode(token: string | null): Promise<Success<{ recoveryCode: string }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const recoveryCode = createRecoveryCode();
    await this.pool.query(
      "UPDATE accounts SET recovery_code_hash = $2, updated_at = $3 WHERE account_id = $1",
      [session.accountId, hashSecret(recoveryCode), this.now()],
    );
    await this.audit(this.pool, session.accountId, "recovery_code.rotate", {});
    return { ok: true, recoveryCode };
  }

  async bindEmail(token: string | null, emailRaw: string, challengeId: string, challengeCode: string): Promise<{ ok: true } | Failure> {
    const email = normalizeEmail(emailRaw);
    if (!email) return fail(400, "email_invalid", "邮箱格式不正确");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const consumed = await this.consumeChallenge(client, {
        challengeId,
        code: challengeCode,
        purpose: "email_bind",
        phone: null,
        email,
        accountId: session.accountId,
      });
      if (!consumed) return fail(400, "challenge_invalid", "验证码不正确或已过期");
      try {
        await client.query(
          "UPDATE accounts SET email = $2, email_verified_at = $3, updated_at = $3 WHERE account_id = $1",
          [session.accountId, email, this.now()],
        );
      } catch (error) {
        if (isUniqueViolation(error)) return fail(409, "email_taken", "这个邮箱已被占用");
        throw error;
      }
      await this.audit(client, session.accountId, "email.bind", {});
      return { ok: true as const };
    });
  }

  async unbindEmail(token: string | null): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    if (!session.phone) return fail(409, "last_entrance", "不能解绑最后一个身份入口");
    await this.pool.query(
      "UPDATE accounts SET email = NULL, email_verified_at = NULL, updated_at = $2 WHERE account_id = $1",
      [session.accountId, this.now()],
    );
    await this.audit(this.pool, session.accountId, "email.unbind", {});
    return { ok: true };
  }

  async changePhone(token: string | null, input: {
    newPhone: string;
    password: string;
    challengeId: string;
    challengeCode: string;
  }): Promise<{ ok: true } | Failure> {
    const phone = normalizeMainlandPhone(input.newPhone);
    if (!phone) return fail(400, "phone_invalid", "手机号格式不正确");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const found = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM accounts WHERE account_id = $1",
        [session.accountId],
      );
      const matched = await verifyPassword(input.password, found.rows[0]?.password_hash ?? "");
      if (!matched) return fail(400, "old_password_mismatch", "原密码不正确");
      const consumed = await this.consumeChallenge(client, {
        challengeId: input.challengeId,
        code: input.challengeCode,
        purpose: "high_risk",
        phone,
        email: null,
        accountId: session.accountId,
      });
      if (!consumed) return fail(400, "challenge_invalid", "需要发到新手机号的短信验证码，恢复码不能单独改绑");
      try {
        await client.query(
          "UPDATE accounts SET phone = $2, updated_at = $3 WHERE account_id = $1",
          [session.accountId, phone, this.now()],
        );
      } catch (error) {
        if (isUniqueViolation(error)) return fail(409, "phone_taken", "这个手机号已经注册");
        throw error;
      }
      await this.audit(client, session.accountId, "phone.change", {});
      return { ok: true as const };
    });
  }

  async requestDeletion(token: string | null): Promise<Success<{ deletionRequestedAt: string; warning: string }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const updated = await this.pool.query<{ deletion_requested_at: Date }>(
      `UPDATE accounts
          SET status = 'pending_deletion',
              deletion_requested_at = COALESCE(deletion_requested_at, $2),
              updated_at = $2
        WHERE account_id = $1
        RETURNING deletion_requested_at`,
      [session.accountId, now],
    );
    await this.audit(this.pool, session.accountId, "account.deletion_request", {});
    return {
      ok: true,
      deletionRequestedAt: updated.rows[0]!.deletion_requested_at.toISOString(),
      warning: "注销账号不会停止渠道侧扣费",
    };
  }

  async cancelDeletion(token: string | null): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const found = await this.pool.query<{ status: string; deletion_requested_at: Date | null }>(
      "SELECT status, deletion_requested_at FROM accounts WHERE account_id = $1",
      [session.accountId],
    );
    const account = found.rows[0];
    if (!account || account.status !== "pending_deletion" || !account.deletion_requested_at) {
      return fail(409, "deletion_not_pending", "账号不在注销冷静期");
    }
    if (this.now().getTime() - account.deletion_requested_at.getTime() > DELETION_GRACE_DAYS * DAY_MS) {
      return fail(410, "deletion_elapsed", "冷静期已过");
    }
    await this.pool.query(
      `UPDATE accounts
          SET status = 'active', deletion_requested_at = NULL, updated_at = $2
        WHERE account_id = $1`,
      [session.accountId, this.now()],
    );
    await this.audit(this.pool, session.accountId, "account.deletion_cancel", {});
    return { ok: true };
  }

  async listSessions(token: string | null): Promise<Success<{ sessions: Array<Record<string, unknown>> }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<{
      login_session_id: string;
      city: string | null;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `SELECT login_session_id, city, created_at, last_seen_at, expires_at
         FROM login_sessions
        WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $2
        ORDER BY created_at DESC`,
      [session.accountId, this.now()],
    );
    return {
      ok: true,
      sessions: rows.rows.map((row) => ({
        loginSessionId: row.login_session_id,
        city: row.city,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        current: row.login_session_id === session.loginSessionId,
      })),
    };
  }

  async revokeSession(token: string | null, loginSessionId: string): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE login_sessions SET revoked_at = $3
        WHERE login_session_id = $1 AND account_id = $2 AND revoked_at IS NULL`,
      [loginSessionId, session.accountId, this.now()],
    );
    if (!updated.rowCount) return fail(404, "session_missing", "登录会话不存在");
    return { ok: true };
  }

  async revokeOtherSessions(token: string | null, challengeId: string, challengeCode: string): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const consumed = await this.consumeChallenge(client, {
        challengeId,
        code: challengeCode,
        purpose: "high_risk",
        phone: session.phone,
        email: null,
        accountId: session.accountId,
      });
      if (!consumed) return fail(400, "challenge_invalid", "退出其他设备需要短信验证，恢复码不能单独完成");
      const now = this.now();
      await client.query(
        `UPDATE login_sessions SET revoked_at = $3
          WHERE account_id = $1 AND login_session_id <> $2 AND revoked_at IS NULL`,
        [session.accountId, session.loginSessionId, now],
      );
      await this.audit(client, session.accountId, "session.revoke_others", {});
      return { ok: true as const };
    });
  }

  async listHostDevices(token: string | null): Promise<Success<{ devices: Array<Record<string, unknown>>; deviceQuota: number }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<{
      host_device_id: string;
      display_name: string;
      platform: string;
      connection_state: string;
      authorization_state: string;
      last_seen_at: Date | null;
    }>(
      `SELECT host_device_id, display_name, platform, connection_state, authorization_state, last_seen_at
         FROM host_devices
        WHERE account_id = $1 AND removed_at IS NULL
        ORDER BY created_at DESC`,
      [session.accountId],
    );
    return {
      ok: true,
      deviceQuota: this.config.deviceQuota,
      devices: rows.rows.map((row) => ({
        hostDeviceId: row.host_device_id,
        displayName: row.display_name,
        platform: row.platform,
        connectionState: row.connection_state,
        authorizationState: row.authorization_state,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
      })),
    };
  }

  async addHostDevice(token: string | null, input: {
    displayName: string;
    platform: string;
    hardwareFingerprint: string;
    challengeId: string | null;
    challengeCode: string | null;
  }): Promise<Success<{ hostDeviceId: string }> | Failure> {
    const displayName = input.displayName.trim();
    const platform = input.platform.trim();
    const fingerprint = input.hardwareFingerprint.trim();
    if (!displayName || displayName.length > 80) return fail(400, "display_name_invalid", "设备名不正确");
    if (!platform || platform.length > 32) return fail(400, "platform_invalid", "平台不正确");
    if (fingerprint.length < 8 || fingerprint.length > 200) return fail(400, "fingerprint_invalid", "设备指纹不正确");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;

    return this.withTransaction(async (client) => {
      await this.lockAccount(client, session.accountId);
      const live = await client.query(
        `SELECT host_device_id FROM host_devices
          WHERE account_id = $1 AND hardware_fingerprint = $2 AND removed_at IS NULL`,
        [session.accountId, fingerprint],
      );
      if (live.rowCount) return fail(409, "device_exists", "这台设备已在列表中");

      const rebound = await client.query<{ unbound_at: Date }>(
        `SELECT unbound_at FROM host_devices
          WHERE account_id = $1 AND hardware_fingerprint = $2 AND unbound_at IS NOT NULL
          ORDER BY unbound_at DESC LIMIT 1`,
        [session.accountId, fingerprint],
      );
      const unboundAt = rebound.rows[0]?.unbound_at;
      if (unboundAt && this.now().getTime() - unboundAt.getTime() < REBIND_COOLDOWN_DAYS * DAY_MS) {
        const consumed = await this.consumeChallenge(client, {
          challengeId: input.challengeId ?? "",
          code: input.challengeCode ?? "",
          purpose: "high_risk",
          phone: session.phone,
          email: null,
          accountId: session.accountId,
        });
        if (!consumed) return fail(400, "rebind_needs_second_factor", "解绑后 7 天内重新绑定需要短信验证");
      }

      const occupied = await this.countOccupied(client, session.accountId);
      if (occupied >= this.config.deviceQuota) return this.quotaFailure(client, session.accountId);

      const hostDeviceId = randomUUID();
      const now = this.now();
      await client.query(
        `INSERT INTO host_devices
          (host_device_id, account_id, display_name, platform, hardware_fingerprint,
           connection_state, authorization_state, created_at)
         VALUES ($1, $2, $3, $4, $5, 'never_connected', 'needs_confirmation', $6)`,
        [hostDeviceId, session.accountId, displayName, platform, fingerprint, now],
      );
      await this.audit(client, session.accountId, "host_device.add", { hostDeviceId });
      return { ok: true as const, hostDeviceId };
    });
  }

  async renameHostDevice(token: string | null, hostDeviceId: string, displayNameRaw: string): Promise<{ ok: true } | Failure> {
    const displayName = displayNameRaw.trim();
    if (!displayName || displayName.length > 80) return fail(400, "display_name_invalid", "设备名不正确");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE host_devices SET display_name = $3
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId, displayName],
    );
    if (!updated.rowCount) return fail(404, "device_missing", "设备不存在");
    return { ok: true };
  }

  async cancelAuthorization(token: string | null, hostDeviceId: string): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE host_devices SET authorization_state = 'cancelled'
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId],
    );
    if (!updated.rowCount) return fail(404, "device_missing", "设备不存在");
    await this.audit(this.pool, session.accountId, "host_device.cancel_authorization", { hostDeviceId });
    return { ok: true };
  }

  async removeHostDevice(token: string | null, hostDeviceId: string): Promise<Success<{ message: string }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const updated = await this.pool.query(
      `UPDATE host_devices
          SET removed_at = $3, unbound_at = $3, authorization_state = 'cancelled'
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId, now],
    );
    if (!updated.rowCount) return fail(404, "device_missing", "设备不存在");
    await this.audit(this.pool, session.accountId, "host_device.remove", { hostDeviceId });
    return { ok: true, message: "已取消该设备的全部授权" };
  }

  async removeAllHostDevices(token: string | null, challengeId: string, challengeCode: string): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const consumed = await this.consumeChallenge(client, {
        challengeId,
        code: challengeCode,
        purpose: "high_risk",
        phone: session.phone,
        email: null,
        accountId: session.accountId,
      });
      if (!consumed) return fail(400, "challenge_invalid", "移除全部设备需要短信验证，恢复码不能单独完成");
      const now = this.now();
      await client.query(
        `UPDATE host_devices
            SET removed_at = $2, unbound_at = $2, authorization_state = 'cancelled'
          WHERE account_id = $1 AND removed_at IS NULL`,
        [session.accountId, now],
      );
      await this.audit(client, session.accountId, "host_device.remove_all", {});
      return { ok: true as const };
    });
  }

  async confirmHostDevice(token: string | null, hostDeviceId: string, confirmedOnHost: boolean): Promise<{ ok: true } | Failure> {
    if (!confirmedOnHost) return fail(400, "host_confirmation_required", "必须在被控端本机确认");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      await this.lockAccount(client, session.accountId);
      const occupied = await this.countOccupied(client, session.accountId);
      if (occupied >= this.config.deviceQuota) return this.quotaFailure(client, session.accountId);
      const now = this.now();
      const updated = await client.query(
        `UPDATE host_devices
            SET authorization_state = 'authorized', idle_warning_sent_at = NULL, last_seen_at = $3
          WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL
            AND authorization_state IN ('needs_confirmation', 'cancelled')`,
        [hostDeviceId, session.accountId, now],
      );
      if (!updated.rowCount) return fail(404, "device_missing", "设备不存在或已授权");
      return { ok: true as const };
    });
  }

  async setPresence(token: string | null, hostDeviceId: string, state: string): Promise<{ ok: true } | Failure> {
    if (state !== "online" && state !== "offline") return fail(400, "presence_invalid", "状态只能是在线或离线");
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const updated = await this.pool.query(
      `UPDATE host_devices
          SET connection_state = $3, last_seen_at = CASE WHEN $3 = 'online' THEN $4 ELSE last_seen_at END
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId, state, now],
    );
    if (!updated.rowCount) return fail(404, "device_missing", "设备不存在");
    return { ok: true };
  }

  async listNotices(token: string | null): Promise<Success<{ notices: Array<Record<string, unknown>> }> | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<{
      account_notice_id: string;
      kind: string;
      body: string;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT account_notice_id, kind, body, created_at, read_at
         FROM account_notices
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [session.accountId],
    );
    return {
      ok: true,
      notices: rows.rows.map((row) => ({
        accountNoticeId: row.account_notice_id,
        kind: row.kind,
        body: row.body,
        createdAt: row.created_at.toISOString(),
        readAt: row.read_at?.toISOString() ?? null,
      })),
    };
  }

  async markNoticeRead(token: string | null, accountNoticeId: string): Promise<{ ok: true } | Failure> {
    const session = await this.requireSession(token);
    if (isAuthFailure(session)) return session;
    await this.pool.query(
      `UPDATE account_notices SET read_at = $3
        WHERE account_notice_id = $1 AND account_id = $2 AND read_at IS NULL`,
      [accountNoticeId, session.accountId, this.now()],
    );
    return { ok: true };
  }

  async runMaintenance(): Promise<void> {
    const now = this.now();
    await this.pool.query(
      `UPDATE host_devices
          SET authorization_state = 'needs_confirmation'
        WHERE removed_at IS NULL
          AND authorization_state = 'authorized'
          AND COALESCE(last_seen_at, created_at) < $1::timestamptz - ($2 || ' days')::interval`,
      [now, String(IDLE_DOWNGRADE_DAYS)],
    );
    const warnings = await this.pool.query<{
      host_device_id: string;
      account_id: string;
      display_name: string;
      idle_days: string;
    }>(
      `SELECT host_device_id, account_id, display_name,
              floor(extract(epoch FROM ($1::timestamptz - COALESCE(last_seen_at, created_at))) / 86400)::text AS idle_days
         FROM host_devices
        WHERE removed_at IS NULL
          AND authorization_state = 'authorized'
          AND idle_warning_sent_at IS NULL
          AND COALESCE(last_seen_at, created_at) < $1::timestamptz - ($2 || ' days')::interval
          AND COALESCE(last_seen_at, created_at) >= $1::timestamptz - ($3 || ' days')::interval`,
      [now, String(IDLE_DOWNGRADE_DAYS - IDLE_WARNING_LEAD_DAYS), String(IDLE_DOWNGRADE_DAYS)],
    );
    for (const row of warnings.rows) {
      const idleDays = Number(row.idle_days);
      const remainingDays = Math.max(1, IDLE_DOWNGRADE_DAYS - idleDays);
      await this.pool.query(
        `INSERT INTO account_notices (account_notice_id, account_id, kind, body, created_at)
         VALUES ($1, $2, 'idle_device', $3, $4)`,
        [
          randomUUID(),
          row.account_id,
          `设备「${row.display_name}」已 ${idleDays} 天未使用，将在 ${remainingDays} 天后需重新确认`,
          now,
        ],
      );
      await this.pool.query(
        "UPDATE host_devices SET idle_warning_sent_at = $2 WHERE host_device_id = $1",
        [row.host_device_id, now],
      );
    }

    const due = await this.pool.query<{ account_id: string }>(
      `SELECT account_id FROM accounts
        WHERE status = 'pending_deletion'
          AND deletion_requested_at < $1::timestamptz - ($2 || ' days')::interval`,
      [now, String(DELETION_GRACE_DAYS)],
    );
    for (const row of due.rows) {
      await this.pool.query(
        `UPDATE accounts
            SET phone = $2, email = NULL, email_verified_at = NULL, password_hash = 'deleted',
                recovery_code_hash = NULL, status = 'deleted', lock_reason = NULL,
                deletion_requested_at = NULL, updated_at = $3
          WHERE account_id = $1`,
        [row.account_id, `deleted-${row.account_id}`, now],
      );
      await this.pool.query(
        "UPDATE login_sessions SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL",
        [row.account_id, now],
      );
      await this.pool.query(
        `UPDATE host_devices
            SET removed_at = $2, authorization_state = 'cancelled'
          WHERE account_id = $1 AND removed_at IS NULL`,
        [row.account_id, now],
      );
      await this.audit(this.pool, row.account_id, "account.deletion_finalize", {});
      await this.pool.query("UPDATE audit_events SET account_id = NULL WHERE account_id = $1", [row.account_id]);
    }

    await this.pool.query(
      `DELETE FROM audit_events WHERE created_at < $1::timestamptz - ($2 || ' days')::interval`,
      [now, String(AUDIT_RETENTION_DAYS)],
    );
  }

  private async requireSession(token: string | null): Promise<SessionContext | Failure> {
    if (!token) return fail(401, "unauthorized", "需要登录");
    const found = await this.pool.query<{
      login_session_id: string;
      account_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      phone: string;
      email: string | null;
      status: string;
    }>(
      `SELECT s.login_session_id, s.account_id, s.expires_at, s.revoked_at, a.phone, a.email, a.status
         FROM login_sessions s
         JOIN accounts a ON a.account_id = s.account_id
        WHERE s.token_hash = $1`,
      [hashSecret(token)],
    );
    const row = found.rows[0];
    const now = this.now();
    if (!row || row.revoked_at || row.expires_at <= now || row.status === "deleted") {
      return fail(401, "unauthorized", "登录已失效");
    }
    await this.pool.query(
      "UPDATE login_sessions SET last_seen_at = $2 WHERE login_session_id = $1",
      [row.login_session_id, now],
    );
    return {
      loginSessionId: row.login_session_id,
      accountId: row.account_id,
      phone: row.phone,
      email: row.email,
      status: row.status,
    };
  }

  private async openSession(
    client: PoolClient,
    accountId: string,
    city: string | null,
    now: Date,
    notifyExisting: boolean,
  ): Promise<{ token: string; loginSessionId: string }> {
    const existing = await client.query(
      `SELECT login_session_id FROM login_sessions
        WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [accountId, now],
    );
    const token = createToken();
    const loginSessionId = randomUUID();
    const safeCity = city && city.trim().length > 0 ? city.trim().slice(0, 40) : null;
    await client.query(
      `INSERT INTO login_sessions
        (login_session_id, account_id, token_hash, city, created_at, expires_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5)`,
      [
        loginSessionId,
        accountId,
        hashSecret(token),
        safeCity,
        now,
        new Date(now.getTime() + this.config.tokenTtlMinutes * 60 * 1000),
      ],
    );
    if (notifyExisting && existing.rowCount) {
      await client.query(
        `INSERT INTO account_notices (account_notice_id, account_id, kind, body, created_at)
         VALUES ($1, $2, 'new_login', $3, $4)`,
        [randomUUID(), accountId, safeCity ? `新设备在${safeCity}登录` : "有新设备登录", now],
      );
    }
    return { token, loginSessionId };
  }

  private async consumeChallenge(
    client: PoolClient,
    input: {
      challengeId: string;
      code: string;
      purpose: ChallengePurpose;
      phone: string | null;
      email: string | null;
      accountId: string | null;
    },
  ): Promise<boolean> {
    const updated = await client.query(
      `UPDATE verification_challenges
          SET consumed_at = $7
        WHERE challenge_id = $1
          AND purpose = $2
          AND code_hash = $3
          AND consumed_at IS NULL
          AND expires_at > $7
          AND phone IS NOT DISTINCT FROM $4
          AND email IS NOT DISTINCT FROM $5
          AND account_id IS NOT DISTINCT FROM $6`,
      [
        input.challengeId,
        input.purpose,
        hashSecret(input.code),
        input.phone,
        input.email,
        input.accountId,
        this.now(),
      ],
    );
    return Boolean(updated.rowCount);
  }

  private async lockAccount(client: PoolClient, accountId: string): Promise<void> {
    await client.query("SELECT account_id FROM accounts WHERE account_id = $1 FOR UPDATE", [accountId]);
  }

  private async quotaFailure(client: PoolClient, accountId: string): Promise<Failure> {
    const oldest = await client.query<{ host_device_id: string; display_name: string }>(
      `SELECT host_device_id, display_name FROM host_devices
        WHERE account_id = $1 AND removed_at IS NULL AND authorization_state = 'authorized'
        ORDER BY last_seen_at NULLS FIRST, created_at
        LIMIT 1`,
      [accountId],
    );
    return fail(409, "device_quota", "已达设备上限，请先移除一台。闲置超过 90 天的设备会自动释放名额。", {
      deviceQuota: this.config.deviceQuota,
      oldestHostDeviceId: oldest.rows[0]?.host_device_id ?? null,
      oldestDisplayName: oldest.rows[0]?.display_name ?? null,
    });
  }

  private async countOccupied(client: PoolClient, accountId: string): Promise<number> {
    const found = await client.query<{ occupied: number }>(
      `SELECT COUNT(*)::int AS occupied FROM host_devices
        WHERE account_id = $1 AND removed_at IS NULL AND authorization_state = 'authorized'`,
      [accountId],
    );
    return found.rows[0]?.occupied ?? 0;
  }

  private async audit(runner: Pool | PoolClient, accountId: string, action: string, detail: Record<string, unknown>): Promise<void> {
    await runner.query(
      `INSERT INTO audit_events (audit_event_id, account_id, action, detail, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [randomUUID(), accountId, action, JSON.stringify(detail), this.now()],
    );
  }

  private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      if (isFailure(result)) {
        await client.query("ROLLBACK");
        return result;
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function isAuthFailure(value: SessionContext | Failure): value is Failure {
  return "code" in value;
}

function isFailure(value: unknown): value is Failure {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok: boolean }).ok === false);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");
}
