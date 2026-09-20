import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { AccountService, type Failure } from "./account-service.js";
import { OrderService, type ChargeFailureInput, type InvoiceInput } from "./order-service.js";
import { OpsService, routeOps } from "./ops-service.js";
import { SessionService } from "./session-service.js";
import { attachWebRelayBridge } from "./web-relay-bridge.js";

type Json = Record<string, unknown>;

const buyPagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "buy", "index.html");
const buyUiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "buy", "purchase-ui.mjs");
const grantPagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "grant", "index.html");
const opsPagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "ops", "index.html");
const webControllerPagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "index.html");
const webControllerUiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "session-ui.mjs");
const webControllerFramePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "frame.mjs");
const webControllerH264Path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "h264.mjs");
const webControllerH264PainterPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "apps",
  "web-controller",
  "h264-painter.mjs",
);
const webControllerInputPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "input.mjs");
const webControllerGrantUiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web-controller", "grant-ui.mjs");

export function createHttpServer(
  pool: Pool,
  config: AppConfig,
  service: AccountService,
  sessions: SessionService,
  orders: OrderService,
  ops: OpsService,
) {
  const server = createServer((request, response) => {
    void handle(request, response, pool, config, service, sessions, orders, ops);
  });
  attachWebRelayBridge(server);
  return server;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  pool: Pool,
  config: AppConfig,
  service: AccountService,
  sessions: SessionService,
  orders: OrderService,
  ops: OpsService,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  try {
    if (method === "GET" && (url.pathname === "/buy" || url.pathname === "/buy/")) {
      const page = readFileSync(buyPagePath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(page.length),
      });
      response.end(page);
      return;
    }
    if (method === "GET" && url.pathname === "/buy/purchase-ui.mjs") {
      const script = readFileSync(buyUiPath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && (url.pathname === "/grant" || url.pathname === "/grant/")) {
      const page = readFileSync(grantPagePath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(page.length),
      });
      response.end(page);
      return;
    }
    if (method === "GET" && url.pathname === "/v1/connection-stats") {
      const provided = request.headers["x-connection-stats-secret"];
      const statsSecret = typeof provided === "string" ? provided : null;
      if (!config.connectionStatsSecret) {
        send(response, 503, { ok: false, code: "connection_stats_unconfigured", message: "连接统计尚未配置" });
        return;
      }
      if (statsSecret !== config.connectionStatsSecret) {
        send(response, 401, { ok: false, code: "connection_stats_invalid", message: "连接统计校验失败" });
        return;
      }
      send(response, 200, await sessions.connectionStats());
      return;
    }
    if (method === "GET" && (url.pathname === "/ops" || url.pathname === "/ops/")) {
      const page = readFileSync(opsPagePath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(page.length),
      });
      response.end(page);
      return;
    }
    if (url.pathname.startsWith("/v1/ops")) {
      const opsBody = method === "GET" ? {} : await readJson(request);
      const opsResult = await routeOps(ops, method, url.pathname, opsBody, bearer(request), url.searchParams.get("phone"));
      if (!opsResult) {
        send(response, 404, { ok: false, code: "not_found", message: "路径不存在" });
        return;
      }
      if (opsResult.ok === false) {
        const failure = opsResult as Failure;
        send(response, failure.status, { ok: false, code: failure.code, message: failure.message, ...(failure.extra ?? {}) });
        return;
      }
      send(response, 200, opsResult);
      return;
    }
    if (method === "GET" && (url.pathname === "/web" || url.pathname === "/web/")) {
      const page = readFileSync(webControllerPagePath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(page.length),
      });
      response.end(page);
      return;
    }
    if (method === "GET" && url.pathname === "/web/session-ui.mjs") {
      const script = readFileSync(webControllerUiPath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/web/frame.mjs") {
      const script = readFileSync(webControllerFramePath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/web/h264.mjs") {
      const script = readFileSync(webControllerH264Path);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/web/h264-painter.mjs") {
      const script = readFileSync(webControllerH264PainterPath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/web/input.mjs") {
      const script = readFileSync(webControllerInputPath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/web/grant-ui.mjs") {
      const script = readFileSync(webControllerGrantUiPath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": String(script.length),
      });
      response.end(script);
      return;
    }
    if (method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      send(response, 200, { ok: true });
      return;
    }
    if (method === "GET" && url.pathname === "/v1/config/public") {
      send(response, 200, {
        deviceQuota: config.deviceQuota,
        freeRelayBytes: config.freeRelayBytes,
        freeBitrateKbps: config.freeBitrateKbps,
        freeMaxFps: config.freeMaxFps,
        displayMinuteFloorKbps: config.displayMinuteFloorKbps,
        channelLimit: config.channelLimit,
        sessionsPerChannel: config.sessionsPerChannel,
        payDevSimulate: config.payDevSimulate,
      });
      return;
    }

    const body = method === "GET" || method === "DELETE" ? {} : await readJson(request);
    const token = bearer(request);
    const result = await dispatch(
      service,
      sessions,
      orders,
      method,
      url.pathname,
      body,
      token,
      relaySecret(request),
      signalSecret(request),
      orderSecret(request),
      realNameSecret(request),
      url.searchParams,
    );
    if (!result) {
      send(response, 404, { ok: false, code: "not_found", message: "路径不存在" });
      return;
    }
    if (result.ok === false) {
      const failure = result as Failure;
      send(response, failure.status, {
        ok: false,
        code: failure.code,
        message: failure.message,
        ...(failure.extra ?? {}),
      });
      return;
    }
    send(response, 200, result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "invalid_json") {
      send(response, 400, { ok: false, code: "invalid_json", message: "请求体不是 JSON" });
      return;
    }
    if (code === "body_too_large") {
      send(response, 413, { ok: false, code: "body_too_large", message: "请求体过大" });
      return;
    }
    const detail = error instanceof Error ? error.message : "unknown";
    process.stderr.write(`request failed: ${detail}\n`);
    send(response, 500, { ok: false, code: "internal", message: "服务暂时不可用" });
  }
}

async function dispatch(
  service: AccountService,
  sessions: SessionService,
  orders: OrderService,
  method: string,
  pathname: string,
  body: Json,
  token: string | null,
  relaySecret: string | null,
  signalSecretHeader: string | null,
  orderSecretHeader: string | null,
  realNameSecretHeader: string | null,
  searchParams: URLSearchParams,
): Promise<Record<string, unknown> | Failure | null> {
  if (method === "POST" && pathname === "/v1/challenges") {
    return service.createChallenge({
      purpose: text(body, "purpose") ?? "",
      phone: text(body, "phone"),
      email: text(body, "email"),
      token,
    });
  }
  if (method === "POST" && pathname === "/v1/accounts") {
    return service.register({
      phone: text(body, "phone") ?? "",
      challengeId: text(body, "challengeId") ?? "",
      challengeCode: text(body, "challengeCode") ?? "",
      password: text(body, "password") ?? "",
      city: text(body, "city"),
    });
  }
  if (method === "POST" && pathname === "/v1/sessions") {
    return service.login({
      phone: text(body, "phone"),
      email: text(body, "email"),
      password: text(body, "password"),
      challengeId: text(body, "challengeId"),
      challengeCode: text(body, "challengeCode"),
      city: text(body, "city"),
    });
  }
  if (method === "POST" && pathname === "/v1/sessions/refresh") return service.refresh(token);
  if (method === "DELETE" && pathname === "/v1/sessions/current") return service.logout(token);
  if (method === "GET" && pathname === "/v1/sessions") return service.listSessions(token);
  if (method === "POST" && pathname === "/v1/sessions/revoke-others") {
    return service.revokeOtherSessions(token, text(body, "challengeId") ?? "", text(body, "challengeCode") ?? "");
  }
  const revokeOne = pathname.match(/^\/v1\/sessions\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeOne?.[1]) return service.revokeSession(token, revokeOne[1]);

  if (method === "GET" && pathname === "/v1/account") return service.getAccount(token);
  if (method === "POST" && pathname === "/v1/password/change") {
    return service.changePassword(token, text(body, "oldPassword") ?? "", text(body, "newPassword") ?? "");
  }
  if (method === "POST" && pathname === "/v1/password/forgot") {
    return service.forgotPassword({
      phone: text(body, "phone") ?? "",
      challengeId: text(body, "challengeId"),
      challengeCode: text(body, "challengeCode"),
      recoveryCode: text(body, "recoveryCode"),
      newPassword: text(body, "newPassword") ?? "",
    });
  }
  if (method === "POST" && pathname === "/v1/recovery-code/rotate") return service.rotateRecoveryCode(token);
  if (method === "POST" && pathname === "/v1/email/bind") {
    return service.bindEmail(token, text(body, "email") ?? "", text(body, "challengeId") ?? "", text(body, "challengeCode") ?? "");
  }
  if (method === "DELETE" && pathname === "/v1/email") return service.unbindEmail(token);
  if (method === "POST" && pathname === "/v1/phone/change") {
    return service.changePhone(token, {
      newPhone: text(body, "newPhone") ?? "",
      password: text(body, "password") ?? "",
      challengeId: text(body, "challengeId") ?? "",
      challengeCode: text(body, "challengeCode") ?? "",
    });
  }
  if (method === "POST" && pathname === "/v1/account/deletion") return service.requestDeletion(token);
  if (method === "POST" && pathname === "/v1/account/deletion/cancel") return service.cancelDeletion(token);

  if (method === "GET" && pathname === "/v1/host-devices") return service.listHostDevices(token);
  if (method === "POST" && pathname === "/v1/host-devices") {
    return service.addHostDevice(token, {
      displayName: text(body, "displayName") ?? "",
      platform: text(body, "platform") ?? "",
      hardwareFingerprint: text(body, "hardwareFingerprint") ?? "",
      challengeId: text(body, "challengeId"),
      challengeCode: text(body, "challengeCode"),
    });
  }
  if (method === "POST" && pathname === "/v1/host-devices/remove-all") {
    return service.removeAllHostDevices(token, text(body, "challengeId") ?? "", text(body, "challengeCode") ?? "");
  }
  const deviceAction = pathname.match(/^\/v1\/host-devices\/([^/]+)(?:\/([a-z-]+))?$/);
  if (deviceAction?.[1] && method === "PATCH" && !deviceAction[2]) {
    return service.renameHostDevice(token, deviceAction[1], text(body, "displayName") ?? "");
  }
  if (deviceAction?.[1] && deviceAction[2] === "trusted-controllers" && method === "GET") {
    return sessions.listTrustedControllers(token, deviceAction[1]);
  }
  if (deviceAction?.[1] && deviceAction[2] === "trusted-controllers" && method === "POST") {
    if (body.alwaysAllow === true) {
      return { ok: false, status: 400, code: "trust_cannot_skip_confirm", message: "不能改成以后不再询问" };
    }
    return sessions.trustController(
      token,
      deviceAction[1],
      text(body, "controllerAccountId") ?? "",
      body.fraudAcknowledged === true,
    );
  }
  if (deviceAction?.[1] && deviceAction[2] === "trusted-controllers" && method === "DELETE") {
    return sessions.untrustController(token, deviceAction[1], searchParams.get("controllerAccountId") ?? "");
  }
  if (deviceAction?.[1] && deviceAction[2] === "family" && method === "POST") {
    if (typeof body.family !== "boolean") {
      return { ok: false, status: 400, code: "family_invalid", message: "需要明确是否标成家人设备" };
    }
    return sessions.setFamilyDevice(token, deviceAction[1], body.family);
  }
  if (deviceAction?.[1] && deviceAction[2] === "stop" && method === "POST") {
    return sessions.stopControlled(token, deviceAction[1]);
  }
  if (deviceAction?.[1] && deviceAction[2] === "credentials" && method === "POST") {
    return service.publishCredentials(token, deviceAction[1], text(body, "deviceCode") ?? "", text(body, "tempPasswordHash") ?? "");
  }
  if (deviceAction?.[1] && deviceAction[2] === "accepting" && method === "POST") {
    if (typeof body.accepting !== "boolean") {
      return { ok: false, status: 400, code: "accepting_invalid", message: "需要明确是否允许被连接" };
    }
    return service.setAcceptingConnections(token, deviceAction[1], body.accepting);
  }
  if (deviceAction?.[1] && deviceAction[2] === "cancel-authorization" && method === "POST") {
    return service.cancelAuthorization(token, deviceAction[1]);
  }
  if (deviceAction?.[1] && deviceAction[2] === "remove" && method === "POST") {
    return service.removeHostDevice(token, deviceAction[1]);
  }
  if (deviceAction?.[1] && deviceAction[2] === "confirm" && method === "POST") {
    return service.confirmHostDevice(token, deviceAction[1], body.confirmedOnHost === true);
  }
  if (deviceAction?.[1] && deviceAction[2] === "presence" && method === "POST") {
    return service.setPresence(token, deviceAction[1], text(body, "state") ?? "");
  }

  if (method === "GET" && pathname === "/v1/notices") return service.listNotices(token);
  const notice = pathname.match(/^\/v1\/notices\/([^/]+)\/read$/);
  if (method === "POST" && notice?.[1]) return service.markNoticeRead(token, notice[1]);

  if (method === "GET" && pathname === "/v1/relay-balance") return sessions.balance(token);
  if (method === "GET" && pathname === "/v1/catalog") return orders.catalog();
  if (method === "GET" && pathname === "/v1/invoice") return orders.getInvoice(token);
  if (method === "POST" && pathname === "/v1/invoice") return orders.saveInvoice(token, invoiceInput(body));
  if (method === "GET" && pathname === "/v1/subscription") return orders.getSubscription(token);
  if (method === "POST" && pathname === "/v1/subscription/auto-renew") {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, status: 400, code: "auto_renew_invalid", message: "需要明确是否继续自动续费" };
    }
    return orders.setAutoRenew(token, body.enabled);
  }
  const chargeResult = pathname.match(/^\/v1\/subscriptions\/([^/]+)\/charge-result$/);
  if (method === "POST" && chargeResult?.[1]) {
    const remaining = retriesRemaining(body);
    if (remaining === undefined) {
      return { ok: false, status: 400, code: "charge_retry_invalid", message: "重试次数不正确" };
    }
    const input: ChargeFailureInput = {
      channel: text(body, "channel"),
      retriesRemaining: remaining,
      nextRetryAt: text(body, "nextRetryAt"),
    };
    return orders.recordChargeFailure(orderSecretHeader, chargeResult[1], input);
  }
  if (method === "GET" && pathname === "/v1/orders") return orders.list(token);
  if (method === "POST" && pathname === "/v1/orders") {
    return orders.create(token, text(body, "plan") ?? "", invoiceInput(body), text(body, "payChannel"));
  }
  const orderProvider = pathname.match(/^\/v1\/orders\/([^/]+)\/provider$/);
  if (method === "POST" && orderProvider?.[1]) {
    return orders.applyProviderResult(orderSecretHeader, orderProvider[1], text(body, "state") ?? "");
  }
  const orderSimulate = pathname.match(/^\/v1\/orders\/([^/]+)\/dev-simulate$/);
  if (method === "POST" && orderSimulate?.[1]) {
    return orders.simulateOwnerProgress(token, orderSimulate[1], text(body, "state") ?? "");
  }
  if (method === "GET" && pathname === "/v1/connection-disclosure") return sessions.connectionDisclosure(token);
  if (method === "POST" && pathname === "/v1/connection-disclosure") return sessions.acknowledgeDisclosure(token);
  if (method === "GET" && pathname === "/v1/real-name") {
    return sessions.realName(token, searchParams.get("controllerFingerprint"), searchParams.get("hostDeviceId"));
  }
  const realNameProvider = pathname.match(/^\/v1\/real-name\/([^/]+)\/provider$/);
  if (method === "POST" && realNameProvider?.[1]) {
    if (body.verified !== true) {
      return { ok: false, status: 400, code: "real_name_result_invalid", message: "核验结果不正确" };
    }
    const acceptsIdentity = "idNumber" in body || "name" in body || "photo" in body;
    return sessions.recordRealName(realNameSecretHeader, realNameProvider[1], acceptsIdentity);
  }
  if (method === "POST" && pathname === "/v1/web-grants") {
    return service.issueWebGrant(token, {
      password: text(body, "password") ?? "",
      challengeId: text(body, "challengeId") ?? "",
      challengeCode: text(body, "challengeCode") ?? "",
      confirmed: body.confirmed === true,
      recoveryCode: text(body, "recoveryCode"),
    });
  }
  if (method === "POST" && pathname === "/v1/web-grants/redeem") {
    return sessions.redeemWebGrant(
      text(body, "code") ?? "",
      text(body, "hostDeviceId") ?? "",
      text(body, "controllerFingerprint") ?? "",
    );
  }
  const webSession = pathname.match(/^\/v1\/web-sessions\/([^/]+)$/);
  if (method === "GET" && webSession?.[1]) {
    return sessions.getWebSession(webSession[1], searchParams.get("controllerFingerprint") ?? "");
  }
  if (method === "GET" && pathname === "/v1/remote-sessions/incoming") return sessions.listIncoming(token);
  if (method === "GET" && pathname === "/v1/remote-sessions/host-attach") return sessions.takeHostRelayTicket(token);
  if (method === "POST" && pathname === "/v1/remote-sessions") {
    return sessions.requestSession(token, text(body, "hostDeviceId") ?? "", text(body, "controllerFingerprint") ?? "");
  }
  const remoteLookup = pathname.match(/^\/v1\/remote-sessions\/([^/]+)$/);
  if (method === "GET" && remoteLookup?.[1]) return sessions.getRemoteSession(token, remoteLookup[1]);
  const remoteAction = pathname.match(/^\/v1\/remote-sessions\/([^/]+)\/(consent|direct|reject|input)$/);
  if (method === "POST" && remoteAction?.[1] && remoteAction[2] === "consent") {
    return sessions.consent(token, remoteAction[1], body.confirmedOnHost === true);
  }
  if (method === "POST" && remoteAction?.[1] && remoteAction[2] === "reject") {
    return sessions.rejectIncoming(token, remoteAction[1]);
  }
  if (method === "POST" && remoteAction?.[1] && remoteAction[2] === "input") {
    return sessions.setInputAllowed(token, remoteAction[1], body.allowed === true);
  }
  if (method === "POST" && remoteAction?.[1] && remoteAction[2] === "direct") {
    return sessions.reportDirect(token, remoteAction[1], {
      event: text(body, "event") ?? "",
      punchResult: text(body, "punchResult"),
      punchBucket: text(body, "punchBucket"),
      bitrateKbps: integer(body, "bitrateKbps"),
    });
  }
  if (method === "POST" && pathname === "/v1/host-access/verify") {
    return service.verifyHostPassword(text(body, "deviceCode") ?? "", text(body, "tempPassword") ?? "");
  }
  if (method === "POST" && pathname === "/v1/relay/tickets/inspect") {
    return sessions.inspect(signalSecretHeader, text(body, "ticket") ?? "");
  }
  if (method === "POST" && pathname === "/v1/relay/tickets/admit") {
    return sessions.admit(relaySecret, {
      ticket: text(body, "ticket") ?? "",
      controllerFingerprint: text(body, "controllerFingerprint") ?? "",
      hostFingerprint: text(body, "hostFingerprint") ?? "",
    });
  }
  if (method === "POST" && pathname === "/v1/relay/heartbeats") {
    return sessions.heartbeat(relaySecret, {
      ticket: text(body, "ticket") ?? "",
      heartbeatId: text(body, "heartbeatId") ?? "",
      bytes: integer(body, "bytes") ?? -1,
      durationSeconds: integer(body, "durationSeconds") ?? -1,
      acceptDegrade: body.acceptDegrade === true,
    });
  }
  return null;
}

function invoiceInput(body: Json): InvoiceInput {
  return {
    wantsInvoice: typeof body.wantsInvoice === "boolean" ? body.wantsInvoice : null,
    titleKind: text(body, "titleKind"),
    title: text(body, "title"),
    taxNumber: text(body, "taxNumber"),
  };
}

function retriesRemaining(body: Json): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, "retriesRemaining") || body.retriesRemaining == null) return null;
  const value = body.retriesRemaining;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function text(body: Json, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function integer(body: Json, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function orderSecret(request: IncomingMessage): string | null {
  const header = request.headers["x-order-secret"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

function realNameSecret(request: IncomingMessage): string | null {
  const header = request.headers["x-real-name-secret"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

function relaySecret(request: IncomingMessage): string | null {
  const header = request.headers["x-relay-secret"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

function signalSecret(request: IncomingMessage): string | null {
  const header = request.headers["x-signal-secret"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

function bearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function readJson(request: IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("invalid_json"));
          return;
        }
        resolve(parsed as Json);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", () => reject(new Error("invalid_json")));
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
