/** 服务端配置。设备数默认对齐成本测算表，只从这里下发，不写进客户端。 */

export type AppConfig = {
  databaseUrl: string;
  port: number;
  deviceQuota: number;
  tokenTtlMinutes: number;
  smsDevExpose: boolean;
  /** 十进制 GB。成本测算表的权威单位是 GB，不按 1024 进位。 */
  freeRelayBytes: number;
  freeBitrateKbps: number;
  freeMaxFps: number;
  /** 分钟只是展示。折算地板见成本测算表，低于此档不把分钟写大。 */
  displayMinuteFloorKbps: number;
  ticketTtlSeconds: number;
  relaySharedSecret: string | null;
  signalSharedSecret: string | null;
  /** 通道数 / 每通道会话数尚未拍板。未设置就不拦截，禁止落成 1 和 2。 */
  channelLimit: number | null;
  sessionsPerChannel: number | null;
};

const DEFAULT_DEVICE_QUOTA = 150;
const DEFAULT_TOKEN_TTL_MINUTES = 20;
const DEFAULT_FREE_RELAY_BYTES = 2_000_000_000;
const DEFAULT_FREE_BITRATE_KBPS = 4000;
const DEFAULT_FREE_MAX_FPS = 30;
const DEFAULT_DISPLAY_MINUTE_FLOOR_KBPS = 2000;
const DEFAULT_TICKET_TTL_SECONDS = 90;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const port = readPositiveInt(env.PORT, 8080);
  const deviceQuota = readPositiveInt(env.DEVICE_QUOTA, DEFAULT_DEVICE_QUOTA);
  const tokenTtlMinutes = readPositiveInt(env.TOKEN_TTL_MINUTES, DEFAULT_TOKEN_TTL_MINUTES);
  const relaySharedSecret = env.RELAY_SHARED_SECRET?.trim() ?? "";
  const signalSharedSecret = env.SIGNAL_SHARED_SECRET?.trim() ?? "";
  return {
    databaseUrl,
    port,
    deviceQuota,
    tokenTtlMinutes,
    smsDevExpose: env.SMS_DEV_EXPOSE === "1",
    freeRelayBytes: readPositiveInt(env.FREE_RELAY_BYTES, DEFAULT_FREE_RELAY_BYTES),
    freeBitrateKbps: readPositiveInt(env.FREE_BITRATE_KBPS, DEFAULT_FREE_BITRATE_KBPS),
    freeMaxFps: readPositiveInt(env.FREE_MAX_FPS, DEFAULT_FREE_MAX_FPS),
    displayMinuteFloorKbps: readPositiveInt(env.DISPLAY_MINUTE_FLOOR_KBPS, DEFAULT_DISPLAY_MINUTE_FLOOR_KBPS),
    ticketTtlSeconds: readPositiveInt(env.TICKET_TTL_SECONDS, DEFAULT_TICKET_TTL_SECONDS),
    relaySharedSecret: relaySharedSecret.length > 0 ? relaySharedSecret : null,
    signalSharedSecret: signalSharedSecret.length > 0 ? signalSharedSecret : null,
    channelLimit: readOptionalPositiveInt(env.CHANNEL_LIMIT),
    sessionsPerChannel: readOptionalPositiveInt(env.SESSIONS_PER_CHANNEL),
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readOptionalPositiveInt(raw: string | undefined): number | null {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
