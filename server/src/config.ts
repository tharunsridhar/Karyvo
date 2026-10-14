import path from "node:path";
import "dotenv/config";

const env = process.env;

export const config = {
  env: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? "",
  jwtSecret: env.JWT_SECRET ?? "",
  corsOrigin: (env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  cookieSecure: env.COOKIE_SECURE === "true",
  pendingTtlMinutes: Number(env.PENDING_TTL_MINUTES ?? 1440),
  cancelCutoffHours: Number(env.CANCEL_CUTOFF_HOURS ?? 24),
  slotStepMinutes: 30,
  bookingHorizonDays: 90,
  authRateMax: Number(env.AUTH_RATE_MAX ?? 20),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : "",
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error("JWT_SECRET must be set to at least 16 characters");
}
if (config.env === "production" && config.jwtSecret.startsWith("dev-only")) {
  throw new Error("Refusing to start in production with the development JWT_SECRET");
}
