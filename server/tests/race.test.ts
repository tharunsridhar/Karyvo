import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { at, futureDate, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);

describe("heavy booking race", () => {
  it("20 simultaneous requests for one slot: exactly one wins, the rest get a fast clean 409", async () => {
    const s = await makeProviderWithService("pro@test.dev");
    const date = futureDate(5);
    const customers = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        await makeUser("CUSTOMER", `r${i}@test.dev`);
        return login(`r${i}@test.dev`);
      }),
    );

    const started = Date.now();
    const results = await Promise.all(
      customers.map((c) =>
        c.post("/api/bookings").send({ serviceId: s.service.id, startAt: at(date, "10:00") }),
      ),
    );
    const elapsed = Date.now() - started;

    const tally = results.map((r) => `${r.status}:${r.body?.error?.code ?? "ok"}`).sort();
    const wins = results.filter((r) => r.status === 201);
    const losses = results.filter((r) => r.status === 409);
    expect(wins, JSON.stringify(tally)).toHaveLength(1);
    expect(losses, JSON.stringify(tally)).toHaveLength(19);
    expect(await prisma.booking.count()).toBe(1);
    // Queued per provider, so no deadlock-detection stalls
    expect(elapsed).toBeLessThan(8000);
  });

  it("racing overlapping (not identical) slots still lets only compatible bookings through", async () => {
    const s = await makeProviderWithService("pro@test.dev");
    const date = futureDate(5);
    const times = ["10:00", "10:30", "11:00", "11:30", "10:00", "10:30", "11:00", "11:30"];
    const customers = await Promise.all(
      times.map(async (_, i) => {
        await makeUser("CUSTOMER", `o${i}@test.dev`);
        return login(`o${i}@test.dev`);
      }),
    );
    const results = await Promise.all(
      customers.map((c, i) =>
        c.post("/api/bookings").send({ serviceId: s.service.id, startAt: at(date, times[i]) }),
      ),
    );
    expect(
      results.every((r) => r.status === 201 || r.status === 409),
      JSON.stringify(results.map((r) => r.status)),
    ).toBe(true);

    // whatever succeeded must not overlap
    const rows = await prisma.booking.findMany({ orderBy: { startAt: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i].startAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].endAt.getTime());
  });
});
