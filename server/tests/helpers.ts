import bcrypt from "bcryptjs";
import request from "supertest";
import { DateTime } from "luxon";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

export const app = createApp();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "User","ServiceCategory","AuditLog","Report" RESTART IDENTITY CASCADE`,
  );
}

export async function makeUser(role: "CUSTOMER" | "PROVIDER" | "ADMIN", email: string, name = email) {
  return prisma.user.create({
    data: {
      name,
      email,
      role,
      passwordHash: await bcrypt.hash("Password123!", 4),
      provider: role === "PROVIDER" ? { create: { timezone: "UTC", city: "Testville" } } : undefined,
    },
    include: { provider: true },
  });
}

export async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: "Password123!" });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** A provider with a 09:00-17:00 Mon-Sun UTC schedule and one service. */
export async function makeProviderWithService(email = "pro@test.dev", durationMin = 60) {
  const user = await makeUser("PROVIDER", email);
  const cat = await prisma.serviceCategory.upsert({
    where: { slug: "plumbing" },
    update: {},
    create: { name: "Plumbing", slug: "plumbing" },
  });
  const profileId = user.provider!.id;
  const service = await prisma.service.create({
    data: { providerId: profileId, categoryId: cat.id, title: "Fix a leak", durationMin, priceCents: 5000 },
  });
  for (let weekday = 1; weekday <= 7; weekday++) {
    await prisma.availabilityRule.create({
      data: { providerId: profileId, weekday, startMin: 540, endMin: 1020 },
    });
  }
  return { user, profileId, service, category: cat };
}

/** Date string `daysAhead` days from now in UTC. */
export function futureDate(daysAhead = 5) {
  return DateTime.utc().plus({ days: daysAhead }).toISODate() as string;
}

export function at(date: string, hhmm: string) {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: "utc" }).toISO() as string;
}
