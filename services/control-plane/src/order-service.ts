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

/** 订单只固化下单当时的价格。确认中不是失败，这里也不自动重试扣款。 */
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

  async create(token: string | null, planRaw: string): Promise<Record<string, unknown> | Failure> {
    const plan = planRaw.trim();
    if (plan !== "yearly" && plan !== "monthly") return fail(400, "plan_invalid", "套餐只能是年付或月付");
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const amountCents = plan === "yearly" ? this.config.yearlyPriceCents : this.config.monthlyPriceCents;
    const orderId = randomUUID();
    const createdAt = this.now();
    await this.pool.query(
      `INSERT INTO orders (order_id, account_id, plan, amount_cents, price_version, state, created_at)
       VALUES ($1, $2, $3, $4, $5, 'unfinished', $6)`,
      [orderId, session.accountId, plan, amountCents, this.config.priceVersion, createdAt],
    );
    return this.present(orderId, plan, amountCents, this.config.priceVersion, "unfinished", createdAt);
  }

  async applyProviderResult(secret: string | null, orderId: string, providerStateRaw: string): Promise<Record<string, unknown> | Failure> {
    if (!this.config.orderCallbackSecret) return fail(503, "order_callback_unconfigured", "支付回调尚未配置");
    if (secret !== this.config.orderCallbackSecret) return fail(401, "order_callback_invalid", "支付回调校验失败");
    const providerState = providerStateRaw.trim();
    if (providerState !== "confirming" && providerState !== "opened" && providerState !== "closed") {
      return fail(400, "order_state_invalid", "支付结果不正确");
    }
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return fail(400, "order_invalid", "订单不正确");
    const found = await this.pool.query<{
      order_id: string;
      plan: string;
      amount_cents: number;
      price_version: string;
      state: string;
      created_at: Date;
    }>(
      `SELECT order_id, plan, amount_cents, price_version, state, created_at
         FROM orders WHERE order_id = $1`,
      [orderId],
    );
    const row = found.rows[0];
    if (!row) return fail(404, "order_missing", "订单不存在");
    if (row.state === providerState) {
      return this.present(row.order_id, row.plan, row.amount_cents, row.price_version, row.state, row.created_at);
    }
    const allowed = row.state === "unfinished" || (row.state === "confirming" && (providerState === "opened" || providerState === "closed"));
    if (!allowed) return fail(409, "order_not_retryable", "确认中不是支付失败，不能再付一次");
    await this.pool.query("UPDATE orders SET state = $2 WHERE order_id = $1", [orderId, providerState]);
    return this.present(row.order_id, row.plan, row.amount_cents, row.price_version, providerState, row.created_at);
  }

  async list(token: string | null): Promise<Record<string, unknown> | Failure> {
    const session = await this.accounts.authenticate(token);
    if (isAuthFailure(session)) return session;
    const rows = await this.pool.query<{
      order_id: string;
      plan: string;
      amount_cents: number;
      price_version: string;
      state: string;
      created_at: Date;
    }>(
      `SELECT order_id, plan, amount_cents, price_version, state, created_at
         FROM orders
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [session.accountId],
    );
    return {
      ok: true,
      orders: rows.rows.map((row) => ({
        orderId: row.order_id,
        plan: row.plan,
        amountCents: row.amount_cents,
        priceVersion: row.price_version,
        state: row.state,
        stateLabel: STATE_LABEL[row.state] ?? row.state,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  private present(
    orderId: string,
    plan: string,
    amountCents: number,
    priceVersion: string,
    state: string,
    createdAt: Date,
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
    };
  }
}
