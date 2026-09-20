import assert from "node:assert/strict";
import {
  catalogOfferCopy,
  findOrder,
  formatYuan,
  hasForbiddenResultPhrase,
  presentResult,
  resultTitle,
  shouldPollOrder,
  canApplyProviderState,
  simulateActions,
} from "./purchase-ui.mjs";

assert.equal(formatYuan(15800), "¥158.00");
assert.equal(formatYuan(2400), "¥24.00");

const catalog = {
  priceVersion: "v-test",
  yearly: { amountCents: 15800, perMonthLabel: "13.2" },
  monthly: { amountCents: 2400, autoRenew: true },
};
const yearly = catalogOfferCopy(catalog, "yearly");
assert.equal(yearly.amountText, "¥158.00");
assert.ok(yearly.note.includes("13.2"));
assert.ok(yearly.version.includes("v-test"));
assert.equal(yearly.ready, true);
assert.equal(catalogOfferCopy(null, "yearly").ready, false);

assert.equal(resultTitle("opened"), "已开通");
assert.equal(resultTitle("unfinished"), "支付未完成");
assert.equal(resultTitle("confirming"), "确认中");
assert.equal(resultTitle("closed"), "订单已关闭");

for (const state of ["opened", "unfinished", "confirming", "closed"]) {
  const view = presentResult({
    state,
    orderId: "11111111-2222-3333-4444-555555555555",
    amountCents: 15800,
    payChannel: "wechat",
    priceVersion: "v-test",
  });
  assert.equal(view.title, resultTitle(state));
  assert.equal(view.forbidden, false);
  assert.equal(view.canRetrySameOrder, false);
  assert.equal(hasForbiddenResultPhrase(view.title + view.lines.join("") + view.actionHint), false);
}

const confirming = presentResult({ state: "confirming", orderId: "a", amountCents: 100, payChannel: "alipay" });
assert.ok(confirming.actionHint.includes("不能再付一次"));
assert.ok(confirming.lines.some((line) => line.includes("可以关掉")));

const closed = presentResult({ state: "closed", orderId: "b", amountCents: 100, payChannel: "wechat" });
assert.ok(closed.actionHint.includes("新建订单"));
assert.ok(!closed.lines.join("").includes("支付失败"));

assert.equal(shouldPollOrder("unfinished"), true);
assert.equal(shouldPollOrder("confirming"), true);
assert.equal(shouldPollOrder("opened"), false);
assert.equal(shouldPollOrder("closed"), false);

assert.deepEqual(
  findOrder([{ orderId: "x", state: "opened" }, { orderId: "y", state: "confirming" }], "y"),
  { orderId: "y", state: "confirming" },
);

assert.equal(canApplyProviderState("unfinished", "confirming"), true);
assert.equal(canApplyProviderState("unfinished", "opened"), true);
assert.equal(canApplyProviderState("confirming", "opened"), true);
assert.equal(canApplyProviderState("confirming", "unfinished"), false);
assert.equal(canApplyProviderState("opened", "closed"), false);
assert.deepEqual(
  simulateActions("unfinished", true).map((row) => row.state),
  ["confirming", "opened", "closed"],
);
assert.deepEqual(simulateActions("confirming", true).map((row) => row.state), ["opened", "closed"]);
assert.deepEqual(simulateActions("unfinished", false), []);

console.log("buy purchase-ui ok");
