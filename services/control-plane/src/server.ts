import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { AccountService, type Failure } from "./account-service.js";

type Json = Record<string, unknown>;

export function createHttpServer(pool: Pool, config: AppConfig, service: AccountService) {
  return createServer((request, response) => {
    void handle(request, response, pool, config, service);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  pool: Pool,
  config: AppConfig,
  service: AccountService,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  try {
    if (method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      send(response, 200, { ok: true });
      return;
    }
    if (method === "GET" && url.pathname === "/v1/config/public") {
      send(response, 200, { deviceQuota: config.deviceQuota });
      return;
    }

    const body = method === "GET" || method === "DELETE" ? {} : await readJson(request);
    const token = bearer(request);
    const result = await dispatch(service, method, url.pathname, body, token);
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
  method: string,
  pathname: string,
  body: Json,
  token: string | null,
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
  return null;
}

function text(body: Json, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
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
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
