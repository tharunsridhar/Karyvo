import path from "node:path";
import "dotenv/config";

const env = process.env;
const num = (v: string | undefined, d: number) =>
  v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d;

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
  // Free-tier protection (see README, "Free hosting limits")
  maxUsers: num(env.MAX_USERS, 300),
  maxBookings: num(env.MAX_BOOKINGS, 2000),
  maxServices: num(env.MAX_SERVICES, 300),
  dailyRequestBudget: num(env.DAILY_REQUEST_BUDGET, 60000),
  apiRateMax: num(env.API_RATE_MAX, 240),
  sweepIntervalSeconds: num(env.SWEEP_INTERVAL_SECONDS, 60),
  demoCleanupHours: num(env.DEMO_CLEANUP_HOURS, 0),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : "",
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error("JWT_SECRET must be set to at least 16 characters");
}
if (config.env === "production" && config.jwtSecret.startsWith("dev-only")) {
  throw new Error("Refusing to start in production with the development JWT_SECRET");
}
