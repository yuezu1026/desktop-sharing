/** 运营台登录、计量展示与例外加白文案。 */

/**
 * @param {{ setupRequired?: boolean, totpSecret?: string, setupToken?: string, token?: string, message?: string } | null} body
 * @param {boolean} ok
 */
export function loginOutcome(body, ok) {
  if (body?.setupRequired === true && body.totpSecret && body.setupToken) {
    return {
      kind: "setup",
      totpSecret: body.totpSecret,
      setupToken: body.setupToken,
      hint: "首次进入要先保存动态码密钥，用验证器生成码确认后再登录。密钥只出现这一次。",
    };
  }
  if (ok && body?.token) {
    return { kind: "ready", token: body.token, hint: "" };
  }
  return { kind: "error", hint: body?.message || "登录失败" };
}

/**
 * @param {{ ok?: boolean, message?: string } | null} body
 * @param {boolean} ok
 */
export function confirmTotpOutcome(body, ok) {
  if (ok && body?.ok === true) {
    return { kind: "confirmed", hint: "动态码已绑定。请用验证器里的码重新登录。" };
  }
  return { kind: "error", hint: body?.message || "动态码确认失败" };
}

/**
 * 运营台内部称「额度」；不得写成用户侧「免费中继时长」。
 * @param {{
 *   ok?: boolean,
 *   grants?: Array<{ kind?: string, bytesTotal?: number, remaining?: number }>,
 *   ledger?: Array<{ bytes?: number, createdAt?: string, remoteSessionId?: string, kind?: string }>,
 *   message?: string,
 * } | null} body
 */
export function formatMeterForOps(body) {
  if (!body || body.ok !== true) {
    return { ok: false, title: "额度", message: body?.message || "计量查询失败", grants: [], ledger: [] };
  }
  const grants = Array.isArray(body.grants) ? body.grants : [];
  const ledger = Array.isArray(body.ledger) ? body.ledger : [];
  return {
    ok: true,
    title: "额度（与用户侧同一账本）",
    grants: grants.map((row) => ({
      kind: row.kind || "",
      kindLabel: row.kind === "free" ? "免费额度" : row.kind === "paid" ? "付费额度" : "额度",
      bytesTotal: Number(row.bytesTotal) || 0,
      remainingBytes: Number(row.remaining) || 0,
    })),
    ledger: ledger.map((row) => ({
      bytes: Number(row.bytes) || 0,
      createdAt: row.createdAt || "",
      remoteSessionId: row.remoteSessionId || "",
      kind: row.kind || "",
    })),
  };
}

/**
 * 例外加白请求体。未勾选反诈确认不得发出。
 * @param {{
 *   hostDeviceId?: string,
 *   controllerAccountId?: string,
 *   reason?: string,
 *   fraudAcknowledged?: boolean,
 * }} input
 */
export function whitelistRequest(input) {
  const hostDeviceId = typeof input.hostDeviceId === "string" ? input.hostDeviceId.trim() : "";
  const controllerAccountId =
    typeof input.controllerAccountId === "string" ? input.controllerAccountId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!hostDeviceId || !controllerAccountId) {
    return { ok: false, message: "需要被控设备与控制端账号" };
  }
  if (!reason) {
    return { ok: false, message: "需要填写原因" };
  }
  if (input.fraudAcknowledged !== true) {
    return { ok: false, message: "例外加白也要再确认一次反诈" };
  }
  return {
    ok: true,
    body: {
      hostDeviceId,
      controllerAccountId,
      reason,
      fraudAcknowledged: true,
    },
  };
}

/**
 * @param {{ ok?: boolean, status?: string, approvalId?: string, message?: string } | null} body
 * @param {boolean} ok
 */
export function compensationOutcome(body, ok) {
  if (!ok || !body?.ok) {
    return { kind: "error", hint: body?.message || "补偿失败", approvalId: "" };
  }
  if (body.status === "pending" && body.approvalId) {
    return {
      kind: "pending",
      approvalId: body.approvalId,
      hint: "超过阈值，已进入复核。需另一名客服打开复核单批准后才到账。",
    };
  }
  if (body.status === "opened") {
    return { kind: "opened", hint: "补偿已入账", approvalId: "" };
  }
  return { kind: "error", hint: body.message || "补偿结果未知", approvalId: "" };
}

/**
 * @param {{ approvalId?: string }} input
 */
export function approveCompensationRequest(input) {
  const approvalId = typeof input.approvalId === "string" ? input.approvalId.trim() : "";
  if (!approvalId) return { ok: false, message: "需要复核单号" };
  return { ok: true, approvalId };
}
