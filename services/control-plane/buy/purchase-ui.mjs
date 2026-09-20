/** 官网购买页：目录展示与支付结果四态文案。金额只来自服务端目录。 */

/**
 * @param {number} amountCents
 */
export function formatYuan(amountCents) {
  const wholeYuan = Math.trunc(amountCents / 100);
  const fenPart = String(Math.abs(amountCents % 100)).padStart(2, "0");
  return "¥" + String(wholeYuan) + "." + fenPart;
}

/**
 * @param {{ yearly?: { amountCents?: number, perMonthLabel?: string }, monthly?: { amountCents?: number, autoRenew?: boolean }, priceVersion?: string } | null} catalog
 * @param {"yearly" | "monthly"} plan
 */
export function catalogOfferCopy(catalog, plan) {
  if (!catalog?.yearly || !catalog?.monthly || !catalog.priceVersion) {
    return { amountText: "价格读取中", note: "", version: "价格与权益由服务端下发", ready: false };
  }
  if (plan === "yearly") {
    return {
      amountText: formatYuan(catalog.yearly.amountCents ?? 0),
      note: "/ 年（约 ¥" + (catalog.yearly.perMonthLabel ?? "") + " / 月，只展示不另收费）",
      version: "价格版本 " + catalog.priceVersion + " · 由服务端下发",
      ready: true,
    };
  }
  return {
    amountText: formatYuan(catalog.monthly.amountCents ?? 0),
    note: catalog.monthly.autoRenew ? "/ 月 · 自动续费" : "/ 月",
    version: "价格版本 " + catalog.priceVersion + " · 由服务端下发",
    ready: true,
  };
}

/**
 * @param {string | null | undefined} state
 */
export function resultTitle(state) {
  switch (state) {
    case "opened":
      return "已开通";
    case "unfinished":
      return "支付未完成";
    case "confirming":
      return "确认中";
    case "closed":
      return "订单已关闭";
    default:
      return "订单状态未知";
  }
}

/**
 * @param {string | null | undefined} state
 */
export function resultLines(state) {
  switch (state) {
    case "opened":
      return [
        "权益已到账，可以关掉这一屏。",
        "发票如有填写，会按支付前确认的抬头开具。",
      ];
    case "unfinished":
      return [
        "还没有收到渠道结果。这不等于扣款失败。",
        "不会自动再扣一次。你可以稍后回来查看，或重新下单并重新取价。",
      ];
    case "confirming":
      return [
        "渠道已受理，我方还在确认入账。",
        "可以关掉这一屏。结果落定后权益会自动补发，请不要再付一次。",
      ];
    case "closed":
      return [
        "超过保留时间未完成支付，订单已自动关闭。",
        "关闭不是拒绝服务。若要购买，请新建订单并重新取价。",
      ];
    default:
      return ["请稍后刷新查看订单状态。"];
  }
}

/**
 * 确认中不能再付；已关闭要新建订单；未完成可回购买页；已开通无需再付。
 * @param {string | null | undefined} state
 */
export function payAction(state) {
  switch (state) {
    case "confirming":
      return { canRetrySameOrder: false, hint: "确认中不是支付失败，不能再付一次" };
    case "closed":
      return { canRetrySameOrder: false, hint: "请新建订单并重新取价" };
    case "unfinished":
      return { canRetrySameOrder: false, hint: "不会自动重试扣款" };
    case "opened":
      return { canRetrySameOrder: false, hint: "权益已开通" };
    default:
      return { canRetrySameOrder: false, hint: "" };
  }
}

/**
 * 允许写「不是支付失败」澄清；禁止把结果标题/正文说成支付失败，也禁止假进度条与「重新支付」。
 * @param {string} text
 */
export function hasForbiddenResultPhrase(text) {
  if (/假进度|重新支付/.test(text)) return true;
  const withoutNegation = text.replace(/不是支付失败/g, "");
  return /支付失败/.test(withoutNegation);
}

/**
 * @param {{ state?: string, orderId?: string, amountCents?: number, payChannel?: string | null, priceVersion?: string } | null} order
 */
export function presentResult(order) {
  if (!order || !order.state) {
    return { title: "", lines: [], forbidden: false, actionHint: "" };
  }
  const title = resultTitle(order.state);
  const lines = resultLines(order.state);
  const action = payAction(order.state);
  const detail = [
    order.orderId ? "订单号 " + order.orderId : "",
    typeof order.amountCents === "number" ? "金额 " + formatYuan(order.amountCents) : "",
    order.payChannel === "alipay" ? "渠道 支付宝" : order.payChannel === "wechat" ? "渠道 微信支付" : "",
    order.priceVersion ? "价格版本 " + order.priceVersion : "",
  ].filter(Boolean);
  const allText = [title, ...lines, action.hint, ...detail].join("\n");
  return {
    title,
    lines: [...detail, ...lines],
    actionHint: action.hint,
    canRetrySameOrder: action.canRetrySameOrder,
    forbidden: hasForbiddenResultPhrase(allText),
  };
}

/**
 * @param {Array<{ orderId?: string, state?: string }> | null | undefined} orders
 * @param {string} orderId
 */
export function findOrder(orders, orderId) {
  if (!Array.isArray(orders) || !orderId) return null;
  return orders.find((row) => row.orderId === orderId) ?? null;
}

/**
 * 未完成与确认中需要继续轮询；已开通与已关闭停轮询。
 * @param {string | null | undefined} state
 */
export function shouldPollOrder(state) {
  return state === "unfinished" || state === "confirming";
}

/**
 * 渠道回调允许的状态迁移。确认中不能回到未完成，也不能再付同一单。
 * @param {string} fromState
 * @param {string} toState
 */
export function canApplyProviderState(fromState, toState) {
  if (toState !== "confirming" && toState !== "opened" && toState !== "closed") return false;
  if (fromState === toState) return true;
  if (fromState === "unfinished") return true;
  if (fromState === "confirming") return toState === "opened" || toState === "closed";
  return false;
}

/**
 * 开发态模拟渠道时，结果页可点的推进按钮。
 * @param {string | null | undefined} state
 * @param {boolean} payDevSimulate
 */
export function simulateActions(state, payDevSimulate) {
  if (!payDevSimulate) return [];
  const actions = [];
  if (canApplyProviderState(state ?? "", "confirming") && state !== "confirming") {
    actions.push({ state: "confirming", label: "模拟：进入确认中" });
  }
  if (canApplyProviderState(state ?? "", "opened") && state !== "opened") {
    actions.push({ state: "opened", label: "模拟：标记已开通" });
  }
  if (canApplyProviderState(state ?? "", "closed") && state !== "closed") {
    actions.push({ state: "closed", label: "模拟：关闭订单" });
  }
  return actions;
}
