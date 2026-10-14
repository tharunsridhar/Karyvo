import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";

/**
 * Protection for free hosting tiers. Three layers:
 * 1. Capacity caps (users, bookings, services) so the free database cannot fill up.
 * 2. A daily request budget so free compute and bandwidth cannot run out mid-month.
 * 3. Cleanup of visitor-created data after DEMO_CLEANUP_HOURS (demo accounts are kept).
 * When a limit is hit the API answers 503 SERVER_FULL with a friendly message.
 */

export const SEED_EMAIL_SUFFIX = "@mrfixmyhome.test";

const FULL_MESSAGE = "The demo server is full right now. Please try again in a while.";
const BUDGET_MESSAGE = "The demo server has reached its daily usage limit. Please come back tomorrow.";

const serverFull = (message: string, retryAfterSeconds?: number) => {
  const e = new AppError(503, "SERVER_FULL", message, retryAfterSeconds ? { retryAfterSeconds } : undefined);
  return e;
};

// ---- daily request budget (in memory, resets at UTC midnight or on restart) ----
let day = new Date().toISOString().slice(0, 10);
let requestsToday = 0;

export function resetBudgetForTests() {
  requestsToday = 0;
  day = new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    requestsToday = 0;
  }
}

export function budgetExhausted() {
  rollDay();
  return requestsToday >= config.dailyRequestBudget;
}

/** Counts API calls and refuses them once the daily budget is used. */
export function dailyBudget(req: Request, res: Response, next: NextFunction) {
  const exempt = req.path === "/status" || req.path.startsWith("/docs") || req.path === "/openapi.json";
  if (exempt) return next();
  rollDay();
  requestsToday++;
  if (requestsToday > config.dailyRequestBudget) {
    const wait = secondsUntilUtcMidnight();
    res.setHeader("Retry-After", String(wait));
    return next(serverFull(BUDGET_MESSAGE, wait));
  }
  next();
}

// ---- capacity ----
type Kind = "users" | "bookings" | "services";

const limits = (): Record<Kind, number> => ({
  users: config.maxUsers,
  bookings: config.maxBookings,
  services: config.maxServices,
});

async function counts(): Promise<Record<Kind, number>> {
  const [users, bookings, services] = await Promise.all([
    prisma.user.count(),
    prisma.booking.count(),
    prisma.service.count(),
  ]);
  return { users, bookings, services };
}

/** Throws 503 SERVER_FULL when creating one more row of this kind would exceed its cap. */
export async function assertCapacity(kind: Kind) {
  if (kind === "users") await cleanupIfDue();
  const c = await counts();
  if (c[kind] >= limits()[kind]) throw serverFull(FULL_MESSAGE);
}

let statusCache: {
  at: number;
  value: ReturnType<typeof buildStatus> extends Promise<infer T> ? T : never;
} | null = null;

async function buildStatus() {
  const c = await counts();
  const lim = limits();
  const full = (Object.keys(lim) as Kind[]).some((k) => c[k] >= lim[k]);
  const exhausted = budgetExhausted();
  return {
    full: full || exhausted,
    reason: exhausted ? ("daily_budget" as const) : full ? ("capacity" as const) : null,
    message: exhausted ? BUDGET_MESSAGE : full ? FULL_MESSAGE : null,
    usage: {
      users: { count: c.users, max: lim.users },
      bookings: { count: c.bookings, max: lim.bookings },
      services: { count: c.services, max: lim.services },
    },
  };
}

/** Cached for a minute so a busy front page does not keep a sleeping database awake. */
export async function getStatus() {
  if (!statusCache || Date.now() - statusCache.at > 60_000 || budgetExhausted()) {
    statusCache = { at: Date.now(), value: await buildStatus() };
  }
  return statusCache.value;
}

export function clearStatusCache() {
  statusCache = null;
}

// ---- cleanup of visitor-created data ----
let lastCleanup = 0;

/** Removes accounts created by visitors (not demo accounts) older than `hours`, with all their data. */
export async function cleanupDemoData(hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  const users = await prisma.user.findMany({
    where: { createdAt: { lt: cutoff }, NOT: { email: { endsWith: SEED_EMAIL_SUFFIX } } },
    select: { id: true },
  });
  if (users.length === 0) return 0;
  const ids = users.map((u) => u.id);
  const providers = await prisma.providerProfile.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const providerIds = providers.map((p) => p.id);

  await prisma.$transaction([
    prisma.report.deleteMany({ where: { reporterId: { in: ids } } }),
    prisma.review.deleteMany({
      where: { OR: [{ customerId: { in: ids } }, { providerId: { in: providerIds } }] },
    }),
    prisma.booking.deleteMany({
      where: { OR: [{ customerId: { in: ids } }, { providerId: { in: providerIds } }] },
    }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  clearStatusCache();
  return ids.length;
}

/** Runs at most once an hour, triggered by sign-ups, so it never wakes the database on its own. */
export async function cleanupIfDue() {
  if (config.demoCleanupHours <= 0) return;
  if (Date.now() - lastCleanup < 3_600_000) return;
  lastCleanup = Date.now();
  await cleanupDemoData(config.demoCleanupHours);
}

export function resetCleanupTimerForTests() {
  lastCleanup = 0;
}
