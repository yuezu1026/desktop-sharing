/** 首次连接隐私告知文案，对齐 W5-01；禁写端到端加密等红线词。 */

export const DISCLOSURE_HF = {
  chromeTitle: "隐私说明（首次连接时出现一次）",
  headline: "连接前，有两件事需要你知道",
  relayTitle: "① 走中继时，画面数据会经过我们的服务器转发",
  relayBody:
    "直连不可用时，连接会通过我们的中继服务器转发。转发全程加密传输，但我们可以在转发环节看到流量大小（用于计量与限流），因此中继连接不属于端到端加密。若你需要完全端到端的场景，请优先使用直连。",
  directTitle: "② 走直连时，我们只记录会话开始与结束",
  directBody:
    "直连时数据点对点传输、不经过我们。我们只记录会话起止时间，不记录流量大小，也不据此计费（直连不消耗中继时长）。",
  accept: "我知道了",
  privacyHint: "完整内容见《隐私政策》",
  dontRemind: "不再提示（仍可随时在设置中查看）",
};

/** 文案红线：出现即 FAIL（W5-01）。 */
export const DISCLOSURE_FORBIDDEN = ["端到端加密", "我们看不到任何数据", "军工级", "银行级"];

/**
 * @param {string} text
 * @returns {string[]} 命中的禁词
 */
export function findForbiddenDisclosurePhrases(text) {
  const source = String(text ?? "");
  return DISCLOSURE_FORBIDDEN.filter((phrase) => source.includes(phrase));
}

/**
 * 允许说明「不属于端到端加密」；禁止把产品自称成端到端加密。
 * @param {typeof DISCLOSURE_HF} copy
 */
export function assertDisclosureCopySafe(copy = DISCLOSURE_HF) {
  const joined = [copy.headline, copy.relayTitle, copy.directTitle, copy.directBody, copy.accept, copy.privacyHint]
    .join("\n");
  // relayBody 允许出现「不属于端到端加密」，单独检查其它禁词与自称
  const hits = [];
  if (joined.includes("我们看不到任何数据")) hits.push("我们看不到任何数据");
  if (joined.includes("军工级")) hits.push("军工级");
  if (joined.includes("银行级")) hits.push("银行级");
  // 禁止肯定式「端到端加密」自称（排除「不属于端到端加密」）
  const stripped = String(copy.relayBody ?? "").replaceAll("不属于端到端加密", "");
  const rest = [copy.headline, copy.relayTitle, copy.directTitle, copy.directBody, stripped].join("\n");
  if (rest.includes("端到端加密")) hits.push("端到端加密");
  return hits;
}
