/** Web 控制端经本进程 TLS 进中继，再把画面帧用 WebSocket 转给浏览器。
 * 浏览器不直接校验中继自签证书；解码在页面里做。
 */

import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

const FRAME_HEADER_BYTES = 12;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const HELLO_LIMIT = 4096;

type HelloMessage = {
  ticket?: string;
  fingerprint?: string;
};

export function attachWebRelayBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/v1/web-relay") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket as Duplex, head, (websocket) => {
      void bridgeClient(websocket, request);
    });
  });
}

async function bridgeClient(websocket: WebSocket, _request: IncomingMessage): Promise<void> {
  let relay: TLSSocket | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (relay) {
      relay.destroy();
      relay = null;
    }
    if (websocket.readyState === websocket.OPEN || websocket.readyState === websocket.CONNECTING) {
      websocket.close();
    }
  };

  websocket.on("close", cleanup);
  websocket.on("error", cleanup);

  try {
    const hello = await readFirstJson(websocket);
    const ticket = typeof hello.ticket === "string" ? hello.ticket.trim() : "";
    const fingerprint = typeof hello.fingerprint === "string" ? hello.fingerprint.trim() : "";
    if (ticket.length < 20 || fingerprint.length < 8) {
      websocket.send(JSON.stringify({ ok: false, code: "hello_invalid", message: "票据或指纹不正确" }));
      cleanup();
      return;
    }
    relay = await connectRelay(ticket, fingerprint);
    websocket.send(JSON.stringify({ ok: true, state: "relay" }));
    let buffer = Buffer.alloc(0);
    relay.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const taken = takeFrame(buffer);
        if (!taken) break;
        buffer = Buffer.from(taken.rest);
        if (websocket.readyState === websocket.OPEN) {
          websocket.send(taken.frame);
        }
      }
    });
    relay.on("error", cleanup);
    relay.on("close", cleanup);
  } catch {
    if (websocket.readyState === websocket.OPEN) {
      websocket.send(JSON.stringify({ ok: false, code: "relay_connect_failed", message: "中继未接通" }));
    }
    cleanup();
  }
}

function readFirstJson(websocket: WebSocket): Promise<HelloMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("hello_timeout"));
    }, 10_000);
    websocket.once("message", (data, isBinary) => {
      clearTimeout(timer);
      if (isBinary) {
        reject(new Error("hello_not_json"));
        return;
      }
      try {
        const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
        resolve(JSON.parse(text) as HelloMessage);
      } catch {
        reject(new Error("hello_bad_json"));
      }
    });
  });
}

function connectRelay(ticket: string, fingerprint: string): Promise<TLSSocket> {
  const address = process.env.RELAY_ADDR ?? "127.0.0.1:8443";
  const [host, portText] = splitHostPort(address);
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port <= 0) {
    return Promise.reject(new Error("relay_addr_invalid"));
  }
  const insecure =
    process.env.RELAY_TLS_INSECURE === "1" ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1";
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: !insecure,
      },
      () => {
        try {
          socket.write(encodeRelayHello(ticket, "controller", fingerprint));
          resolve(socket);
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      },
    );
    socket.setTimeout(8_000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("relay_timeout"));
    });
    socket.on("error", reject);
  });
}

export function encodeRelayHello(ticket: string, role: string, fingerprint: string): Buffer {
  const body = JSON.stringify({ ticket, role, fingerprint });
  if (body.length > HELLO_LIMIT) {
    throw new Error("hello_too_large");
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, Buffer.from(body, "utf8")]);
}

export function takeFrame(buffer: Buffer): { frame: Buffer; rest: Buffer } | null {
  if (buffer.length < FRAME_HEADER_BYTES) return null;
  if (buffer.subarray(0, 4).toString("ascii") !== "RDS1") return null;
  if (buffer[4] !== 1) return null;
  const payloadLength = buffer.readUInt32BE(8);
  if (payloadLength > MAX_PAYLOAD_BYTES) return null;
  const total = FRAME_HEADER_BYTES + payloadLength;
  if (buffer.length < total) return null;
  return {
    frame: buffer.subarray(0, total),
    rest: buffer.subarray(total),
  };
}

function splitHostPort(address: string): [string, string] {
  const trimmed = address.trim();
  const index = trimmed.lastIndexOf(":");
  if (index <= 0) return [trimmed, ""];
  return [trimmed.slice(0, index), trimmed.slice(index + 1)];
}
