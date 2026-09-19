import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AccountService, type Failure, type SessionContext } from "./account-service.js";
import type { AppConfig } from "./config.js";

function fail(status: number, code: string, message: string): Failure {
  return { ok: false, status, code, message };
}

function isAuthFailure(value: SessionContext | Failure): value is Failure {
  return "code" in value;
}

const STATE_LABEL: Record<string, string> = {
  unfinished: "未完成",
  confirming: "确认中",
  opened: "已开通",
  closed: "订单已关闭",
};

/** 合规要求扣费前 5 日提醒。这不是价格，不从客户端传入。 */
const RENEWAL_REMINDER_LEAD_DAYS = 5;
/** 扣款全部失败之后再给的宽限。账号设计已定 7 天，不从客户端传入。 */
const CHARGE_GRACE_DAYS = 7;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

type InvoiceSnapshot = {
  wantsInvoice: boolean;
  titleKind: string | null;
  title: string | null;
  taxNumber: string | null;
};

export type ChargeFailureInput = {
  channel: string | null;
  retriesRemaining: number | null;
  nextRetryAt: string | null;
};

export type InvoiceInput = {
  wantsInvoice: boolean | null;
  titleKind: string | null;
  title: string | null;
  taxNumber: string | null;
};

type OrderRow = {
  order_id: string;
  account_id: string;
  plan: string;
  amount_cents: number;
  price_version: string;
  state: string;
  created_at: Date;
  wants_invoice: boolean;
  invoice_title_kind: string | null;
  invoice_title: string | null;
  invoice_tax_number: string | null;
};

/** 订单只固化下单当时的价格。发票在付款前写入。确认中不是失败，也不自动重试扣款。 */
export class OrderService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly accounts: AccountService,
    private readonly now: () => Date,
  ) {}

  catalog(): Record<string, unknown> {
    return {
      ok: true,
      priceVersion: this.config.priceVersion,
      yearly: {
        amountCents: this.config.yearlyPriceCents,
        period: "year",
        perMonthLabel: this.config.yearlyPerMonthLabel,
      },
      monthly: {
        amountCents: this.config.monthlyPriceCents,
        period: "month",
        autoRenew: true,
      },
    };
  }

  async getInvoice(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const profile = (await this.loadProfile(session.accountId)) ?? emptyInvoice();
    return { ok: true, ...profile };
  }

  async saveInvoice(token: string | null, input: InvoiceInput): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    if (input.wantsInvoice === null) return fail(400, "invoice_choice_required", "需要明确是否开票");
    const snapshot = this.parseInvoice(input);
    if ("code" in snapshot) return snapshot;
    await this.writeProfile(session.accountId, snapshot);
    const stored = (await this.loadProfile(session.accountId)) ?? snapshot;
    return { ok: true, ...stored };
  }

  async create(token: string | null, planRaw: string, input: InvoiceInput): Promise<Record<string, unknown> | Failure> {
    const plan = planRaw.trim();
    if (plan !== "yearly" && plan !== "monthly") return fail(400, "plan_invalid", "套餐只能是年付或月付");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const snapshot = await this.snapshotForOrder(session.accountId, input);
    if ("code" in snapshot) return snapshot;
    if (input.wantsInvoice !== null) await this.writeProfile(session.accountId, snapshot);
    const amountCents = plan === "yearly" ? this.config.yearlyPriceCents : this.config.monthlyPriceCents;
    const orderId = randomUUID();
    const createdAt = this.now();
    await this.pool.query(
      `INSERT INTO orders
        (order_id, account_id, plan, amount_cents, price_version, state, created_at,
         wants_invoice, invoice_title_kind, invoice_title, invoice_tax_number)
       VALUES ($1, $2, $3, $4, $5, 'unfinished', $6, $7, $8, $9, $10)`,
      [
        orderId,
        session.accountId,
        plan,
        amountCents,
        this.config.priceVersion,
        createdAt,
        snapshot.wantsInvoice,
        snapshot.titleKind,
        snapshot.title,
        snapshot.taxNumber,
      ],
    );
    return this.present(orderId, plan, amountCents, this.config.priceVersion, "unfinished", createdAt, snapshot);
  }

  async applyProviderResult(secret: string | null, orderId: string, providerStateRaw: string): Promise<Record<string, unknown> | Failure> {
    if (!this.config.orderCallbackSecret) return fail(503, "order_callback_unconfigured", "支付回调尚未配置");
    if (secret !== this.config.orderCallbackSecret) return fail(401, "order_callback_invalid", "支付回调校验失败");
    const providerState = providerStateRaw.trim();
    if (providerState !== "confirming" && providerState !== "opened" && providerState !== "closed") {
      return fail(400, "order_state_invalid", "支付结果不正确");
    }
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return fail(400, "order_invalid", "订单不正确");
    const found = await this.pool.query<OrderRow>(
      `SELECT order_id, account_id, plan, amount_cents, price_version, state, created_at,
              wants_invoice, invoice_title_kind, invoice_title, invoice_tax_number
         FROM orders WHERE order_id = $1`,
      [orderId],
    );
    const row = found.rows[0];
    if (!row) return fail(404, "order_missing", "订单不存在");
    const snapshot = snapshotFromRow(row);
    if (row.state === providerState) {
      return this.present(row.order_id, row.plan, row.amount_cents, row.price_version, row.state, row.created_at, snapshot);
    }
    const allowed = row.state === "unfinished" || (row.state === "confirming" && (providerState === "opened" || providerState === "closed"));
    if (!allowed) return fail(409, "order_not_retryable", "确认中不是支付失败，不能再付一次");
    const changedAt = this.now();
    await this.pool.query("UPDATE orders SET state = $2 WHERE order_id = $1", [orderId, providerState]);
    if (providerState === "opened" && row.plan === "monthly") {
      await this.openMonthlySubscription(row, changedAt);
    }
    return this.present(row.order_id, row.plan, row.amount_cents, row.price_version, providerState, row.created_at, snapshot);
  }

  async list(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<OrderRow>(
      `SELECT order_id, account_id, plan, amount_cents, price_version, state, created_at,
              wants_invoice, invoice_title_kind, invoice_title, invoice_tax_number
         FROM orders
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [session.accountId],
    );
    return {
      ok: true,
      orders: rows.rows.map((row) => this.present(
        row.order_id,
        row.plan,
        row.amount_cents,
        row.price_version,
        row.state,
        row.created_at,
        snapshotFromRow(row),
      )),
    };
  }

  async getSubscription(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    return this.readSubscription(session.accountId);
  }

  async setAutoRenew(token: string | null, enabled: boolean): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const updated = await this.pool.query(
      `UPDATE subscriptions
          SET auto_renew = $2,
              next_retry_at = CASE WHEN $2 THEN next_retry_at ELSE NULL END,
              retries_remaining = CASE WHEN $2 THEN retries_remaining ELSE 0 END,
              updated_at = $3
        WHERE account_id = $1`,
      [session.accountId, enabled, this.now()],
    );
    if (!updated.rowCount) return fail(404, "subscription_missing", "还没有自动续费");
    return this.readSubscription(session.accountId);
  }

  /**
   * 渠道告知扣款没成功。这里只记账和下发计划，不发起下一笔扣款。
   * 重试次数和下一次时间以渠道回调为准；全部失败后才开始 7 天宽限。
   */
  async recordChargeFailure(
    secret: string | null,
    subscriptionId: string,
    input: ChargeFailureInput,
  ): Promise<Record<string, unknown> | Failure> {
    if (!this.config.orderCallbackSecret) return fail(503, "order_callback_unconfigured", "支付回调尚未配置");
    if (secret !== this.config.orderCallbackSecret) return fail(401, "order_callback_invalid", "支付回调校验失败");
    if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return fail(400, "subscription_invalid", "订阅不正确");
    const channel = input.channel?.trim() ?? "";
    if (channel !== "wechat" && channel !== "alipay") {
      return fail(400, "charge_channel_invalid", "扣款渠道只能是微信或支付宝");
    }
    if (input.retriesRemaining !== null && input.retriesRemaining < 0) {
      return fail(400, "charge_retry_invalid", "重试次数不正确");
    }
    const found = await this.pool.query<{
      account_id: string;
      auto_renew: boolean;
      charge_failed_at: Date | null;
      entitlement_ends_at: Date | null;
    }>(
      `SELECT account_id, auto_renew, charge_failed_at, entitlement_ends_at
         FROM subscriptions WHERE subscription_id = $1`,
      [subscriptionId],
    );
    const row = found.rows[0];
    if (!row) return fail(404, "subscription_missing", "还没有自动续费");
    if (!row.auto_renew) return fail(409, "charge_not_renewing", "已关闭自动续费，不会再扣");
    if (row.entitlement_ends_at) return this.readSubscription(row.account_id);

    const now = this.now();
    const retriesLeft = input.retriesRemaining ?? 0;
    let nextRetryAt: Date | null = null;
    let entitlementEndsAt: Date | null = null;
    if (retriesLeft > 0) {
      const parsed = parseFutureInstant(input.nextRetryAt, now);
      if ("code" in parsed) return parsed;
      nextRetryAt = parsed;
    } else {
      entitlementEndsAt = addDays(now, CHARGE_GRACE_DAYS);
    }
    const failedAt = row.charge_failed_at ?? now;
    await this.pool.query(
      `UPDATE subscriptions
          SET charge_failed_at = COALESCE(charge_failed_at, $2),
              charge_channel = $3,
              next_retry_at = $4,
              retries_remaining = $5,
              entitlement_ends_at = $6,
              updated_at = $7
        WHERE subscription_id = $1`,
      [subscriptionId, failedAt, channel, nextRetryAt, retriesLeft, entitlementEndsAt, now],
    );
    const body = chargeFailureBody(nextRetryAt, entitlementEndsAt);
    const existing = await this.pool.query(
      `SELECT 1 FROM account_notices
        WHERE account_id = $1 AND kind = 'renewal_charge_failed' AND body = $2
        LIMIT 1`,
      [row.account_id, body],
    );
    if (!existing.rowCount) {
      await this.pool.query(
        `INSERT INTO account_notices (account_notice_id, account_id, kind, body, created_at)
         VALUES ($1, $2, 'renewal_charge_failed', $3, $4)`,
        [randomUUID(), row.account_id, body, now],
      );
    }
    return this.readSubscription(row.account_id);
  }

  /** 扣费前 5 日：应用内一条，外加微信和支付宝各一条。邮件只在已验证时排队。不在这里扣款。 */
  async remindDueRenewals(): Promise<void> {
    const now = this.now();
    const due = await this.pool.query<{
      subscription_id: string;
      account_id: string;
      amount_cents: number;
      next_charge_at: Date;
      email: string | null;
      email_verified_at: Date | null;
    }>(
      `SELECT s.subscription_id, s.account_id, s.amount_cents, s.next_charge_at, a.email, a.email_verified_at
         FROM subscriptions s
         JOIN accounts a ON a.account_id = s.account_id
        WHERE s.auto_renew = true
          AND s.charge_failed_at IS NULL
          AND s.next_charge_at IS NOT NULL
          AND s.next_charge_at > $1
          AND s.next_charge_at <= $1::timestamptz + ($2 || ' days')::interval
          AND (s.reminder_for_charge_at IS NULL OR s.reminder_for_charge_at <> s.next_charge_at)`,
      [now, String(RENEWAL_REMINDER_LEAD_DAYS)],
    );
    for (const row of due.rows) {
      const body = renewalBody(row.amount_cents, row.next_charge_at, now);
      const channels = ["app", "wechat", "alipay"];
      if (row.email && row.email_verified_at) channels.push("email");
      let recordedApp = false;
      for (const channel of channels) {
        const inserted = await this.pool.query(
          `INSERT INTO renewal_reminders
            (renewal_reminder_id, account_id, subscription_id, charge_at, channel, body, status, created_at)
           SELECT $1, account_id, subscription_id, next_charge_at, $2, $3, $4, $5
             FROM subscriptions
            WHERE subscription_id = $6
           ON CONFLICT (subscription_id, charge_at, channel) DO NOTHING`,
          [
            randomUUID(),
            channel,
            body,
            channel === "app" ? "recorded" : "queued",
            now,
            row.subscription_id,
          ],
        );
        if (channel === "app" && inserted.rowCount) recordedApp = true;
      }
      if (recordedApp) {
        await this.pool.query(
          `INSERT INTO account_notices (account_notice_id, account_id, kind, body, created_at)
           VALUES ($1, $2, 'renewal_due', $3, $4)`,
          [randomUUID(), row.account_id, body, now],
        );
      }
      await this.pool.query(
        `UPDATE subscriptions
            SET reminder_for_charge_at = next_charge_at, updated_at = $2
          WHERE subscription_id = $1`,
        [row.subscription_id, now],
      );
    }
  }

  private async snapshotForOrder(accountId: string, input: InvoiceInput): Promise<InvoiceSnapshot | Failure> {
    if (input.wantsInvoice === null) {
      return (await this.loadProfile(accountId)) ?? emptyInvoice();
    }
    return this.parseInvoice(input);
  }

  private parseInvoice(input: InvoiceInput): InvoiceSnapshot | Failure {
    if (!input.wantsInvoice) return emptyInvoice();
    const titleKind = input.titleKind?.trim() ?? "";
    if (titleKind !== "personal" && titleKind !== "enterprise") {
      return fail(400, "invoice_kind_invalid", "抬头类型只能是个人或企业");
    }
    const title = input.title?.trim() ?? "";
    if (title.length < 2 || title.length > 80) return fail(400, "invoice_title_invalid", "发票抬头不正确");
    const taxNumber = normalizeTax(input.taxNumber);
    if (titleKind === "enterprise" && !/^[0-9A-Z]{15}$|^[0-9A-Z]{18}$/.test(taxNumber ?? "")) {
      return fail(400, "invoice_tax_invalid", "企业税号不正确");
    }
    return {
      wantsInvoice: true,
      titleKind,
      title,
      taxNumber: titleKind === "enterprise" ? taxNumber : null,
    };
  }

  private async loadProfile(accountId: string): Promise<InvoiceSnapshot | null> {
    const found = await this.pool.query<{
      wants_invoice: boolean;
      title_kind: string | null;
      title: string | null;
      tax_number: string | null;
    }>(
      `SELECT wants_invoice, title_kind, title, tax_number
         FROM invoice_profiles WHERE account_id = $1`,
      [accountId],
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      wantsInvoice: row.wants_invoice,
      titleKind: row.title_kind,
      title: row.title,
      taxNumber: row.tax_number,
    };
  }

  private async writeProfile(accountId: string, snapshot: InvoiceSnapshot): Promise<void> {
    const updatedAt = this.now();
    if (!snapshot.wantsInvoice) {
      await this.pool.query(
        `INSERT INTO invoice_profiles (account_id, wants_invoice, title_kind, title, tax_number, updated_at)
         VALUES ($1, false, NULL, NULL, NULL, $2)
         ON CONFLICT (account_id) DO UPDATE
           SET wants_invoice = false, updated_at = EXCLUDED.updated_at`,
        [accountId, updatedAt],
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO invoice_profiles (account_id, wants_invoice, title_kind, title, tax_number, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id) DO UPDATE
         SET wants_invoice = EXCLUDED.wants_invoice,
             title_kind = EXCLUDED.title_kind,
             title = EXCLUDED.title,
             tax_number = EXCLUDED.tax_number,
             updated_at = EXCLUDED.updated_at`,
      [accountId, snapshot.wantsInvoice, snapshot.titleKind, snapshot.title, snapshot.taxNumber, updatedAt],
    );
  }

  private async openMonthlySubscription(row: OrderRow, openedAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscriptions
        (subscription_id, account_id, plan, amount_cents, price_version, auto_renew,
         next_charge_at, reminder_for_charge_at, opened_order_id, created_at, updated_at)
       VALUES ($1, $2, 'monthly', $3, $4, true, $5::timestamptz + interval '1 month', NULL, $6, $5, $5)
       ON CONFLICT (account_id) DO UPDATE
         SET plan = 'monthly',
             amount_cents = EXCLUDED.amount_cents,
             price_version = EXCLUDED.price_version,
             auto_renew = true,
             next_charge_at = EXCLUDED.next_charge_at,
             reminder_for_charge_at = NULL,
             charge_failed_at = NULL,
             charge_channel = NULL,
             next_retry_at = NULL,
             retries_remaining = NULL,
             entitlement_ends_at = NULL,
             opened_order_id = EXCLUDED.opened_order_id,
             updated_at = EXCLUDED.updated_at`,
      [randomUUID(), row.account_id, row.amount_cents, row.price_version, openedAt, row.order_id],
    );
  }

  private async readSubscription(accountId: string): Promise<Record<string, unknown> | Failure> {
    const found = await this.pool.query<{
      subscription_id: string;
      amount_cents: number;
      price_version: string;
      auto_renew: boolean;
      next_charge_at: Date | null;
      charge_failed_at: Date | null;
      charge_channel: string | null;
      next_retry_at: Date | null;
      retries_remaining: number | null;
      entitlement_ends_at: Date | null;
    }>(
      `SELECT subscription_id, amount_cents, price_version, auto_renew, next_charge_at,
              charge_failed_at, charge_channel, next_retry_at, retries_remaining, entitlement_ends_at
         FROM subscriptions WHERE account_id = $1`,
      [accountId],
    );
    const row = found.rows[0];
    if (!row) return fail(404, "subscription_missing", "还没有自动续费");
    const reminders = await this.pool.query<{ channel: string; status: string }>(
      `SELECT r.channel, r.status
         FROM renewal_reminders r
         JOIN subscriptions s ON s.subscription_id = r.subscription_id
        WHERE r.subscription_id = $1
          AND r.charge_at = s.next_charge_at
        ORDER BY r.channel`,
      [row.subscription_id],
    );
    const chargeFailure = row.charge_failed_at
      ? {
          phase: row.entitlement_ends_at ? "grace" : "retrying",
          failedAt: row.charge_failed_at.toISOString(),
          channel: row.charge_channel,
          nextRetryAt: row.next_retry_at?.toISOString() ?? null,
          retriesRemaining: row.retries_remaining,
          entitlementEndsAt: row.entitlement_ends_at?.toISOString() ?? null,
          graceDays: CHARGE_GRACE_DAYS,
          amountCents: row.amount_cents,
          actions: chargeFailureActions(),
        }
      : null;
    return {
      ok: true,
      subscriptionId: row.subscription_id,
      autoRenew: row.auto_renew,
      amountCents: row.amount_cents,
      priceVersion: row.price_version,
      nextChargeAt: row.next_charge_at?.toISOString() ?? null,
      reminders: reminders.rows.map((item) => ({ channel: item.channel, status: item.status })),
      chargeFailure,
    };
  }

  private present(
    orderId: string,
    plan: string,
    amountCents: number,
    priceVersion: string,
    state: string,
    createdAt: Date,
    invoice: InvoiceSnapshot,
  ): Record<string, unknown> {
    return {
      ok: true,
      orderId,
      plan,
      amountCents,
      priceVersion,
      state,
      stateLabel: STATE_LABEL[state] ?? state,
      createdAt: createdAt.toISOString(),
      wantsInvoice: invoice.wantsInvoice,
      invoiceTitleKind: invoice.titleKind,
      invoiceTitle: invoice.title,
      invoiceTaxNumber: invoice.taxNumber,
    };
  }
}

function emptyInvoice(): InvoiceSnapshot {
  return { wantsInvoice: false, titleKind: null, title: null, taxNumber: null };
}

function snapshotFromRow(row: OrderRow): InvoiceSnapshot {
  return {
    wantsInvoice: row.wants_invoice,
    titleKind: row.invoice_title_kind,
    title: row.invoice_title,
    taxNumber: row.invoice_tax_number,
  };
}

function normalizeTax(raw: string | null): string | null {
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return compact.length === 0 ? null : compact;
}

function formatYuan(cents: number): string {
  const yuan = Math.floor(cents / 100);
  const fen = String(cents % 100).padStart(2, "0");
  return `¥${yuan}.${fen}`;
}

function formatShanghaiDate(value: Date): string {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShanghaiDateTime(value: Date): string {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${formatShanghaiDate(value)} ${hour}:${minute}`;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseFutureInstant(raw: string | null, now: Date): Date | Failure {
  if (!raw) return fail(400, "charge_retry_missing", "渠道没有给出下一次重试时间");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    return fail(400, "charge_retry_invalid", "下一次重试时间不正确");
  }
  return parsed;
}

function chargeFailureBody(nextRetryAt: Date | null, entitlementEndsAt: Date | null): string {
  if (entitlementEndsAt) {
    return `自动续费扣款未成功。这是扣款失败，不是订阅终止。权益将在 ${formatShanghaiDateTime(entitlementEndsAt)} 失效。宽限期内时长、画质、设备数全部不变。`;
  }
  const when = nextRetryAt ? formatShanghaiDate(nextRetryAt) : "";
  return `自动续费扣款未成功。这是扣款失败，不是订阅终止。下一次 ${when}。`;
}

function chargeFailureActions(): Array<{ code: string; title: string }> {
  return [
    { code: "update_payment", title: "更新支付方式" },
    { code: "manual_renew", title: "手动续费" },
    { code: "close_auto_renew", title: "关闭自动续费" },
  ];
}

function renewalBody(amountCents: number, chargeAt: Date, now: Date): string {
  const remainingMs = chargeAt.getTime() - now.getTime();
  const remainingDays = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const amount = formatYuan(amountCents);
  const chargeDate = formatShanghaiDate(chargeAt);
  return `你的订阅将在 ${remainingDays} 天后继续。个人版 · 月付将在 ${chargeDate} 自动续费 ${amount}。如需停止，可在到期前随时取消，取消后当前周期仍可使用。`;
}
