import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);

// The web forms send empty values for filters left on "All" (for example ?role=&q=).
// These once produced "Validation failed" in the admin Users and Bookings tabs.
describe("empty filter values are treated as not provided", () => {
  it("admin users and bookings lists work with blank filters", async () => {
    await makeUser("ADMIN", "admin@example.com");
    await makeProviderWithService("pro@example.com");
    const admin = await login("admin@example.com");

    const users = await admin.get("/api/admin/users?q=&role=");
    expect(users.status).toBe(200);
    expect(users.body.users.length).toBe(2);

    const bookings = await admin.get("/api/admin/bookings?status=");
    expect(bookings.status).toBe(200);
    expect(bookings.body.bookings).toEqual([]);
  });

  it("real filter values still work and bad ones are still rejected", async () => {
    await makeUser("ADMIN", "admin@example.com");
    await makeUser("CUSTOMER", "c@example.com");
    const admin = await login("admin@example.com");

    const onlyCustomers = await admin.get("/api/admin/users?role=CUSTOMER");
    expect(onlyCustomers.status).toBe(200);
    expect(onlyCustomers.body.users).toHaveLength(1);

    expect((await admin.get("/api/admin/users?role=NOPE")).status).toBe(400);
    expect((await admin.get("/api/admin/bookings?status=NOPE")).status).toBe(400);
  });

  it("public service search ignores blank filters", async () => {
    const s = await makeProviderWithService("pro@example.com");
    const res = await request(app).get(
      "/api/services?q=&categoryId=&postcode=&minPrice=&maxPrice=&date=&sort=newest",
    );
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([s.service.id]);
  });
});
