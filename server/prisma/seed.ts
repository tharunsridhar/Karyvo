import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "Password123!";

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const categories = ["Plumbing", "Electrical", "Cleaning", "Pest Control", "Gardening", "Painting"];
  const cats: Record<string, number> = {};
  for (const name of categories) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const c = await prisma.serviceCategory.upsert({ where: { slug }, update: {}, create: { name, slug } });
    cats[name] = c.id;
  }

  const upsertUser = (name: string, email: string, role: "CUSTOMER" | "PROVIDER" | "ADMIN") =>
    prisma.user.upsert({ where: { email }, update: {}, create: { name, email, role, passwordHash: hash } });

  await upsertUser("Admin User", "admin@karyvo.test", "ADMIN");
  const customer = await upsertUser("Casey Customer", "customer@karyvo.test", "CUSTOMER");
  await upsertUser("Sam Second", "customer2@karyvo.test", "CUSTOMER");

  const providers = [
    {
      name: "Priya Plumbing",
      email: "provider@karyvo.test",
      city: "Chennai",
      tz: "Asia/Kolkata",
      areas: ["600", "603"],
      bio: "Licensed plumber with 12 years of experience. Fast callouts, fixed pricing.",
      services: [
        ["Plumbing", "Leak repair", "Find and fix leaking pipes, taps and fittings.", 60, 85000],
        ["Plumbing", "Boiler service", "Annual boiler safety check and service.", 90, 120000],
      ],
    },
    {
      name: "Eli Electric",
      email: "provider2@karyvo.test",
      city: "Bengaluru",
      tz: "Asia/Kolkata",
      areas: ["560", "562"],
      bio: "Certified electrician for homes and small offices.",
      services: [
        ["Electrical", "Socket and switch install", "Install or replace sockets and switches.", 45, 60000],
        ["Electrical", "Fuse box inspection", "Full safety inspection of your consumer unit.", 120, 150000],
      ],
    },
    {
      name: "Clara Cleans",
      email: "provider3@karyvo.test",
      city: "Mumbai",
      tz: "Asia/Kolkata",
      areas: ["400", "401"],
      bio: "Eco-friendly home cleaning, supplies included.",
      services: [
        ["Cleaning", "Standard home clean", "Two cleaners, up to 3 rooms.", 120, 90000],
        ["Cleaning", "Deep clean", "Top to bottom deep clean.", 240, 180000],
        [
          "Pest Control",
          "Ant and cockroach treatment",
          "Safe treatment for common household pests.",
          60,
          110000,
        ],
      ],
    },
  ] as const;

  for (const p of providers) {
    const user = await upsertUser(p.name, p.email, "PROVIDER");
    const profile = await prisma.providerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, bio: p.bio, city: p.city, timezone: p.tz },
    });
    if ((await prisma.service.count({ where: { providerId: profile.id } })) === 0) {
      for (const [cat, title, description, durationMin, priceCents] of p.services) {
        await prisma.service.create({
          data: {
            providerId: profile.id,
            categoryId: cats[cat],
            title,
            description,
            durationMin,
            priceCents,
          },
        });
      }
      for (const postcode of p.areas) {
        await prisma.serviceArea.create({ data: { providerId: profile.id, postcode } });
      }
      // Mon-Fri 09:00-17:00, Sat 10:00-14:00
      for (let weekday = 1; weekday <= 5; weekday++) {
        await prisma.availabilityRule.create({
          data: { providerId: profile.id, weekday, startMin: 540, endMin: 1020 },
        });
      }
      await prisma.availabilityRule.create({
        data: { providerId: profile.id, weekday: 6, startMin: 600, endMin: 840 },
      });
    }
  }

  // One completed, reviewed booking in the past so ratings show up in the demo.
  const priya = await prisma.providerProfile.findFirstOrThrow({
    where: { user: { email: "provider@karyvo.test" } },
    include: { services: true },
  });
  if ((await prisma.booking.count({ where: { providerId: priya.id } })) === 0) {
    const svc = priya.services[0];
    const start = DateTime.now().minus({ days: 7 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const b = await prisma.booking.create({
      data: {
        customerId: customer.id,
        providerId: priya.id,
        serviceId: svc.id,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: svc.durationMin }).toJSDate(),
        priceCents: svc.priceCents,
        currency: svc.currency,
        serviceTitle: svc.title,
        status: "COMPLETED",
        history: {
          create: [
            { toStatus: "PENDING" },
            { fromStatus: "PENDING", toStatus: "ACCEPTED" },
            { fromStatus: "ACCEPTED", toStatus: "IN_PROGRESS" },
            { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED" },
          ],
        },
      },
    });
    await prisma.review.create({
      data: {
        bookingId: b.id,
        customerId: customer.id,
        providerId: priya.id,
        rating: 5,
        text: "Quick, tidy and fairly priced. Fixed the leak first time.",
      },
    });
  }

  console.log("Seed complete. Demo accounts (password: " + DEMO_PASSWORD + "):");
  console.log("  admin@karyvo.test, customer@karyvo.test, customer2@karyvo.test");
  console.log("  provider@karyvo.test, provider2@karyvo.test, provider3@karyvo.test");
}

main().finally(() => prisma.$disconnect());
