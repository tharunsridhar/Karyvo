import { createApp, logger } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { expireStale } from "./services/bookingService.js";

const app = createApp();
const server = app.listen(config.port, () => logger.info(`FixItBro API listening on :${config.port}`));

// Optional background sweep of expired pending requests. Reads also expire lazily, so on a
// free database set SWEEP_INTERVAL_SECONDS=0 to let it sleep when nobody is browsing.
const timer =
  config.sweepIntervalSeconds > 0
    ? setInterval(() => {
        expireStale().catch((err) => logger.error({ err: err.message }, "expiry sweep failed"));
      }, config.sweepIntervalSeconds * 1000)
    : null;

async function shutdown() {
  if (timer) clearInterval(timer);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
