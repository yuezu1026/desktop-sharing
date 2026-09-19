/** 服务端配置。设备数默认对齐成本测算表，只从这里下发，不写进客户端。 */

export type AppConfig = {
  databaseUrl: string;
  port: number;
  deviceQuota: number;
  tokenTtlMinutes: number;
  smsDevExpose: boolean;
};

const DEFAULT_DEVICE_QUOTA = 150;
const DEFAULT_TOKEN_TTL_MINUTES = 20;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const port = readPositiveInt(env.PORT, 8080);
  const deviceQuota = readPositiveInt(env.DEVICE_QUOTA, DEFAULT_DEVICE_QUOTA);
  const tokenTtlMinutes = readPositiveInt(env.TOKEN_TTL_MINUTES, DEFAULT_TOKEN_TTL_MINUTES);
  return {
    databaseUrl,
    port,
    deviceQuota,
    tokenTtlMinutes,
    smsDevExpose: env.SMS_DEV_EXPOSE === "1",
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
