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
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

type InvoiceSnapshot = {
  wantsInvoice: boolean;
  titleKind: string | null;
  title: string | null;
  taxNumber: string | null;
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
          SET auto_renew = $2, updated_at = $3
        WHERE account_id = $1`,
      [session.accountId, enabled, this.now()],
    );
    if (!updated.rowCount) return fail(404, "subscription_missing", "还没有自动续费");
    return this.readSubscription(session.accountId);
  }

  /** 扣费前 5 日：应用内一条，外加微信和支付宝各一条。邮件只在已验证时排队。 */
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
    }>(
      `SELECT subscription_id, amount_cents, price_version, auto_renew, next_charge_at
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
    return {
      ok: true,
      autoRenew: row.auto_renew,
      amountCents: row.amount_cents,
      priceVersion: row.price_version,
      nextChargeAt: row.next_charge_at?.toISOString() ?? null,
      reminders: reminders.rows.map((item) => ({ channel: item.channel, status: item.status })),
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

function renewalBody(amountCents: number, chargeAt: Date, now: Date): string {
  const remainingMs = chargeAt.getTime() - now.getTime();
  const remainingDays = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const amount = formatYuan(amountCents);
  const chargeDate = formatShanghaiDate(chargeAt);
  return `你的订阅将在 ${remainingDays} 天后继续。个人版 · 月付将在 ${chargeDate} 自动续费 ${amount}。如需停止，可在到期前随时取消，取消后当前周期仍可使用。`;
}
