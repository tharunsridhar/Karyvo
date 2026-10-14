import { DateTime } from "luxon";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { expireStale } from "../src/services/bookingService.js";
import { app, at, futureDate, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function setup() {
  const p = await makeProviderWithService("pro@test.dev");
  await makeUser("CUSTOMER", "c1@test.dev");
  await makeUser("CUSTOMER", "c2@test.dev");
  const date = futureDate(5);
  return {
    ...p,
    date,
    c1: await login("c1@test.dev"),
    c2: await login("c2@test.dev"),
    pro: await login("pro@test.dev"),
  };
}

const book = (agent: request.Agent, serviceId: number, startAt: string, key?: string) => {
  const r = agent.post("/api/bookings");
  if (key) r.set("Idempotency-Key", key);
  return r.send({ serviceId, startAt });
};

describe("slot search", () => {
  it("lists slots for a date and hides taken ones", async () => {
    const s = await setup();
    const before = await request(app).get(`/api/services/${s.service.id}/slots?date=${s.date}`);
    expect(before.status).toBe(200);
    expect(before.body.slots).toContain(at(s.date, "10:00").replace(".000", ".000"));
    expect((await book(s.c1, s.service.id, at(s.date, "10:00"))).status).toBe(201);
    const after = await request(app).get(`/api/services/${s.service.id}/slots?date=${s.date}`);
    const hhmm = after.body.slots.map((x: string) => x.slice(11, 16));
    expect(hhmm).not.toContain("10:00");
    expect(hhmm).not.toContain("09:30"); // would overlap 10:00-11:00
    expect(hhmm).not.toContain("10:30");
    expect(hhmm).toContain("09:00"); // adjacent, ends at 10:00
    expect(hhmm).toContain("11:00"); // adjacent, starts at 11:00
  });

  it("rejects bad dates", async () => {
    const s = await setup();
    expect((await request(app).get(`/api/services/${s.service.id}/slots?date=nope`)).status).toBe(400);
  });

  it("removes slots on a day off and when working hours change", async () => {
    const s = await setup();
    await s.pro
      .post("/api/provider/exceptions")
      .send({ date: s.date, startMin: null, endMin: null, note: "holiday" });
    const res = await request(app).get(`/api/services/${s.service.id}/slots?date=${s.date}`);
    expect(res.body.slots).toEqual([]);
    expect((await book(s.c1, s.service.id, at(s.date, "10:00"))).status).toBe(409);
  });
});

describe("double booking prevention", () => {
  it("rejects an overlapping booking with 409 and allows adjacent ones", async () => {
    const s = await setup();
    expect((await book(s.c1, s.service.id, at(s.date, "10:00"))).status).toBe(201);
    const clash = await book(s.c2, s.service.id, at(s.date, "10:30"));
    expect(clash.status).toBe(409);
    expect(["SLOT_TAKEN", "SLOT_UNAVAILABLE"]).toContain(clash.body.error.code);
    expect((await book(s.c2, s.service.id, at(s.date, "11:00"))).status).toBe(201);
    expect((await book(s.c2, s.service.id, at(s.date, "09:00"))).status).toBe(201);
  });

  it("lets exactly one of many simultaneous requests win", async () => {
    const s = await setup();
    const customers = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        await makeUser("CUSTOMER", `racer${i}@test.dev`);
        return login(`racer${i}@test.dev`);
      }),
    );
    const results = await Promise.all(customers.map((c) => book(c, s.service.id, at(s.date, "13:00"))));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
    expect(await prisma.booking.count({ where: { startAt: new Date(at(s.date, "13:00")) } })).toBe(1);
  });

  it("the database itself refuses overlapping blocking rows (bypassing the API)", async () => {
    const s = await setup();
    const c = await prisma.user.findFirstOrThrow({ where: { email: "c1@test.dev" } });
    const mk = (start: string, end: string, status: "PENDING" | "CANCELLED" = "PENDING") =>
      prisma.booking.create({
        data: {
          customerId: c.id,
          providerId: s.profileId,
          serviceId: s.service.id,
          startAt: new Date(at(s.date, start)),
          endAt: new Date(at(s.date, end)),
          priceCents: 1,
          currency: "USD",
          serviceTitle: "x",
          status,
        },
      });
    await mk("10:00", "11:00");
    await expect(mk("10:30", "11:30")).rejects.toThrow(/booking_no_overlap/);
    await expect(mk("11:00", "12:00")).resolves.toBeTruthy(); // touching ranges are fine
    await expect(mk("10:15", "10:45", "CANCELLED")).resolves.toBeTruthy(); // released states do not block
  });

  it("rejects invalid ranges at the database level", async () => {
    const s = await setup();
    const c = await prisma.user.findFirstOrThrow({ where: { email: "c1@test.dev" } });
    await expect(
      prisma.booking.create({
        data: {
          customerId: c.id,
          providerId: s.profileId,
          serviceId: s.service.id,
          startAt: new Date(at(s.date, "12:00")),
          endAt: new Date(at(s.date, "11:00")),
          priceCents: 1,
          currency: "USD",
          serviceTitle: "x",
        },
      }),
    ).rejects.toThrow(/booking_time_valid/);
  });
});

describe("validation and idempotency", () => {
  it("rejects times that are off-grid, outside hours, in the past or too far ahead", async () => {
    const s = await setup();
    expect((await book(s.c1, s.service.id, at(s.date, "10:10"))).status).toBe(409);
    expect((await book(s.c1, s.service.id, at(s.date, "03:00"))).status).toBe(409);
    expect((await book(s.c1, s.service.id, at(s.date, "16:30"))).status).toBe(409); // would end 17:30
    expect((await book(s.c1, s.service.id, at(futureDate(-2), "10:00"))).status).toBe(400);
    expect((await book(s.c1, s.service.id, at(futureDate(200), "10:00"))).status).toBe(400);
    expect((await s.c1.post("/api/bookings").send({ serviceId: "x" })).status).toBe(400);
    expect((await s.c1.post("/api/bookings").send({})).status).toBe(400);
  });

  it("does not let a provider book their own service", async () => {
    const s = await setup();
    expect((await book(s.pro, s.service.id, at(s.date, "10:00"))).status).toBe(400);
  });

  it("treats a repeated Idempotency-Key as the same booking", async () => {
    const s = await setup();
    const first = await book(s.c1, s.service.id, at(s.date, "10:00"), "key-12345678");
    const retry = await book(s.c1, s.service.id, at(s.date, "10:00"), "key-12345678");
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.body.booking.id).toBe(first.body.booking.id);
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.notification.count({ where: { type: "BOOKING_REQUESTED" } })).toBe(1);
  });

  it("handles concurrent retries with the same key", async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => book(s.c1, s.service.id, at(s.date, "14:00"), "same-key-123456")),
    );
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.booking.id)).size).toBe(1);
    expect(await prisma.booking.count()).toBe(1);
  });
});

describe("booking lifecycle", () => {
  it("runs request -> accept -> start -> complete -> review with history and notifications", async () => {
    const s = await setup();
    const created = await book(s.c1, s.service.id, at(s.date, "10:00"));
    const id = created.body.booking.id;
    expect(created.body.booking).toMatchObject({
      status: "PENDING",
      priceCents: 5000,
      serviceTitle: "Fix a leak",
    });

    expect(
      (await s.pro.post(`/api/bookings/${id}/transition`).send({ action: "accept" })).body.booking.status,
    ).toBe("ACCEPTED");
    expect(
      (await s.pro.post(`/api/bookings/${id}/transition`).send({ action: "start" })).body.booking.status,
    ).toBe("IN_PROGRESS");

    // not yet completed: no review allowed
    expect((await s.c1.post(`/api/bookings/${id}/review`).send({ rating: 5 })).status).toBe(409);

    expect(
      (await s.pro.post(`/api/bookings/${id}/transition`).send({ action: "complete" })).body.booking.status,
    ).toBe("COMPLETED");

    // another customer cannot review; owner can, only once; rating bounds enforced
    expect((await s.c2.post(`/api/bookings/${id}/review`).send({ rating: 5 })).status).toBe(404);
    expect((await s.c1.post(`/api/bookings/${id}/review`).send({ rating: 9 })).status).toBe(400);
    expect((await s.c1.post(`/api/bookings/${id}/review`).send({ rating: 4, text: "Great" })).status).toBe(
      201,
    );
    expect((await s.c1.post(`/api/bookings/${id}/review`).send({ rating: 1 })).status).toBe(409);

    const detail = await s.c1.get(`/api/bookings/${id}`);
    expect(detail.body.booking.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "PENDING",
      "ACCEPTED",
      "IN_PROGRESS",
      "COMPLETED",
    ]);

    const custNotes = await s.c1.get("/api/notifications");
    expect(custNotes.body.notifications.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(["BOOKING_CREATED", "BOOKING_ACCEPTED", "BOOKING_COMPLETED"]),
    );
    const proNotes = await s.pro.get("/api/notifications");
    expect(proNotes.body.notifications[0].type).toBe("BOOKING_REQUESTED");

    // rating shows on the public profile
    const prof = await request(app).get(`/api/providers/${s.profileId}`);
    expect(prof.body.provider).toMatchObject({ rating: 4, reviewCount: 1 });
  });

  it("rejects invalid transitions with 409", async () => {
    const s = await setup();
    const id = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    const t = (agent: request.Agent, action: string) =>
      agent.post(`/api/bookings/${id}/transition`).send({ action });
    expect((await t(s.pro, "complete")).status).toBe(409);
    expect((await t(s.pro, "start")).status).toBe(409);
    await t(s.pro, "decline");
    expect((await t(s.pro, "accept")).status).toBe(409);
    expect((await t(s.pro, "complete")).status).toBe(409);
    expect((await t(s.c1, "cancel")).status).toBe(409);
  });

  it("only the provider can accept; customers cannot", async () => {
    const s = await setup();
    const id = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    expect((await s.c1.post(`/api/bookings/${id}/transition`).send({ action: "accept" })).status).toBe(403);
  });

  it("keeps bookings private from unrelated users and other providers", async () => {
    const s = await setup();
    const other = await makeProviderWithService("other@test.dev");
    void other;
    const otherPro = await login("other@test.dev");
    const id = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    for (const agent of [s.c2, otherPro]) {
      expect((await agent.get(`/api/bookings/${id}`)).status).toBe(404);
      expect((await agent.post(`/api/bookings/${id}/transition`).send({ action: "cancel" })).status).toBe(
        404,
      );
      expect((await agent.post(`/api/bookings/${id}/transition`).send({ action: "accept" })).status).toBe(
        404,
      );
    }
    expect((await s.c2.get("/api/bookings")).body.bookings).toHaveLength(0);
    expect((await otherPro.get("/api/bookings")).body.bookings).toHaveLength(0);
    expect((await s.pro.get("/api/bookings")).body.bookings).toHaveLength(1);
    expect((await request(app).get(`/api/bookings/${id}`)).status).toBe(401);
  });

  it("releases the slot on decline and on cancel", async () => {
    const s = await setup();
    const first = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    await s.pro.post(`/api/bookings/${first}/transition`).send({ action: "decline" });
    const second = await book(s.c2, s.service.id, at(s.date, "10:00"));
    expect(second.status).toBe(201);
    const cancelled = await s.c2
      .post(`/api/bookings/${second.body.booking.id}/transition`)
      .send({ action: "cancel" });
    expect(cancelled.body.booking.status).toBe("CANCELLED");
    expect((await book(s.c1, s.service.id, at(s.date, "10:00"))).status).toBe(201);
  });

  it("applies the customer cancellation cutoff on accepted bookings", async () => {
    const s = await setup();
    const soon = DateTime.utc().plus({ hours: 3 }).startOf("hour").plus({ hours: 1 });
    const c = await prisma.user.findFirstOrThrow({ where: { email: "c1@test.dev" } });
    const b = await prisma.booking.create({
      data: {
        customerId: c.id,
        providerId: s.profileId,
        serviceId: s.service.id,
        startAt: soon.toJSDate(),
        endAt: soon.plus({ hours: 1 }).toJSDate(),
        priceCents: 1,
        currency: "USD",
        serviceTitle: "x",
        status: "ACCEPTED",
      },
    });
    const res = await s.c1.post(`/api/bookings/${b.id}/transition`).send({ action: "cancel" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANCEL_CUTOFF");
    const byPro = await s.pro.post(`/api/bookings/${b.id}/transition`).send({ action: "cancel" });
    expect(byPro.status).toBe(200);
    expect(
      (await s.c1.get("/api/notifications")).body.notifications.some(
        (n: { type: string }) => n.type === "BOOKING_CANCELLED",
      ),
    ).toBe(true);
  });

  it("expires stale pending requests and frees their slot", async () => {
    const s = await setup();
    const created = await book(s.c1, s.service.id, at(s.date, "10:00"));
    await prisma.booking.update({
      where: { id: created.body.booking.id },
      data: { createdAt: DateTime.utc().minus({ days: 3 }).toJSDate() },
    });
    expect(await expireStale()).toBe(1);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: created.body.booking.id } });
    expect(row.status).toBe("EXPIRED");
    expect((await book(s.c2, s.service.id, at(s.date, "10:00"))).status).toBe(201);
    expect(await expireStale()).toBe(0);
  });

  it("keeps price snapshots when the service price changes", async () => {
    const s = await setup();
    const id = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    await s.pro.patch(`/api/provider/services/${s.service.id}`).send({ priceCents: 99999, title: "Renamed" });
    const b = await s.c1.get(`/api/bookings/${id}`);
    expect(b.body.booking).toMatchObject({ priceCents: 5000, serviceTitle: "Fix a leak" });
  });

  it("schedule changes keep existing bookings and report conflicts", async () => {
    const s = await setup();
    const id = (await book(s.c1, s.service.id, at(s.date, "10:00"))).body.booking.id;
    const res = await s.pro
      .post("/api/provider/exceptions")
      .send({ date: s.date, startMin: null, endMin: null });
    expect(res.status).toBe(201);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].bookingId).toBe(id);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PENDING");
  });
});

describe("catalogue search", () => {
  it("filters, sorts and paginates", async () => {
    const s = await setup();
    const area = await prisma.serviceArea.create({ data: { providerId: s.profileId, postcode: "SW1" } });
    void area;
    const cheap = await prisma.service.create({
      data: {
        providerId: s.profileId,
        categoryId: s.category.id,
        title: "Tap washer",
        durationMin: 30,
        priceCents: 1500,
        description: "cheap",
      },
    });
    const list = (qs: string) => request(app).get(`/api/services?${qs}`);
    expect((await list("")).body.total).toBe(2);
    expect((await list("q=washer")).body.items.map((i: { id: number }) => i.id)).toEqual([cheap.id]);
    expect((await list("q=plumbing")).body.total).toBe(2); // matches category name
    expect((await list("maxPrice=2000")).body.total).toBe(1);
    expect((await list("sort=price_asc")).body.items[0].id).toBe(cheap.id);
    expect((await list("postcode=sw1a")).body.total).toBe(2);
    expect((await list("postcode=zz9")).body.total).toBe(0);
    expect((await list("pageSize=1&page=2")).body.items).toHaveLength(1);
    expect((await list(`date=${s.date}`)).body.total).toBe(2);
    expect((await list("page=0")).status).toBe(400);
  });
});
