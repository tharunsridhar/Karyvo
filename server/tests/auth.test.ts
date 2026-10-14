import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { app, login, makeProviderWithService, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);

describe("authentication", () => {
  it("registers, stores a hashed password and sets an httpOnly cookie", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Ann", email: "ANN@example.com", password: "supersecret1" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "ann@example.com", role: "CUSTOMER" });
    expect(res.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "ann@example.com" } });
    expect(u.passwordHash).not.toContain("supersecret1");
    expect(u.passwordHash.startsWith("$2")).toBe(true);
  });

  it("creates a provider profile for provider registrations and rejects admin self-registration", async () => {
    const ok = await request(app).post("/api/auth/register").send({
      name: "Pat",
      email: "pat@example.com",
      password: "supersecret1",
      role: "PROVIDER",
      timezone: "Europe/London",
    });
    expect(ok.status).toBe(201);
    const p = await prisma.providerProfile.findFirst({ where: { user: { email: "pat@example.com" } } });
    expect(p?.timezone).toBe("Europe/London");

    const bad = await request(app)
      .post("/api/auth/register")
      .send({ name: "Evil", email: "evil@example.com", password: "supersecret1", role: "ADMIN" });
    expect(bad.status).toBe(400);
  });

  it("validates payloads", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(["name", "email", "password"]),
    );
    const badJson = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{oops");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe("BAD_JSON");
  });

  it("rejects duplicate emails", async () => {
    await makeUser("CUSTOMER", "dup@example.com");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Dup", email: "dup@example.com", password: "supersecret1" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("uses one generic error for wrong password and unknown email", async () => {
    await makeUser("CUSTOMER", "a@example.com");
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "wrongwrong" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "zzz@example.com", password: "wrongwrong" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it("logs out and rejects missing or tampered sessions", async () => {
    await makeUser("CUSTOMER", "a@example.com");
    const agent = await login("a@example.com");
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    const forged = await request(app).get("/api/auth/me").set("Cookie", "karyvo_token=garbage");
    expect(forged.status).toBe(401);
  });

  it("locks out a suspended user immediately, even with a valid cookie", async () => {
    const u = await makeUser("CUSTOMER", "a@example.com");
    const agent = await login("a@example.com");
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect((await agent.get("/api/auth/me")).status).toBe(403);
    const again = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "Password123!" });
    expect(again.status).toBe(403);
  });

  it("rate limits login attempts", async () => {
    const limited = createApp({ authRateMax: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        (await request(limited).post("/api/auth/login").send({ email: "x@example.com", password: "nope" }))
          .status,
      );
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it("returns a consistent error shape with a request id and no stack traces", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});

describe("authorization", () => {
  it("blocks role-restricted routes", async () => {
    await makeUser("CUSTOMER", "c@example.com");
    await makeUser("ADMIN", "admin@example.com");
    const c = await login("c@example.com");
    expect((await c.get("/api/admin/stats")).status).toBe(403);
    expect((await c.get("/api/provider/services")).status).toBe(403);
    expect((await request(app).get("/api/admin/stats")).status).toBe(401);
    const a = await login("admin@example.com");
    expect((await a.get("/api/admin/stats")).status).toBe(200);
  });

  it("stops a provider editing another provider's service", async () => {
    const one = await makeProviderWithService("one@example.com");
    await makeProviderWithService("two@example.com");
    const two = await login("two@example.com");
    const res = await two.patch(`/api/provider/services/${one.service.id}`).send({ title: "Hijacked" });
    expect(res.status).toBe(404);
    const after = await prisma.service.findUniqueOrThrow({ where: { id: one.service.id } });
    expect(after.title).toBe("Fix a leak");
  });

  it("lets a provider manage their own services", async () => {
    const one = await makeProviderWithService("one@example.com");
    const agent = await login("one@example.com");
    const off = await agent.patch(`/api/provider/services/${one.service.id}`).send({ active: false });
    expect(off.status).toBe(200);
    expect((await request(app).get(`/api/services/${one.service.id}`)).status).toBe(404);
    const bad = await agent
      .post("/api/provider/services")
      .send({ categoryId: one.category.id, title: "x", durationMin: 5, priceCents: -1 });
    expect(bad.status).toBe(400);
  });

  it("admin actions are audited and admins cannot suspend themselves", async () => {
    const admin = await makeUser("ADMIN", "admin@example.com");
    const victim = await makeUser("CUSTOMER", "v@example.com");
    const a = await login("admin@example.com");
    expect((await a.patch(`/api/admin/users/${victim.id}/status`).send({ status: "SUSPENDED" })).status).toBe(
      200,
    );
    expect((await a.patch(`/api/admin/users/${admin.id}/status`).send({ status: "SUSPENDED" })).status).toBe(
      403,
    );
    const logs = await prisma.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "USER_SUSPENDED", targetId: victim.id });
  });
});
