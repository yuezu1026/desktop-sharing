import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AccountService, type Failure, type SessionContext } from "./account-service.js";
import type { AppConfig } from "./config.js";
import { createToken, hashSecret, maskPhone } from "./passwords.js";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_ACCOUNT_FREEZE_MS = DAY_MS;
const HEARTBEAT_MAX_BYTES = 256 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Directive = "continue" | "warn" | "suggest_direct" | "degraded" | "stop_relay";

/** 免费额度用到一半才提示。50% 是已定阈值，不从客户端传入。 */
const REAL_NAME_USED_SHARE = 2;
/** 同一控制端 7 天内不同被控设备达到此数才提示。数字来自已定规则。 */
const REAL_NAME_DISTINCT_HOSTS = 3;
const REAL_NAME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 周活跃只计建成后至少这么久的会话。已定口径，不从客户端传入。 */
const ACTIVE_SESSION_MIN_SECONDS = 30;
const PUNCH_BUCKETS = ["home_home", "one_hard_nat", "both_hard_nat", "udp_blocked"] as const;

function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Failure {
  return { ok: false, status, code, message, extra };
}

function normalizePunchBucket(raw: string | null): string | null | Failure {
  if (!raw || raw.trim() === "") return null;
  const bucket = raw.trim();
  if (bucket !== "home_home" && bucket !== "one_hard_nat" && bucket !== "both_hard_nat" && bucket !== "udp_blocked") {
    return fail(400, "punch_bucket_invalid", "打洞分桶不正确");
  }
  return bucket;
}

/** 中继 ticket、额度账本和直连起止。直连不入账。通道数未拍板时不拦截。 */
export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly accounts: AccountService,
    private readonly now: () => Date,
  ) {}

  async requestSession(
    token: string | null,
    hostDeviceId: string,
    controllerFingerprintRaw: string,
  ): Promise<Record<string, unknown> | Failure> {
    const controllerFingerprint = controllerFingerprintRaw.trim();
    if (!isUuid(hostDeviceId)) return fail(400, "host_device_invalid", "被控设备不正确");
    if (controllerFingerprint.length < 8 || controllerFingerprint.length > 200) {
      return fail(400, "fingerprint_invalid", "控制端指纹不正确");
    }
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const disclosed = await this.pool.query<{ connection_disclosure_at: Date | null }>(
      "SELECT connection_disclosure_at FROM accounts WHERE account_id = $1",
      [session.accountId],
    );
    if (!disclosed.rows[0]?.connection_disclosure_at) {
      return fail(409, "disclosure_required", "连接前需要先确认隐私说明", connectionDisclosure());
    }

    return this.withTransaction(async (client) => {
      await client.query("SELECT account_id FROM accounts WHERE account_id = $1 FOR UPDATE", [session.accountId]);
      const host = await this.loadHost(client, hostDeviceId);
      if (!host) return fail(404, "device_missing", "设备不存在");
      if (!host.acceptingConnections) return fail(409, "host_not_accepting", "这台电脑现在不允许被连接");
      if (host.authorizationState !== "authorized") {
        return fail(409, "host_needs_confirmation", "被控端需要先在本机确认");
      }
      const concurrency = await this.concurrencyFailure(client, session.accountId, host.hostDeviceId);
      if (concurrency) return concurrency;

      const crossAccount = host.accountId !== session.accountId;
      const prior = await client.query(
        `SELECT remote_session_id FROM remote_sessions
          WHERE host_device_id = $1 AND controller_fingerprint = $2
            AND state IN ('active', 'relay_stopped')
          LIMIT 1`,
        [host.hostDeviceId, controllerFingerprint],
      );
      const needsHostConsent = crossAccount || !prior.rowCount;
      const remoteSessionId = randomUUID();
      const now = this.now();
      const state = needsHostConsent ? "awaiting_host_consent" : "active";
      await client.query(
        `INSERT INTO remote_sessions
          (remote_session_id, account_id, host_device_id, host_account_id, controller_fingerprint,
           host_fingerprint, state, cross_account, bitrate_kbps, created_at, controller_phone_mask, established_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          remoteSessionId,
          session.accountId,
          host.hostDeviceId,
          host.accountId,
          controllerFingerprint,
          host.fingerprint,
          state,
          crossAccount,
          this.config.freeBitrateKbps,
          now,
          maskPhone(session.phone),
          state === "active" ? now : null,
        ],
      );
      await this.audit(client, session.accountId, "remote_session.request", { remoteSessionId, crossAccount, needsHostConsent });
      if (needsHostConsent) {
        return {
          ok: true as const,
          remoteSessionId,
          state,
          crossAccount,
          relayAllowed: false,
          ticket: null,
          ticketExpiresAt: null,
          bitrateKbps: this.config.freeBitrateKbps,
          maxFps: this.config.freeMaxFps,
          remainingBytes: await this.remainingBytes(client, session.accountId, now),
        };
      }
      return this.openRelay(client, session, remoteSessionId, controllerFingerprint, now, crossAccount);
    });
  }

  async consent(token: string | null, remoteSessionId: string, confirmedOnHost: boolean): Promise<Record<string, unknown> | Failure> {
    if (!confirmedOnHost) return fail(400, "host_confirmation_required", "必须在被控端本机确认");
    if (!isUuid(remoteSessionId)) return fail(400, "session_invalid", "会话不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    return this.withTransaction(async (client) => {
      const found = await client.query<{
        account_id: string;
        host_account_id: string;
        state: string;
        controller_fingerprint: string;
      }>(
        `SELECT account_id, host_account_id, state, controller_fingerprint
           FROM remote_sessions WHERE remote_session_id = $1 FOR UPDATE`,
        [remoteSessionId],
      );
      const row = found.rows[0];
      if (!row || row.host_account_id !== session.accountId) return fail(404, "session_missing", "会话不存在");
      if (row.state !== "awaiting_host_consent") return fail(409, "consent_not_pending", "这场会话不在等待确认");
      const now = this.now();
      await client.query(
        "UPDATE remote_sessions SET state = 'active', established_at = $2 WHERE remote_session_id = $1",
        [remoteSessionId, now],
      );
      await this.audit(client, session.accountId, "remote_session.consent", { remoteSessionId });
      return this.openRelay(client, { ...session, accountId: row.account_id }, remoteSessionId, row.controller_fingerprint, now, true);
    });
  }

  async listIncoming(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<{
      remote_session_id: string;
      controller_phone_mask: string | null;
      cross_account: boolean;
      first_connection: boolean;
    }>(
      `SELECT remote_session_id, controller_phone_mask, cross_account,
              NOT EXISTS (
                SELECT 1 FROM remote_sessions older
                 WHERE older.host_device_id = remote_sessions.host_device_id
                   AND older.controller_fingerprint = remote_sessions.controller_fingerprint
                   AND older.state IN ('active', 'relay_stopped')
              ) AS first_connection
         FROM remote_sessions
        WHERE host_account_id = $1 AND state = 'awaiting_host_consent'
        ORDER BY created_at`,
      [session.accountId],
    );
    return {
      ok: true,
      incoming: rows.rows.map((row) => ({
        remoteSessionId: row.remote_session_id,
        controllerPhoneMask: row.controller_phone_mask,
        crossAccount: row.cross_account,
        firstConnection: row.first_connection,
      })),
    };
  }

  /** 首次连接前只确认一次。文案在服务端，避免客户端写成「端到端加密」或「看不到任何数据」。 */
  async connectionDisclosure(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const found = await this.pool.query<{ connection_disclosure_at: Date | null }>(
      "SELECT connection_disclosure_at FROM accounts WHERE account_id = $1",
      [session.accountId],
    );
    return {
      ok: true,
      acknowledged: Boolean(found.rows[0]?.connection_disclosure_at),
      ...connectionDisclosure(),
    };
  }

  async acknowledgeDisclosure(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    await this.pool.query(
      `UPDATE accounts
          SET connection_disclosure_at = COALESCE(connection_disclosure_at, $2), updated_at = $2
        WHERE account_id = $1`,
      [session.accountId, now],
    );
    return this.connectionDisclosure(token);
  }

  /** 没触发就不提示。跨账号不在这里要求实名，闸门在被控端确认。 */
  async realName(
    token: string | null,
    controllerFingerprint: string | null,
    hostDeviceId: string | null,
  ): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const prompt = await this.realNamePrompt(this.pool, session.accountId, controllerFingerprint, this.now(), hostDeviceId);
    return { ok: true, realName: prompt };
  }

  /** 核验结果只记时间。证件号和照片不进这张表。 */
  async recordRealName(secret: string | null, accountId: string, acceptsIdentity: boolean): Promise<Record<string, unknown> | Failure> {
    if (!this.config.realNameCallbackSecret) return fail(503, "real_name_unconfigured", "实名核验尚未配置");
    if (secret !== this.config.realNameCallbackSecret) return fail(401, "real_name_callback_invalid", "实名回调校验失败");
    if (acceptsIdentity) return fail(400, "real_name_identity_rejected", "证件信息不由这里接收");
    if (!/^[0-9a-f-]{36}$/i.test(accountId)) return fail(400, "account_invalid", "账号不正确");
    const updated = await this.pool.query(
      `UPDATE accounts
          SET real_name_verified_at = COALESCE(real_name_verified_at, $2), updated_at = $2
        WHERE account_id = $1`,
      [accountId, this.now()],
    );
    if (!updated.rowCount) return fail(404, "account_missing", "账号不存在");
    return { ok: true, verified: true };
  }

  /** 被控端这边的名单。来源只能是已经在这台电脑上确认过的账号，不另造一套绑定。 */
  async listTrustedControllers(token: string | null, hostDeviceId: string): Promise<Record<string, unknown> | Failure> {
    const owned = await this.ownedHost(token, hostDeviceId);
    if ("code" in owned) return owned;
    const rows = await this.pool.query<{ controller_account_id: string; phone: string }>(
      `SELECT t.controller_account_id, a.phone
         FROM host_trusted_controllers t
         JOIN accounts a ON a.account_id = t.controller_account_id
        WHERE t.host_device_id = $1
        ORDER BY t.created_at`,
      [hostDeviceId],
    );
    return {
      ok: true,
      skipsConsent: false,
      fraudLines: fraudNotice(),
      controllers: rows.rows.map((row) => ({
        controllerAccountId: row.controller_account_id,
        phoneMask: maskPhone(row.phone),
      })),
    };
  }

  async trustController(
    token: string | null,
    hostDeviceId: string,
    controllerAccountId: string,
    fraudAcknowledged: boolean,
  ): Promise<Record<string, unknown> | Failure> {
    if (!isUuid(controllerAccountId)) return fail(400, "account_invalid", "账号不正确");
    const owned = await this.ownedHost(token, hostDeviceId);
    if ("code" in owned) return owned;
    const existing = await this.pool.query(
      `SELECT 1 FROM host_trusted_controllers
        WHERE host_device_id = $1 AND controller_account_id = $2`,
      [hostDeviceId, controllerAccountId],
    );
    if (!existing.rowCount) {
      if (!fraudAcknowledged) {
        return fail(400, "fraud_ack_required", "新增受信任的控制端必须再确认一次反诈", { fraudLines: fraudNotice() });
      }
      const prior = await this.pool.query(
        `SELECT 1 FROM remote_sessions
          WHERE host_device_id = $1 AND account_id = $2 AND host_account_id = $3
            AND state IN ('active', 'relay_stopped', 'closed')
          LIMIT 1`,
        [hostDeviceId, controllerAccountId, owned.accountId],
      );
      if (!prior.rowCount) return fail(409, "trust_needs_consent", "只能信任已经在这台电脑上确认过的账号");
      const now = this.now();
      await this.pool.query(
        `INSERT INTO host_trusted_controllers
          (host_device_id, controller_account_id, fraud_acknowledged_at, created_at)
         VALUES ($1, $2, $3, $3)`,
        [hostDeviceId, controllerAccountId, now],
      );
    }
    return this.listTrustedControllers(token, hostDeviceId);
  }

  async untrustController(token: string | null, hostDeviceId: string, controllerAccountId: string): Promise<Record<string, unknown> | Failure> {
    if (!isUuid(controllerAccountId)) return fail(400, "account_invalid", "账号不正确");
    const owned = await this.ownedHost(token, hostDeviceId);
    if ("code" in owned) return owned;
    await this.pool.query(
      "DELETE FROM host_trusted_controllers WHERE host_device_id = $1 AND controller_account_id = $2",
      [hostDeviceId, controllerAccountId],
    );
    return this.listTrustedControllers(token, hostDeviceId);
  }

  /** 控制端把某台电脑标成家人设备。单边标记不会豁免。 */
  async setFamilyDevice(token: string | null, hostDeviceId: string, family: boolean): Promise<Record<string, unknown> | Failure> {
    if (!isUuid(hostDeviceId)) return fail(400, "host_device_invalid", "被控设备不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const device = await this.pool.query(
      "SELECT 1 FROM host_devices WHERE host_device_id = $1 AND removed_at IS NULL",
      [hostDeviceId],
    );
    if (!device.rowCount) return fail(404, "device_missing", "设备不存在");
    if (family) {
      const prior = await this.pool.query(
        `SELECT 1 FROM remote_sessions
          WHERE host_device_id = $1 AND account_id = $2
            AND state IN ('active', 'relay_stopped', 'closed')
          LIMIT 1`,
        [hostDeviceId, session.accountId],
      );
      if (!prior.rowCount) return fail(409, "family_needs_session", "只能标记已经连过的电脑");
      await this.pool.query(
        `INSERT INTO controller_family_devices (controller_account_id, host_device_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (controller_account_id, host_device_id) DO NOTHING`,
        [session.accountId, hostDeviceId, this.now()],
      );
    } else {
      await this.pool.query(
        "DELETE FROM controller_family_devices WHERE controller_account_id = $1 AND host_device_id = $2",
        [session.accountId, hostDeviceId],
      );
    }
    return { ok: true, family };
  }

  /** 拒绝只结束这一次请求。扣款失败不在会话断开时推送。 */
  async rejectIncoming(token: string | null, remoteSessionId: string): Promise<{ ok: true } | Failure> {
    if (!isUuid(remoteSessionId)) return fail(400, "session_invalid", "会话不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE remote_sessions
          SET state = 'rejected', closed_at = $3
        WHERE remote_session_id = $1 AND host_account_id = $2 AND state = 'awaiting_host_consent'`,
      [remoteSessionId, session.accountId, this.now()],
    );
    if (!updated.rowCount) return fail(404, "session_missing", "会话不存在");
    return { ok: true };
  }

  async setInputAllowed(token: string | null, remoteSessionId: string, allowed: boolean): Promise<{ ok: true } | Failure> {
    if (!isUuid(remoteSessionId)) return fail(400, "session_invalid", "会话不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE remote_sessions
          SET input_revoked = $3
        WHERE remote_session_id = $1 AND host_account_id = $2 AND state = 'active'`,
      [remoteSessionId, session.accountId, !allowed],
    );
    if (!updated.rowCount) return fail(404, "session_missing", "会话不存在");
    return { ok: true };
  }

  async stopControlled(token: string | null, hostDeviceId: string): Promise<{ ok: true } | Failure> {
    if (!isUuid(hostDeviceId)) return fail(400, "host_device_invalid", "被控设备不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const device = await this.pool.query(
      `UPDATE host_devices SET accepting_connections = false
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId],
    );
    if (!device.rowCount) return fail(404, "device_missing", "设备不存在");
    await this.pool.query(
      `UPDATE relay_tickets SET revoked_at = $2
        WHERE revoked_at IS NULL AND remote_session_id IN (
          SELECT remote_session_id FROM remote_sessions
           WHERE host_device_id = $1 AND host_account_id = $3
             AND state IN ('active', 'awaiting_host_consent', 'relay_stopped')
        )`,
      [hostDeviceId, now, session.accountId],
    );
    await this.pool.query(
      `UPDATE remote_sessions
          SET state = 'closed', closed_at = $3
        WHERE host_device_id = $1 AND host_account_id = $2
          AND state IN ('active', 'awaiting_host_consent', 'relay_stopped')`,
      [hostDeviceId, session.accountId, now],
    );
    return { ok: true };
  }

  async reportDirect(
    token: string | null,
    remoteSessionId: string,
    input: { event: string; punchResult: string | null; punchBucket: string | null; bitrateKbps: number | null },
  ): Promise<Record<string, unknown> | Failure> {
    if (!isUuid(remoteSessionId)) return fail(400, "session_invalid", "会话不正确");
    if (input.event !== "start" && input.event !== "stop") return fail(400, "direct_event_invalid", "直连事件只能是开始或结束");
    if (input.punchResult && input.punchResult.trim().length > 40) return fail(400, "punch_invalid", "打洞结果不正确");
    const punchBucket = normalizePunchBucket(input.punchBucket);
    if (punchBucket && typeof punchBucket !== "string") return punchBucket;
    if (input.bitrateKbps !== null && (input.bitrateKbps <= 0 || input.bitrateKbps > 100_000)) {
      return fail(400, "bitrate_invalid", "码率不正确");
    }
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const updated = await this.pool.query(
      `UPDATE remote_sessions
          SET direct_started_at = CASE WHEN $3 = 'start' THEN COALESCE(direct_started_at, $4) ELSE direct_started_at END,
              direct_stopped_at = CASE WHEN $3 = 'stop' THEN $4 ELSE direct_stopped_at END,
              punch_result = COALESCE($5, punch_result),
              punch_bucket = COALESCE($7, punch_bucket),
              reported_bitrate_kbps = COALESCE($6, reported_bitrate_kbps)
        WHERE remote_session_id = $1
          AND (account_id = $2 OR host_account_id = $2)
          AND state IN ('active', 'relay_stopped')`,
      [remoteSessionId, session.accountId, input.event, now, input.punchResult?.trim() ?? null, input.bitrateKbps, punchBucket],
    );
    if (!updated.rowCount) return fail(404, "session_missing", "会话不存在");
    return { ok: true, billed: false };
  }

  /** 周活跃与打洞分桶。手机被控、电脑控手机单独计，不进主口径。 */
  async connectionStats(): Promise<Record<string, unknown>> {
    const now = this.now();
    const counted = await this.pool.query<{ hook_mark: string | null; total: number }>(
      `SELECT hook_mark, COUNT(*)::int AS total
         FROM remote_sessions
        WHERE metadata_purged_at IS NULL
          AND established_at IS NOT NULL
          AND established_at >= $1::timestamptz - interval '7 days'
          AND state IN ('active', 'relay_stopped', 'closed')
          AND EXTRACT(EPOCH FROM (COALESCE(closed_at, $1::timestamptz) - established_at)) >= $2
        GROUP BY hook_mark`,
      [now, ACTIVE_SESSION_MIN_SECONDS],
    );
    let weeklyActiveSessions = 0;
    let phoneHostSessions = 0;
    let pcToPhoneSessions = 0;
    for (const row of counted.rows) {
      if (row.hook_mark === null) weeklyActiveSessions = row.total;
      else if (row.hook_mark === "phone_host") phoneHostSessions = row.total;
      else if (row.hook_mark === "pc_to_phone") pcToPhoneSessions = row.total;
    }
    const punches = await this.pool.query<{ punch_bucket: string; attempts: number; direct_count: number }>(
      `SELECT punch_bucket,
              COUNT(*)::int AS attempts,
              COUNT(*) FILTER (WHERE direct_started_at IS NOT NULL)::int AS direct_count
         FROM remote_sessions
        WHERE metadata_purged_at IS NULL
          AND punch_bucket IS NOT NULL
        GROUP BY punch_bucket`,
      [],
    );
    const byBucket = new Map(punches.rows.map((row) => [row.punch_bucket, row]));
    return {
      ok: true,
      weeklyActiveSessions,
      phoneHostSessions,
      pcToPhoneSessions,
      punchBuckets: PUNCH_BUCKETS.map((bucket) => {
        const row = byBucket.get(bucket);
        return {
          bucket,
          attempts: row?.attempts ?? 0,
          direct: row?.direct_count ?? 0,
        };
      }),
    };
  }

  /** 连接元数据保留 6 个日历月。账本行留下，画面和指纹清掉。 */
  async purgeConnectionMetadata(): Promise<void> {
    const now = this.now();
    const expired = await this.pool.query<{ remote_session_id: string }>(
      `UPDATE remote_sessions
          SET controller_fingerprint = '',
              host_fingerprint = '',
              controller_phone_mask = NULL,
              punch_result = NULL,
              punch_bucket = NULL,
              reported_bitrate_kbps = NULL,
              direct_started_at = NULL,
              direct_stopped_at = NULL,
              metadata_purged_at = $1
        WHERE metadata_purged_at IS NULL
          AND closed_at IS NOT NULL
          AND closed_at < $1::timestamptz - interval '6 months'
        RETURNING remote_session_id`,
      [now],
    );
    const sessionIds = expired.rows.map((row) => row.remote_session_id);
    if (sessionIds.length === 0) return;
    await this.pool.query("DELETE FROM relay_heartbeats WHERE remote_session_id = ANY($1::uuid[])", [sessionIds]);
  }

  async balance(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const now = this.now();
    const remainingBytes = await this.remainingBytes(this.pool, session.accountId, now);
    const totalBytes = await this.grantTotal(this.pool, session.accountId, now);
    const usedRatio = totalBytes <= 0 ? 1 : (totalBytes - remainingBytes) / totalBytes;
    const showBalance = usedRatio >= 0.8 || remainingBytes <= 0;
    const latest = await this.pool.query<{
      bitrate_kbps: number;
      state: string;
      input_revoked: boolean;
      controller_fingerprint: string;
      host_device_id: string;
    }>(
      `SELECT bitrate_kbps, state, input_revoked, controller_fingerprint, host_device_id
         FROM remote_sessions
        WHERE account_id = $1 AND state IN ('active', 'relay_stopped')
        ORDER BY created_at DESC
        LIMIT 1`,
      [session.accountId],
    );
    const current = latest.rows[0];
    const bitrateKbps = current?.bitrate_kbps ?? this.config.freeBitrateKbps;
    const rateKbps = Math.max(bitrateKbps, this.config.displayMinuteFloorKbps);
    const displayMinutes = remainingBytes <= 0 ? null : Math.floor((remainingBytes * 8) / (rateKbps * 1000 * 60));
    const relayStopped = remainingBytes <= 0 || current?.state === "relay_stopped";
    const viewOnly = relayStopped ? "resource" : current?.input_revoked ? "permission" : null;
    let directive: Directive = "continue";
    let notice: string | null = null;
    if (relayStopped) {
      directive = "stop_relay";
      notice = "中继已停，会话还在。画面已停在最后一帧";
    } else if (usedRatio >= 0.95) {
      directive = "suggest_direct";
      notice = "免费中继时长将尽，可以重新尝试直连";
    } else if (showBalance) {
      directive = "warn";
      notice = "免费中继时长已用到约八成";
    }
    const heartbeat = await this.pool.query<{ directive: string; response: { notice?: string } }>(
      `SELECT h.directive, h.response
         FROM relay_heartbeats h
         JOIN remote_sessions s ON s.remote_session_id = h.remote_session_id
        WHERE s.account_id = $1
        ORDER BY h.created_at DESC
        LIMIT 1`,
      [session.accountId],
    );
    const lastNotice = heartbeat.rows[0];
    if (!relayStopped && lastNotice?.directive === "degraded" && typeof lastNotice.response?.notice === "string") {
      directive = "degraded";
      notice = lastNotice.response.notice;
    }
    const charge = await this.pool.query<{ pending: boolean }>(
      `SELECT (charge_failed_at IS NOT NULL
               AND (entitlement_ends_at IS NULL OR entitlement_ends_at > $2)) AS pending
         FROM subscriptions
        WHERE account_id = $1`,
      [session.accountId, now],
    );
    const realName = await this.realNamePrompt(
      this.pool,
      session.accountId,
      current?.controller_fingerprint ?? null,
      now,
      current?.host_device_id ?? null,
    );
    return {
      ok: true,
      remainingBytes,
      totalBytes,
      freeRelayBytes: this.config.freeRelayBytes,
      freeBitrateKbps: this.config.freeBitrateKbps,
      freeMaxFps: this.config.freeMaxFps,
      showBalance,
      displayMinutes,
      footnote: showBalance && displayMinutes !== null ? "按当前画质估算 · 切换画质会变" : null,
      directive,
      notice,
      viewOnly,
      ways: relayStopped
        ? [
            { id: "direct", title: "直连", paid: false },
            { id: "lan", title: "局域网直连", paid: false },
            { id: "reverse", title: "让对方来连你", paid: false },
            { id: "purchase", title: "购买中继时长", paid: true },
          ]
        : [],
      subscriptionBadge: charge.rows[0]?.pending ? "订阅待处理" : null,
      realName,
    };
  }

  async inspect(signalSecret: string | null, ticket: string): Promise<Record<string, unknown> | Failure> {
    const allowed = this.sharedSecretAllowed(signalSecret, this.config.signalSharedSecret, "signal_unconfigured", "信令校验尚未配置");
    if (allowed) return allowed;
    const secret = ticket.trim();
    if (secret.length < 20) return fail(401, "ticket_invalid", "票据无效");
    const loaded = await this.loadTicket(this.pool, secret);
    const now = this.now();
    if (!loaded || loaded.revokedAt || loaded.expiresAt <= now || loaded.state === "closed") {
      return fail(401, "ticket_invalid", "票据无效");
    }
    return {
      ok: true,
      remoteSessionId: loaded.remoteSessionId,
      controllerFingerprint: loaded.controllerFingerprint,
      hostFingerprint: loaded.hostFingerprint,
      bitrateKbps: loaded.bitrateKbps,
      expiresAt: loaded.expiresAt.toISOString(),
    };
  }

  async admit(
    relaySecret: string | null,
    input: { ticket: string; controllerFingerprint: string; hostFingerprint: string },
  ): Promise<Record<string, unknown> | Failure> {
    const allowed = this.sharedSecretAllowed(relaySecret, this.config.relaySharedSecret, "relay_unconfigured", "中继校验尚未配置");
    if (allowed) return allowed;
    const secret = input.ticket.trim();
    if (secret.length < 20) return fail(401, "ticket_invalid", "票据无效");
    return this.withTransaction(async (client) => {
      const ticket = await this.loadTicket(client, secret);
      if (!ticket) return fail(401, "ticket_invalid", "票据无效");
      const now = this.now();
      if (ticket.revokedAt || ticket.expiresAt <= now) return fail(401, "ticket_invalid", "票据无效");
      if (ticket.admittedAt) return fail(409, "ticket_replay", "票据不能重复接入");
      if (ticket.controllerFingerprint !== input.controllerFingerprint.trim() || ticket.hostFingerprint !== input.hostFingerprint.trim()) {
        return fail(401, "ticket_invalid", "票据无效");
      }
      if (ticket.state !== "active") return fail(409, "relay_stopped", "中继已停，会话还在");
      await client.query("UPDATE relay_tickets SET admitted_at = $2 WHERE relay_ticket_id = $1", [ticket.relayTicketId, now]);
      const remainingBytes = await this.remainingBytes(client, ticket.accountId, now);
      return {
        ok: true as const,
        remoteSessionId: ticket.remoteSessionId,
        bitrateKbps: ticket.bitrateKbps,
        maxFps: this.config.freeMaxFps,
        remainingBytes,
        expiresAt: ticket.expiresAt.toISOString(),
      };
    });
  }

  async heartbeat(
    relaySecret: string | null,
    input: { ticket: string; heartbeatId: string; bytes: number; durationSeconds: number; acceptDegrade: boolean },
  ): Promise<Record<string, unknown> | Failure> {
    const allowed = this.sharedSecretAllowed(relaySecret, this.config.relaySharedSecret, "relay_unconfigured", "中继校验尚未配置");
    if (allowed) return allowed;
    if (!isUuid(input.heartbeatId)) return fail(400, "heartbeat_invalid", "心跳编号不正确");
    if (!Number.isInteger(input.bytes) || input.bytes < 0 || input.bytes > HEARTBEAT_MAX_BYTES) {
      return fail(400, "bytes_invalid", "字节数不正确");
    }
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 0 || input.durationSeconds > 120) {
      return fail(400, "duration_invalid", "时长不正确");
    }
    const secret = input.ticket.trim();
    if (secret.length < 20) return fail(401, "ticket_invalid", "票据无效");

    return this.withTransaction(async (client) => {
      const existing = await client.query<{ response: Record<string, unknown> }>(
        "SELECT response FROM relay_heartbeats WHERE heartbeat_id = $1",
        [input.heartbeatId],
      );
      if (existing.rows[0]) return { ok: true as const, ...existing.rows[0].response };

      const located = await client.query<{ remote_session_id: string }>(
        `SELECT s.remote_session_id
           FROM relay_tickets t
           JOIN remote_sessions s ON s.remote_session_id = t.remote_session_id
          WHERE t.secret_hash = $1
          FOR UPDATE OF s`,
        [hashSecret(secret)],
      );
      if (!located.rows[0]) return fail(401, "ticket_invalid", "票据无效");
      const replay = await client.query<{ response: Record<string, unknown> }>(
        "SELECT response FROM relay_heartbeats WHERE heartbeat_id = $1",
        [input.heartbeatId],
      );
      if (replay.rows[0]) return { ok: true as const, ...replay.rows[0].response };
      const ticket = await this.loadTicket(client, secret);
      if (!ticket) return fail(401, "ticket_invalid", "票据无效");
      const now = this.now();
      if (ticket.revokedAt || ticket.expiresAt <= now || !ticket.admittedAt || ticket.state !== "active") {
        await client.query("UPDATE remote_sessions SET state = 'relay_stopped' WHERE remote_session_id = $1 AND state = 'active'", [
          ticket.remoteSessionId,
        ]);
        return fail(409, "relay_stopped", "中继已停，会话还在");
      }

      if (input.bytes > 0) await this.deduct(client, ticket.accountId, ticket.remoteSessionId, input.bytes, now);
      const remainingBytes = await this.remainingBytes(client, ticket.accountId, now);
      const totalBytes = await this.grantTotal(client, ticket.accountId, now);
      const usedRatio = totalBytes <= 0 ? 1 : (totalBytes - remainingBytes) / totalBytes;
      const prompt = remainingBytes > 0
        ? await this.realNamePrompt(client, ticket.accountId, ticket.controllerFingerprint, now, ticket.hostDeviceId)
        : null;
      let bitrateKbps = ticket.bitrateKbps;
      let directive: Directive = "continue";
      let notice: string | null = null;

      if (remainingBytes <= 0) {
        directive = "stop_relay";
        notice = "中继已停，会话还在。可以改走直连";
      } else if (prompt) {
        directive = "stop_relay";
        notice = prompt.message;
      } else if (input.acceptDegrade && bitrateKbps > this.config.freeBitrateKbps && usedRatio >= 0.8) {
        bitrateKbps = this.config.freeBitrateKbps;
        directive = "degraded";
        notice = `画质已降低到 ${formatRate(bitrateKbps)}`;
        await client.query("UPDATE remote_sessions SET bitrate_kbps = $2 WHERE remote_session_id = $1", [
          ticket.remoteSessionId,
          bitrateKbps,
        ]);
      } else if (usedRatio >= 0.95) {
        directive = "suggest_direct";
        notice = "免费中继时长将尽，可以重新尝试直连";
      } else if (usedRatio >= 0.8) {
        directive = "warn";
        notice = "免费中继时长已用到约八成";
      }

      let nextTicket: string | null = null;
      let expiresAt = ticket.expiresAt;
      if (directive === "stop_relay" && prompt) {
        await client.query("UPDATE relay_tickets SET revoked_at = $2 WHERE relay_ticket_id = $1", [ticket.relayTicketId, now]);
      } else if (directive === "stop_relay") {
        await client.query("UPDATE relay_tickets SET revoked_at = $2 WHERE relay_ticket_id = $1", [ticket.relayTicketId, now]);
        await client.query("UPDATE remote_sessions SET state = 'relay_stopped' WHERE remote_session_id = $1", [ticket.remoteSessionId]);
      } else {
        const renewed = await this.rotateTicket(client, ticket, now);
        nextTicket = renewed.ticket;
        expiresAt = renewed.expiresAt;
      }

      const response = {
        directive,
        notice,
        remainingBytes,
        bitrateKbps,
        maxFps: this.config.freeMaxFps,
        ticket: nextTicket,
        expiresAt: expiresAt.toISOString(),
        sessionKept: true,
      };
      await client.query(
        `INSERT INTO relay_heartbeats
          (heartbeat_id, remote_session_id, bytes_reported, duration_seconds, directive, response, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [input.heartbeatId, ticket.remoteSessionId, input.bytes, input.durationSeconds, directive, JSON.stringify(response), now],
      );
      return { ok: true as const, ...response };
    });
  }

  private async openRelay(
    client: PoolClient,
    session: SessionContext,
    remoteSessionId: string,
    controllerFingerprint: string,
    now: Date,
    crossAccount: boolean,
  ): Promise<Record<string, unknown>> {
    await this.ensureFreeGrant(client, session.accountId, controllerFingerprint, now);
    const remainingBytes = await this.remainingBytes(client, session.accountId, now);
    const relayAllowed = remainingBytes > 0;
    const located = await client.query<{ host_device_id: string }>(
      "SELECT host_device_id FROM remote_sessions WHERE remote_session_id = $1",
      [remoteSessionId],
    );
    const prompt = relayAllowed
      ? await this.realNamePrompt(
          client,
          session.accountId,
          controllerFingerprint,
          now,
          located.rows[0]?.host_device_id ?? null,
        )
      : null;
    const relayOpen = relayAllowed && !prompt;
    let ticket: string | null = null;
    let ticketExpiresAt: string | null = null;
    if (relayOpen) {
      const issued = await this.insertTicket(client, remoteSessionId, now);
      ticket = issued.ticket;
      ticketExpiresAt = issued.expiresAt.toISOString();
    }
    return {
      ok: true,
      remoteSessionId,
      state: "active",
      crossAccount,
      relayAllowed: relayOpen,
      ticket,
      ticketExpiresAt,
      bitrateKbps: this.config.freeBitrateKbps,
      maxFps: this.config.freeMaxFps,
      remainingBytes,
      notice: prompt?.message ?? (relayOpen ? null : "免费中继时长已用完，可以改走直连"),
      realName: prompt,
    };
  }

  private async ensureFreeGrant(client: PoolClient, accountId: string, controllerFingerprint: string, now: Date): Promise<void> {
    const window = shanghaiMonth(now);
    const existing = await client.query(
      "SELECT relay_grant_id FROM relay_grants WHERE account_id = $1 AND kind = 'free' AND period_start = $2",
      [accountId, window.start],
    );
    if (existing.rowCount) return;
    const account = await client.query<{ created_at: Date }>("SELECT created_at FROM accounts WHERE account_id = $1", [accountId]);
    const createdAt = account.rows[0]?.created_at ?? now;
    if (now.getTime() - createdAt.getTime() < NEW_ACCOUNT_FREEZE_MS) {
      const reused = await client.query(
        `SELECT remote_session_id FROM remote_sessions
          WHERE controller_fingerprint = $1 AND account_id <> $2 AND created_at > $3
          LIMIT 1`,
        [controllerFingerprint, accountId, new Date(now.getTime() - NEW_ACCOUNT_FREEZE_MS)],
      );
      if (reused.rowCount) return;
    }
    await client.query(
      `INSERT INTO relay_grants
        (relay_grant_id, account_id, kind, bytes_total, expires_at, period_start, created_at)
       VALUES ($1, $2, 'free', $3, $4, $5, $6)`,
      [randomUUID(), accountId, this.config.freeRelayBytes, window.end, window.start, now],
    );
  }

  private async remainingBytes(runner: Pool | PoolClient, accountId: string, now: Date): Promise<number> {
    const found = await runner.query<{ remaining: number }>(
      `SELECT COALESCE(SUM(remaining), 0)::float8 AS remaining
         FROM (
           SELECT g.bytes_total - COALESCE(SUM(l.bytes), 0) AS remaining
             FROM relay_grants g
             LEFT JOIN relay_ledger l ON l.relay_grant_id = g.relay_grant_id
            WHERE g.account_id = $1 AND g.expires_at > $2
            GROUP BY g.relay_grant_id
         ) AS grant_remaining
        WHERE remaining > 0`,
      [accountId, now],
    );
    return found.rows[0]?.remaining ?? 0;
  }

  private async grantTotal(runner: Pool | PoolClient, accountId: string, now: Date): Promise<number> {
    const found = await runner.query<{ total: number }>(
      `SELECT COALESCE(SUM(bytes_total), 0)::float8 AS total
         FROM relay_grants
        WHERE account_id = $1 AND expires_at > $2`,
      [accountId, now],
    );
    return found.rows[0]?.total ?? 0;
  }

  private async deduct(client: PoolClient, accountId: string, remoteSessionId: string, bytes: number, now: Date): Promise<void> {
    const grants = await client.query<{ relay_grant_id: string; remaining: number }>(
      `SELECT g.relay_grant_id,
              (g.bytes_total - COALESCE((SELECT SUM(bytes) FROM relay_ledger l WHERE l.relay_grant_id = g.relay_grant_id), 0))::float8 AS remaining
         FROM relay_grants g
        WHERE g.account_id = $1 AND g.expires_at > $2
        ORDER BY g.expires_at ASC,
                 CASE g.kind WHEN 'promo' THEN 0 WHEN 'plugin' THEN 1 WHEN 'subscription' THEN 2 ELSE 3 END
        FOR UPDATE OF g`,
      [accountId, now],
    );
    let leftover = bytes;
    for (const grant of grants.rows) {
      if (leftover <= 0) break;
      const take = Math.min(grant.remaining, leftover);
      if (take <= 0) continue;
      await client.query(
        `INSERT INTO relay_ledger (relay_ledger_id, account_id, relay_grant_id, remote_session_id, bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), accountId, grant.relay_grant_id, remoteSessionId, take, now],
      );
      leftover -= take;
    }
  }

  private async insertTicket(client: PoolClient, remoteSessionId: string, now: Date): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = createToken();
    const expiresAt = new Date(now.getTime() + this.config.ticketTtlSeconds * 1000);
    await client.query(
      `INSERT INTO relay_tickets (relay_ticket_id, remote_session_id, secret_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), remoteSessionId, hashSecret(ticket), expiresAt, now],
    );
    return { ticket, expiresAt };
  }

  private async rotateTicket(
    client: PoolClient,
    ticket: LoadedTicket,
    now: Date,
  ): Promise<{ ticket: string; expiresAt: Date }> {
    await client.query("UPDATE relay_tickets SET revoked_at = $2 WHERE relay_ticket_id = $1", [ticket.relayTicketId, now]);
    const renewed = await this.insertTicket(client, ticket.remoteSessionId, now);
    await client.query("UPDATE relay_tickets SET admitted_at = $2 WHERE secret_hash = $1", [hashSecret(renewed.ticket), now]);
    return renewed;
  }

  private async loadTicket(runner: Pool | PoolClient, secret: string): Promise<LoadedTicket | null> {
    const found = await runner.query<{
      relay_ticket_id: string;
      remote_session_id: string;
      expires_at: Date;
      admitted_at: Date | null;
      revoked_at: Date | null;
      account_id: string;
      controller_fingerprint: string;
      host_fingerprint: string;
      host_device_id: string;
      state: string;
      bitrate_kbps: number;
    }>(
      `SELECT t.relay_ticket_id, t.remote_session_id, t.expires_at, t.admitted_at, t.revoked_at,
              s.account_id, s.controller_fingerprint, s.host_fingerprint, s.host_device_id, s.state, s.bitrate_kbps
         FROM relay_tickets t
         JOIN remote_sessions s ON s.remote_session_id = t.remote_session_id
        WHERE t.secret_hash = $1`,
      [hashSecret(secret)],
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      relayTicketId: row.relay_ticket_id,
      remoteSessionId: row.remote_session_id,
      expiresAt: row.expires_at,
      admittedAt: row.admitted_at,
      revokedAt: row.revoked_at,
      accountId: row.account_id,
      controllerFingerprint: row.controller_fingerprint,
      hostFingerprint: row.host_fingerprint,
      hostDeviceId: row.host_device_id,
      state: row.state,
      bitrateKbps: row.bitrate_kbps,
    };
  }

  private async loadHost(client: PoolClient, hostDeviceId: string): Promise<{ hostDeviceId: string; accountId: string; fingerprint: string; authorizationState: string; acceptingConnections: boolean } | null> {
    const found = await client.query<{
      host_device_id: string;
      account_id: string;
      hardware_fingerprint: string;
      authorization_state: string;
      accepting_connections: boolean;
    }>(
      `SELECT host_device_id, account_id, hardware_fingerprint, authorization_state, accepting_connections
         FROM host_devices
        WHERE host_device_id = $1 AND removed_at IS NULL`,
      [hostDeviceId],
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      hostDeviceId: row.host_device_id,
      accountId: row.account_id,
      fingerprint: row.hardware_fingerprint,
      authorizationState: row.authorization_state,
      acceptingConnections: row.accepting_connections,
    };
  }

  private async concurrencyFailure(client: PoolClient, accountId: string, hostDeviceId: string): Promise<Failure | null> {
    if (this.config.channelLimit !== null) {
      const found = await client.query<{ channels: number }>(
        `SELECT COUNT(DISTINCT host_device_id)::int AS channels
           FROM remote_sessions
          WHERE account_id = $1
            AND host_device_id <> $2
            AND state IN ('awaiting_host_consent', 'active')`,
        [accountId, hostDeviceId],
      );
      if ((found.rows[0]?.channels ?? 0) >= this.config.channelLimit) {
        return fail(409, "channel_limit", "同时发起的通道已达上限");
      }
    }
    if (this.config.sessionsPerChannel !== null) {
      const found = await client.query<{ sessions: number }>(
        `SELECT COUNT(*)::int AS sessions
           FROM remote_sessions
          WHERE account_id = $1 AND host_device_id = $2 AND state IN ('awaiting_host_consent', 'active')`,
        [accountId, hostDeviceId],
      );
      if ((found.rows[0]?.sessions ?? 0) >= this.config.sessionsPerChannel) {
        return fail(409, "session_limit", "这条通道上的会话已达上限");
      }
    }
    return null;
  }

  /** 跨账号不构成这里的原因。两条都不中就返回空，调用方不得自己补提示。 */
  private async realNamePrompt(
    runner: Pool | PoolClient,
    accountId: string,
    controllerFingerprint: string | null,
    now: Date,
    hostDeviceId: string | null,
  ): Promise<RealNamePrompt | null> {
    const verified = await runner.query<{ real_name_verified_at: Date | null }>(
      "SELECT real_name_verified_at FROM accounts WHERE account_id = $1",
      [accountId],
    );
    if (verified.rows[0]?.real_name_verified_at) return null;
    if (hostDeviceId && (await this.isTrustedPair(runner, accountId, hostDeviceId))) return null;
    const fingerprint = controllerFingerprint?.trim() ?? "";
    let frequent = false;
    if (fingerprint.length >= 8) {
      const hosts = await runner.query<{ host_count: number }>(
        `SELECT COUNT(DISTINCT host_device_id)::int AS host_count
           FROM remote_sessions
          WHERE account_id = $1 AND controller_fingerprint = $2 AND created_at > $3`,
        [accountId, fingerprint, new Date(now.getTime() - REAL_NAME_WINDOW_MS)],
      );
      frequent = (hosts.rows[0]?.host_count ?? 0) >= REAL_NAME_DISTINCT_HOSTS;
    }
    const totalBytes = await this.grantTotal(runner, accountId, now);
    const remainingBytes = await this.remainingBytes(runner, accountId, now);
    const halfUsed = totalBytes > 0 && (totalBytes - remainingBytes) * REAL_NAME_USED_SHARE >= totalBytes;
    if (!frequent && !halfUsed) return null;
    const reason = frequent ? "controller_frequency" : "relay_threshold";
    const message = frequent
      ? "这台控制端 7 天内连接了多台不同的电脑。中继要实名后才能继续。直连、登录和设备管理仍然可用。"
      : "免费中继时长已用到一半。中继要实名后才能继续。直连、登录和设备管理仍然可用。";
    return {
      required: true,
      reason,
      message,
      postpone: true,
      stillWorks: [
        { code: "login", title: "登录" },
        { code: "devices", title: "设备管理" },
        { code: "direct", title: "直连" },
      ],
    };
  }

  private async ownedHost(token: string | null, hostDeviceId: string): Promise<{ accountId: string } | Failure> {
    if (!isUuid(hostDeviceId)) return fail(400, "host_device_invalid", "被控设备不正确");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const found = await this.pool.query(
      `SELECT 1 FROM host_devices
        WHERE host_device_id = $1 AND account_id = $2 AND removed_at IS NULL`,
      [hostDeviceId, session.accountId],
    );
    if (!found.rowCount) return fail(404, "device_missing", "设备不存在");
    return { accountId: session.accountId };
  }

  private async isTrustedPair(runner: Pool | PoolClient, controllerAccountId: string, hostDeviceId: string): Promise<boolean> {
    const found = await runner.query(
      `SELECT 1
         FROM host_trusted_controllers trusted
         JOIN controller_family_devices family
           ON family.host_device_id = trusted.host_device_id
          AND family.controller_account_id = trusted.controller_account_id
        WHERE trusted.host_device_id = $1
          AND trusted.controller_account_id = $2`,
      [hostDeviceId, controllerAccountId],
    );
    return Boolean(found.rowCount);
  }

  private sharedSecretAllowed(presented: string | null, expected: string | null, missingCode: string, missingMessage: string): Failure | null {
    if (!expected) return fail(503, missingCode, missingMessage);
    if (!presented || presented.length !== expected.length) return fail(401, "relay_unauthorized", "调用方未授权");
    const actual = Buffer.from(presented);
    const wanted = Buffer.from(expected);
    if (!timingSafeEqual(actual, wanted)) return fail(401, "relay_unauthorized", "调用方未授权");
    return null;
  }

  private async audit(client: PoolClient, accountId: string, action: string, detail: Record<string, unknown>): Promise<void> {
    await client.query(
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

type LoadedTicket = {
  relayTicketId: string;
  remoteSessionId: string;
  expiresAt: Date;
  admittedAt: Date | null;
  revokedAt: Date | null;
  accountId: string;
  controllerFingerprint: string;
  hostFingerprint: string;
  hostDeviceId: string;
  state: string;
  bitrateKbps: number;
};

type RealNamePrompt = {
  required: true;
  reason: "controller_frequency" | "relay_threshold";
  message: string;
  postpone: true;
  stillWorks: Array<{ code: string; title: string }>;
};

function fraudNotice(): string[] {
  return [
    "你正在允许对方控制本设备",
    "对方能看到并操作你屏幕上的一切",
    "不要向陌生人开启；任何自称「客服 / 公检法」要求你打开屏幕的，都是诈骗",
  ];
}

function connectionDisclosure(): Record<string, string> {
  return {
    title: "连接前，有两件事需要你知道",
    relay: "走中继时，画面数据会经过我们的服务器转发。转发全程加密传输，但我们可以在转发环节看到流量大小，因此中继连接不属于端到端加密。",
    direct: "走直连时，我们只记录会话起止时间，不记录流量大小，不采集画面，也不据此计费。",
  };
}

function shanghaiMonth(now: Date): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - SHANGHAI_OFFSET_MS),
  };
}

function formatRate(kbps: number): string {
  if (kbps % 1000 === 0) return `${kbps / 1000} Mbps`;
  return `${kbps} kbps`;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isAuthFailure(value: SessionContext | Failure): value is Failure {
  return "code" in value;
}

function isFailure(value: unknown): value is Failure {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok: boolean }).ok === false);
}
