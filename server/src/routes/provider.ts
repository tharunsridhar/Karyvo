import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { intParam, parse, wrap } from "../lib/http.js";
import { isValidDate, isValidTimezone } from "../lib/slots.js";
import { me, requireAuth, requireRole } from "../middleware/auth.js";

async function profileOf(userId: number) {
  const p = await prisma.providerProfile.findUnique({ where: { userId } });
  if (!p) throw notFound("Provider profile not found");
  return p;
}

/**
 * Schedule changes never touch existing bookings. Instead we report which active
 * future bookings fall outside the new hours so the provider can handle them.
 */
async function scheduleConflicts(providerId: number) {
  const [profile, rules, exceptions, bookings] = await Promise.all([
    prisma.providerProfile.findUniqueOrThrow({ where: { id: providerId } }),
    prisma.availabilityRule.findMany({ where: { providerId } }),
    prisma.availabilityException.findMany({ where: { providerId } }),
    prisma.booking.findMany({
      where: { providerId, status: { in: ["PENDING", "ACCEPTED"] }, startAt: { gt: new Date() } },
    }),
  ]);
  return bookings
    .filter((b) => {
      const s = DateTime.fromJSDate(b.startAt, { zone: profile.timezone });
      const e = DateTime.fromJSDate(b.endAt, { zone: profile.timezone });
      const sMin = s.hour * 60 + s.minute;
      const eMin = e.hour * 60 + e.minute + (e.day !== s.day ? 1440 : 0);
      const ex = exceptions.find((x) => x.date === s.toISODate());
      const windows = ex
        ? ex.startMin == null || ex.endMin == null
          ? []
          : [{ startMin: ex.startMin, endMin: ex.endMin }]
        : rules.filter((x) => x.weekday === s.weekday);
      return !windows.some((w) => sMin >= w.startMin && eMin <= w.endMin);
    })
    .map((b) => ({ bookingId: b.id, startAt: b.startAt }));
}

export function providerRouter() {
  const r = Router();
  r.use(requireAuth, requireRole("PROVIDER"));

  r.get(
    "/profile",
    wrap(async (req, res) => {
      const p = await prisma.providerProfile.findUniqueOrThrow({
        where: { userId: me(req).id },
        include: { areas: true },
      });
      res.json({ profile: { ...p, areas: p.areas.map((a) => a.postcode) } });
    }),
  );

  r.put(
    "/profile",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          bio: z.string().trim().max(1000),
          city: z.string().trim().max(80),
          timezone: z.string(),
          areas: z.array(z.string().trim().toUpperCase().min(1).max(10)).max(30),
        }),
        req.body,
      );
      if (!isValidTimezone(body.timezone)) throw badRequest("Unknown timezone");
      const p = await profileOf(me(req).id);
      await prisma.$transaction([
        prisma.providerProfile.update({
          where: { id: p.id },
          data: { bio: body.bio, city: body.city, timezone: body.timezone },
        }),
        prisma.serviceArea.deleteMany({ where: { providerId: p.id } }),
        prisma.serviceArea.createMany({
          data: [...new Set(body.areas)].map((postcode) => ({ providerId: p.id, postcode })),
        }),
      ]);
      res.json({ conflicts: await scheduleConflicts(p.id) });
    }),
  );

  const serviceSchema = z.object({
    categoryId: z.number().int().positive(),
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().max(1000).default(""),
    durationMin: z.number().int().min(15).max(480),
    priceCents: z.number().int().min(0).max(10_000_000),
    active: z.boolean().default(true),
  });

  r.get(
    "/services",
    wrap(async (req, res) => {
      const p = await profileOf(me(req).id);
      const services = await prisma.service.findMany({
        where: { providerId: p.id },
        include: { category: true },
        orderBy: { id: "desc" },
      });
      res.json({ services });
    }),
  );

  r.post(
    "/services",
    wrap(async (req, res) => {
      const body = parse(serviceSchema, req.body);
      const p = await profileOf(me(req).id);
      if (!(await prisma.serviceCategory.findUnique({ where: { id: body.categoryId } }))) {
        throw badRequest("Unknown category");
      }
      const service = await prisma.service.create({ data: { ...body, providerId: p.id } });
      res.status(201).json({ service });
    }),
  );

  r.patch(
    "/services/:id",
    wrap(async (req, res) => {
      const body = parse(serviceSchema.partial(), req.body);
      const p = await profileOf(me(req).id);
      const id = intParam(req);
      // Scoping the update by providerId means another provider's service looks like a 404.
      const found = await prisma.service.findFirst({ where: { id, providerId: p.id } });
      if (!found) throw notFound("Service not found");
      const service = await prisma.service.update({ where: { id }, data: body });
      res.json({ service });
    }),
  );

  r.get(
    "/availability",
    wrap(async (req, res) => {
      const p = await profileOf(me(req).id);
      const [rules, exceptions] = await Promise.all([
        prisma.availabilityRule.findMany({
          where: { providerId: p.id },
          orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
        }),
        prisma.availabilityException.findMany({ where: { providerId: p.id }, orderBy: { date: "asc" } }),
      ]);
      res.json({ timezone: p.timezone, rules, exceptions });
    }),
  );

  r.put(
    "/availability",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          rules: z
            .array(
              z.object({
                weekday: z.number().int().min(1).max(7),
                startMin: z.number().int().min(0).max(1439),
                endMin: z.number().int().min(1).max(1440),
              }),
            )
            .max(50),
        }),
        req.body,
      );
      for (const x of body.rules)
        if (x.endMin <= x.startMin) throw badRequest("End time must be after start time");
      const sorted = [...body.rules].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].startMin < sorted[i - 1].endMin) {
          throw badRequest("Working hours on the same day must not overlap");
        }
      }
      const p = await profileOf(me(req).id);
      await prisma.$transaction([
        prisma.availabilityRule.deleteMany({ where: { providerId: p.id } }),
        prisma.availabilityRule.createMany({ data: body.rules.map((x) => ({ ...x, providerId: p.id })) }),
      ]);
      res.json({ conflicts: await scheduleConflicts(p.id) });
    }),
  );

  r.post(
    "/exceptions",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          date: z.string(),
          startMin: z.number().int().min(0).max(1439).nullable().default(null),
          endMin: z.number().int().min(1).max(1440).nullable().default(null),
          note: z.string().trim().max(200).default(""),
        }),
        req.body,
      );
      if (!isValidDate(body.date)) throw badRequest("date must be YYYY-MM-DD");
      if ((body.startMin == null) !== (body.endMin == null))
        throw badRequest("Provide both start and end, or neither for a day off");
      if (body.startMin != null && body.endMin! <= body.startMin)
        throw badRequest("End time must be after start time");
      const p = await profileOf(me(req).id);
      const exception = await prisma.availabilityException.upsert({
        where: { providerId_date: { providerId: p.id, date: body.date } },
        create: { ...body, providerId: p.id },
        update: body,
      });
      res.status(201).json({ exception, conflicts: await scheduleConflicts(p.id) });
    }),
  );

  r.delete(
    "/exceptions/:id",
    wrap(async (req, res) => {
      const p = await profileOf(me(req).id);
      const out = await prisma.availabilityException.deleteMany({
        where: { id: intParam(req), providerId: p.id },
      });
      if (out.count === 0) throw notFound("Exception not found");
      res.status(204).end();
    }),
  );

  r.get(
    "/stats",
    wrap(async (req, res) => {
      const p = await profileOf(me(req).id);
      const [pending, upcoming, completed] = await Promise.all([
        prisma.booking.count({ where: { providerId: p.id, status: "PENDING" } }),
        prisma.booking.count({
          where: { providerId: p.id, status: "ACCEPTED", startAt: { gt: new Date() } },
        }),
        prisma.booking.count({ where: { providerId: p.id, status: "COMPLETED" } }),
      ]);
      res.json({ pending, upcoming, completed });
    }),
  );

  return r;
}
