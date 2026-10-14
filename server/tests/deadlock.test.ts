import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { at, futureDate, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

// PostgreSQL can abort one of several racing inserts as a deadlock victim. Prisma reports it as P2034.
const deadlock = () =>
  new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock", {
    code: "P2034",
    clientVersion: "test",
  });

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const s = await makeProviderWithService("pro@test.dev");
  await makeUser("CUSTOMER", "c@test.dev");
  return { s, c: await login("c@test.dev"), date: futureDate(5) };
}

describe("deadlock victims during concurrent bookings", () => {
  it("retries and still creates the booking when the slot is actually free", async () => {
    const { s, c, date } = await setup();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(deadlock());
    const res = await c.post("/api/bookings").send({ serviceId: s.service.id, startAt: at(date, "10:00") });
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await prisma.booking.count()).toBe(1);
  });

  it("answers 409 (not 500) when it keeps losing", async () => {
    const { s, c, date } = await setup();
    vi.spyOn(prisma, "$transaction").mockRejectedValue(deadlock());
    const res = await c.post("/api/bookings").send({ serviceId: s.service.id, startAt: at(date, "10:00") });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SLOT_BUSY");
  });

  it("returns the original booking if a retry of the same idempotency key already succeeded", async () => {
    const { s, c, date } = await setup();
    const key = "deadlock-key-12345";
    const first = await c
      .post("/api/bookings")
      .set("Idempotency-Key", key)
      .send({ serviceId: s.service.id, startAt: at(date, "10:00") });
    expect(first.status).toBe(201);
    vi.spyOn(prisma, "$transaction").mockRejectedValue(deadlock());
    const again = await c
      .post("/api/bookings")
      .set("Idempotency-Key", key)
      .send({ serviceId: s.service.id, startAt: at(date, "10:00") });
    expect(again.status).toBe(200);
    expect(again.body.booking.id).toBe(first.body.booking.id);
  });
});
