import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import {
  clearStatusCache,
  cleanupDemoData,
  resetBudgetForTests,
  resetCleanupTimerForTests,
} from "../src/services/demoGuard.js";
import { app, at, futureDate, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

const defaults = { ...config };

beforeEach(async () => {
  await resetDb();
  resetBudgetForTests();
  resetCleanupTimerForTests();
  clearStatusCache();
});

afterEach(() => {
  Object.assign(config, defaults);
});

const register = (email: string) =>
  request(app).post("/api/auth/register").send({ name: "Visitor", email, password: "supersecret1" });

describe("capacity caps", () => {
  it("refuses new accounts when the user cap is reached, but existing users can still sign in", async () => {
    await makeUser("CUSTOMER", "a@example.com");
    config.maxUsers = 2;
    expect((await register("b@example.com")).status).toBe(201);
    const full = await register("c@example.com");
    expect(full.status).toBe(503);
    expect(full.body.error.code).toBe("SERVER_FULL");
    expect(full.body.error.message).toMatch(/full/i);
    await login("a@example.com");
  });

  it("refuses new bookings when the booking cap is reached", async () => {
    const s = await makeProviderWithService("pro@test.dev");
    await makeUser("CUSTOMER", "c@test.dev");
    const c = await login("c@test.dev");
    const date = futureDate(5);
    config.maxBookings = 1;
    const book = (t: string) =>
      c.post("/api/bookings").send({ serviceId: s.service.id, startAt: at(date, t) });
    expect((await book("10:00")).status).toBe(201);
    const full = await book("13:00");
    expect(full.status).toBe(503);
    expect(full.body.error.code).toBe("SERVER_FULL");
  });

  it("refuses new services when the service cap is reached", async () => {
    const s = await makeProviderWithService("pro@test.dev");
    const pro = await login("pro@test.dev");
    config.maxServices = 1;
    const res = await pro
      .post("/api/provider/services")
      .send({ categoryId: s.category.id, title: "Another", durationMin: 30, priceCents: 100 });
    expect(res.status).toBe(503);
  });
});

describe("daily request budget", () => {
  it("stops answering API calls once the budget is spent, keeps /api/status available, with Retry-After", async () => {
    config.dailyRequestBudget = 3;
    for (let i = 0; i < 3; i++) expect((await request(app).get("/api/categories")).status).toBe(200);
    const blocked = await request(app).get("/api/categories");
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe("SERVER_FULL");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    const status = await request(app).get("/api/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ full: true, reason: "daily_budget" });
  });

  it("does not count the status endpoint or docs against the budget", async () => {
    config.dailyRequestBudget = 1;
    for (let i = 0; i < 5; i++) expect((await request(app).get("/api/status")).status).toBe(200);
    expect((await request(app).get("/api/categories")).status).toBe(200);
  });
});

describe("status endpoint", () => {
  it("reports usage and flags capacity when full", async () => {
    await makeUser("CUSTOMER", "a@example.com");
    const ok = await request(app).get("/api/status");
    expect(ok.body.full).toBe(false);
    expect(ok.body.usage.users).toEqual({ count: 1, max: config.maxUsers });
    config.maxUsers = 1;
    clearStatusCache();
    const full = await request(app).get("/api/status");
    expect(full.body).toMatchObject({ full: true, reason: "capacity" });
  });
});

describe("cleanup of visitor data", () => {
  const old = new Date(Date.now() - 48 * 3_600_000);

  it("removes old visitor accounts and their data, keeps demo accounts and recent visitors", async () => {
    const seedPro = await makeProviderWithService("provider@karyvo.test");
    const seedCustomer = await makeUser("CUSTOMER", "customer@karyvo.test");
    const visitorPro = await makeProviderWithService("visitorpro@example.com");
    const visitor = await makeUser("CUSTOMER", "visitor@example.com");
    const recent = await makeUser("CUSTOMER", "recent@example.com");
    await prisma.user.updateMany({
      where: {
        email: {
          in: [
            "provider@karyvo.test",
            "customer@karyvo.test",
            "visitorpro@example.com",
            "visitor@example.com",
          ],
        },
      },
      data: { createdAt: old },
    });

    const mk = (
      customerId: number,
      providerId: number,
      serviceId: number,
      hour: number,
      status: "COMPLETED" | "PENDING",
    ) =>
      prisma.booking.create({
        data: {
          customerId,
          providerId,
          serviceId,
          startAt: new Date(Date.UTC(2030, 0, 1, hour)),
          endAt: new Date(Date.UTC(2030, 0, 1, hour + 1)),
          priceCents: 1,
          currency: "INR",
          serviceTitle: "x",
          status,
        },
      });
    const b1 = await mk(visitor.id, seedPro.profileId, seedPro.service.id, 9, "COMPLETED");
    await prisma.review.create({
      data: { bookingId: b1.id, customerId: visitor.id, providerId: seedPro.profileId, rating: 5 },
    });
    await mk(seedCustomer.id, visitorPro.profileId, visitorPro.service.id, 11, "PENDING"); // seed user's booking with a visitor provider
    await mk(seedCustomer.id, seedPro.profileId, seedPro.service.id, 13, "PENDING"); // must survive

    expect(await cleanupDemoData(24)).toBe(2);

    const emails = (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email).sort();
    expect(emails).toEqual(["customer@karyvo.test", "provider@karyvo.test", "recent@example.com"]);
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.review.count()).toBe(0);
    expect(recent.id).toBeGreaterThan(0);
  });

  it("runs automatically from sign-ups when enabled, at most once an hour", async () => {
    await makeUser("CUSTOMER", "stale@example.com");
    await prisma.user.updateMany({ data: { createdAt: old } });
    config.demoCleanupHours = 24;
    expect((await register("new@example.com")).status).toBe(201);
    const emails = (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email);
    expect(emails).toEqual(["new@example.com"]);
  });

  it("does nothing when cleanup is disabled", async () => {
    await makeUser("CUSTOMER", "stale@example.com");
    await prisma.user.updateMany({ data: { createdAt: old } });
    expect((await register("new@example.com")).status).toBe(201);
    expect(await prisma.user.count()).toBe(2);
  });
});

describe("health check", () => {
  it("is light by default and checks the database only on request", async () => {
    const light = await request(app).get("/health");
    expect(light.body).toEqual({ status: "ok" });
    const deep = await request(app).get("/health?deep=1");
    expect(deep.body).toEqual({ status: "ok", db: "up" });
  });
});
