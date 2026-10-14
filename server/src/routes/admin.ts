import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { intParam, parse, wrap } from "../lib/http.js";
import { me, requireAuth, requireRole } from "../middleware/auth.js";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function audit(actorId: number, action: string, targetType: string, targetId: number, detail = "") {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, detail } });
}

export function adminRouter() {
  const r = Router();
  // Authorization is enforced here on the backend; the UI hiding admin links is only cosmetic.
  r.use(requireAuth, requireRole("ADMIN"));

  r.get(
    "/stats",
    wrap(async (_req, res) => {
      const [users, providers, services, bookings, pendingReports] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: "PROVIDER" } }),
        prisma.service.count(),
        prisma.booking.count(),
        prisma.report.count({ where: { resolved: false } }),
      ]);
      const byStatus = await prisma.booking.groupBy({ by: ["status"], _count: { _all: true } });
      res.json({
        users,
        providers,
        services,
        bookings,
        pendingReports,
        bookingsByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      });
    }),
  );

  r.get(
    "/users",
    wrap(async (req, res) => {
      const f = parse(
        z.object({
          q: z.string().trim().optional(),
          role: z.enum(["CUSTOMER", "PROVIDER", "ADMIN"]).optional(),
        }),
        req.query,
      );
      const users = await prisma.user.findMany({
        where: {
          role: f.role,
          ...(f.q
            ? {
                OR: [
                  { name: { contains: f.q, mode: "insensitive" } },
                  { email: { contains: f.q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
        orderBy: { id: "asc" },
        take: 200,
      });
      res.json({ users });
    }),
  );

  r.patch(
    "/users/:id/status",
    wrap(async (req, res) => {
      const { status } = parse(z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }), req.body);
      const id = intParam(req);
      const admin = me(req);
      if (id === admin.id) throw forbidden("You cannot change your own status");
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) throw notFound("User not found");
      const user = await prisma.user.update({
        where: { id },
        data: { status },
        select: { id: true, name: true, email: true, role: true, status: true },
      });
      await audit(
        admin.id,
        status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_ACTIVATED",
        "user",
        id,
        target.email,
      );
      res.json({ user });
    }),
  );

  const catSchema = z.object({ name: z.string().trim().min(2).max(60) });

  r.post(
    "/categories",
    wrap(async (req, res) => {
      const { name } = parse(catSchema, req.body);
      const slug = slugify(name);
      if (!slug) throw badRequest("Invalid name");
      if (await prisma.serviceCategory.findFirst({ where: { OR: [{ name }, { slug }] } })) {
        throw conflict("Category already exists", "CATEGORY_EXISTS");
      }
      const category = await prisma.serviceCategory.create({ data: { name, slug } });
      await audit(me(req).id, "CATEGORY_CREATED", "category", category.id, name);
      res.status(201).json({ category });
    }),
  );

  r.patch(
    "/categories/:id",
    wrap(async (req, res) => {
      const { name } = parse(catSchema, req.body);
      const id = intParam(req);
      if (!(await prisma.serviceCategory.findUnique({ where: { id } }))) throw notFound("Category not found");
      const category = await prisma.serviceCategory.update({
        where: { id },
        data: { name, slug: slugify(name) },
      });
      await audit(me(req).id, "CATEGORY_RENAMED", "category", id, name);
      res.json({ category });
    }),
  );

  r.delete(
    "/categories/:id",
    wrap(async (req, res) => {
      const id = intParam(req);
      if (await prisma.service.count({ where: { categoryId: id } })) {
        throw conflict("Category still has services", "CATEGORY_IN_USE");
      }
      const out = await prisma.serviceCategory.deleteMany({ where: { id } });
      if (!out.count) throw notFound("Category not found");
      await audit(me(req).id, "CATEGORY_DELETED", "category", id);
      res.status(204).end();
    }),
  );

  r.get(
    "/bookings",
    wrap(async (req, res) => {
      const { status } = parse(
        z.object({
          status: z
            .enum(["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "IN_PROGRESS", "COMPLETED", "EXPIRED"])
            .optional(),
        }),
        req.query,
      );
      const bookings = await prisma.booking.findMany({
        where: { status },
        orderBy: { id: "desc" },
        take: 200,
        include: {
          customer: { select: { id: true, name: true } },
          provider: { select: { id: true, user: { select: { name: true } } } },
        },
      });
      res.json({ bookings });
    }),
  );

  r.get(
    "/reviews",
    wrap(async (_req, res) => {
      const reviews = await prisma.review.findMany({
        orderBy: { id: "desc" },
        take: 200,
        include: { customer: { select: { name: true } } },
      });
      res.json({ reviews });
    }),
  );

  r.post(
    "/reviews/:id/hide",
    wrap(async (req, res) => {
      const { hidden, reason } = parse(
        z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).default("") }),
        req.body,
      );
      const id = intParam(req);
      if (!(await prisma.review.findUnique({ where: { id } }))) throw notFound("Review not found");
      const review = await prisma.review.update({ where: { id }, data: { hidden } });
      await audit(me(req).id, hidden ? "REVIEW_HIDDEN" : "REVIEW_RESTORED", "review", id, reason);
      res.json({ review });
    }),
  );

  r.get(
    "/reports",
    wrap(async (_req, res) => {
      const reports = await prisma.report.findMany({
        orderBy: [{ resolved: "asc" }, { id: "desc" }],
        take: 200,
        include: { reporter: { select: { name: true } } },
      });
      res.json({ reports });
    }),
  );

  r.post(
    "/reports/:id/resolve",
    wrap(async (req, res) => {
      const id = intParam(req);
      const out = await prisma.report.updateMany({ where: { id }, data: { resolved: true } });
      if (!out.count) throw notFound("Report not found");
      await audit(me(req).id, "REPORT_RESOLVED", "report", id);
      res.status(204).end();
    }),
  );

  r.get(
    "/audit-logs",
    wrap(async (_req, res) => {
      const logs = await prisma.auditLog.findMany({
        orderBy: { id: "desc" },
        take: 200,
        include: { actor: { select: { name: true } } },
      });
      res.json({ logs });
    }),
  );

  return r;
}
