import { createApp, logger } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { expireStale } from "./services/bookingService.js";

const app = createApp();
const server = app.listen(config.port, () => logger.info(`Karyvo API listening on :${config.port}`));

// Sweep expired pending requests once a minute. Reads also expire lazily, so this
// only keeps notifications timely when nobody is browsing.
const timer = setInterval(() => {
  expireStale().catch((err) => logger.error({ err: err.message }, "expiry sweep failed"));
}, 60_000);

async function shutdown() {
  clearInterval(timer);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
