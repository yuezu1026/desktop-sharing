import { Pool } from "pg";
import { AccountService } from "./account-service.js";
import { loadConfig } from "./config.js";
import { OrderService } from "./order-service.js";
import { createHttpServer } from "./server.js";
import { SessionService } from "./session-service.js";

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  await waitForDatabase(pool);
  const service = new AccountService(pool, config, () => new Date());
  const sessions = new SessionService(pool, config, service, () => new Date());
  const orders = new OrderService(pool, config, service, () => new Date());
  await service.applySchema();
  const timer = setInterval(() => {
    void service.runMaintenance();
  }, MAINTENANCE_INTERVAL_MS);
  timer.unref();

  const server = createHttpServer(pool, config, service, sessions, orders);
  server.listen(config.port, "0.0.0.0");
}

async function waitForDatabase(pool: Pool): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("database unavailable");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "startup failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
