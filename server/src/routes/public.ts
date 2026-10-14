import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { intParam, parse, stripBlank, wrap } from "../lib/http.js";
import { availableSlots, expireStale } from "../services/bookingService.js";
import { requireAuth, me } from "../middleware/auth.js";

async function ratingsFor(providerIds: number[]) {
  const rows = await prisma.review.groupBy({
    by: ["providerId"],
    where: { providerId: { in: providerIds }, hidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  });
  return new Map(
    rows.map((r) => [
      r.providerId,
      { rating: r._avg.rating ? Math.round(r._avg.rating * 10) / 10 : null, reviewCount: r._count.rating },
    ]),
  );
}

const listSchema = z.object({
  q: z.string().trim().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  postcode: z.string().trim().toUpperCase().optional(),
  minPrice: z.coerce.number().int().min(0).optional(), // cents
  maxPrice: z.coerce.number().int().min(0).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(9),
});

export function publicRouter() {
  const r = Router();

  r.get(
    "/categories",
    wrap(async (_req, res) => {
      const categories = await prisma.serviceCategory.findMany({ orderBy: { name: "asc" } });
      res.json({ categories });
    }),
  );

  r.get(
    "/services",
    wrap(async (req, res) => {
      const f = parse(listSchema, stripBlank(req.query));
      const services = await prisma.service.findMany({
        where: {
          active: true,
          provider: { user: { status: "ACTIVE" } },
          categoryId: f.categoryId,
          priceCents: { gte: f.minPrice, lte: f.maxPrice },
          ...(f.q
            ? {
                OR: [
                  { title: { contains: f.q, mode: "insensitive" } },
                  { description: { contains: f.q, mode: "insensitive" } },
                  { category: { name: { contains: f.q, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: { category: true, provider: { include: { user: true, areas: true } } },
      });
      const ratings = await ratingsFor([...new Set(services.map((s) => s.providerId))]);

      let rows = services.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        currency: s.currency,
        createdAt: s.createdAt,
        category: s.category,
        provider: {
          id: s.providerId,
          name: s.provider.user.name,
          city: s.provider.city,
          areas: s.provider.areas.map((a) => a.postcode),
          ...(ratings.get(s.providerId) ?? { rating: null, reviewCount: 0 }),
        },
      }));

      if (f.postcode) {
        rows = rows.filter((s) => s.provider.areas.some((a) => f.postcode!.startsWith(a)));
      }
      if (f.date) {
        const checked = await Promise.all(
          rows.slice(0, 200).map(async (s) => {
            try {
              return (await availableSlots(s.id, f.date!)).slots.length > 0 ? s : null;
            } catch {
              return null;
            }
          }),
        );
        rows = checked.filter((s): s is NonNullable<typeof s> => s !== null);
      }

      const cmp: Record<string, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
        newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        price_asc: (a, b) => a.priceCents - b.priceCents,
        price_desc: (a, b) => b.priceCents - a.priceCents,
        rating: (a, b) => (b.provider.rating ?? 0) - (a.provider.rating ?? 0),
      };
      rows.sort(cmp[f.sort]);

      const total = rows.length;
      const items = rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
      res.json({
        items,
        total,
        page: f.page,
        pageSize: f.pageSize,
        totalPages: Math.ceil(total / f.pageSize),
      });
    }),
  );

  r.get(
    "/services/:id",
    wrap(async (req, res) => {
      const s = await prisma.service.findUnique({
        where: { id: intParam(req) },
        include: { category: true, provider: { include: { user: true, areas: true } } },
      });
      if (!s || !s.active || s.provider.user.status !== "ACTIVE") throw notFound("Service not found");
      const ratings = await ratingsFor([s.providerId]);
      res.json({
        service: {
          id: s.id,
          title: s.title,
          description: s.description,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
          currency: s.currency,
          category: s.category,
          provider: {
            id: s.providerId,
            name: s.provider.user.name,
            city: s.provider.city,
            bio: s.provider.bio,
            timezone: s.provider.timezone,
            areas: s.provider.areas.map((a) => a.postcode),
            ...(ratings.get(s.providerId) ?? { rating: null, reviewCount: 0 }),
          },
        },
      });
    }),
  );

  r.get(
    "/services/:id/slots",
    wrap(async (req, res) => {
      const { date } = parse(z.object({ date: z.string() }), stripBlank(req.query));
      await expireStale();
      const out = await availableSlots(intParam(req), date);
      res.json({
        date,
        timezone: out.timezone,
        durationMin: out.service.durationMin,
        slots: out.slots.map((s) => s.toISOString()),
      });
    }),
  );

  r.get(
    "/providers/:id",
    wrap(async (req, res) => {
      const id = intParam(req);
      const p = await prisma.providerProfile.findUnique({
        where: { id },
        include: {
          user: true,
          areas: true,
          services: { where: { active: true }, include: { category: true } },
        },
      });
      if (!p || p.user.status !== "ACTIVE") throw notFound("Provider not found");
      const reviews = await prisma.review.findMany({
        where: { providerId: id, hidden: false },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { customer: { select: { name: true } } },
      });
      const ratings = await ratingsFor([id]);
      res.json({
        provider: {
          id: p.id,
          name: p.user.name,
          bio: p.bio,
          city: p.city,
          timezone: p.timezone,
          areas: p.areas.map((a) => a.postcode),
          services: p.services,
          ...(ratings.get(id) ?? { rating: null, reviewCount: 0 }),
        },
        reviews: reviews.map((v) => ({
          id: v.id,
          rating: v.rating,
          text: v.text,
          createdAt: v.createdAt,
          author: v.customer.name,
        })),
      });
    }),
  );

  r.post(
    "/reports",
    requireAuth,
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          targetType: z.enum(["service", "review"]),
          targetId: z.number().int().positive(),
          reason: z.string().trim().min(5).max(500),
        }),
        req.body,
      );
      const exists =
        body.targetType === "service"
          ? await prisma.service.findUnique({ where: { id: body.targetId } })
          : await prisma.review.findUnique({ where: { id: body.targetId } });
      if (!exists) throw notFound("Target not found");
      const report = await prisma.report.create({ data: { ...body, reporterId: me(req).id } });
      res.status(201).json({ report });
    }),
  );

  return r;
}
