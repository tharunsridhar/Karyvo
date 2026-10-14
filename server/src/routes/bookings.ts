import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { intParam, parse, wrap } from "../lib/http.js";
import { me, requireAuth } from "../middleware/auth.js";
import { createBooking, createReview, expireStale, transitionBooking } from "../services/bookingService.js";

const include = {
  service: { select: { id: true, title: true } },
  customer: { select: { id: true, name: true } },
  provider: { select: { id: true, timezone: true, user: { select: { name: true } } } },
  review: { select: { id: true, rating: true, text: true, hidden: true } },
} as const;

export function bookingsRouter() {
  const r = Router();
  r.use(requireAuth);

  r.post(
    "/",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          serviceId: z.number().int().positive(),
          startAt: z.string().datetime({ offset: true }),
          notes: z.string().trim().max(500).default(""),
        }),
        req.body,
      );
      const key = req.header("Idempotency-Key")?.trim();
      if (key && (key.length < 8 || key.length > 100)) {
        res
          .status(400)
          .json({ error: { code: "BAD_REQUEST", message: "Idempotency-Key must be 8-100 chars" } });
        return;
      }
      const { booking, replay } = await createBooking({
        customerId: me(req).id,
        serviceId: body.serviceId,
        startAt: new Date(body.startAt),
        notes: body.notes,
        idempotencyKey: key,
      });
      res
        .status(replay ? 200 : 201)
        .set("Idempotent-Replay", String(replay))
        .json({ booking });
    }),
  );

  // Bookings the caller is part of, either as customer or as the provider.
  r.get(
    "/",
    wrap(async (req, res) => {
      await expireStale();
      const user = me(req);
      const status = parse(z.object({ status: z.string().optional() }), req.query).status;
      const bookings = await prisma.booking.findMany({
        where: {
          ...(user.role === "PROVIDER" ? { provider: { userId: user.id } } : { customerId: user.id }),
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { startAt: "desc" },
        include,
        take: 200,
      });
      res.json({ bookings });
    }),
  );

  r.get(
    "/:id",
    wrap(async (req, res) => {
      const user = me(req);
      const b = await prisma.booking.findUnique({
        where: { id: intParam(req) },
        include: {
          ...include,
          history: { orderBy: { createdAt: "asc" } },
          provider: { select: { id: true, userId: true, timezone: true, user: { select: { name: true } } } },
        },
      });
      // Unrelated users get 404, not 403, so booking ids cannot be probed.
      if (!b) throw notFound("Booking not found");
      const allowed = user.role === "ADMIN" || b.customerId === user.id || b.provider.userId === user.id;
      if (!allowed) throw notFound("Booking not found");
      res.json({ booking: b });
    }),
  );

  r.post(
    "/:id/transition",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          action: z.enum(["accept", "decline", "cancel", "start", "complete"]),
          note: z.string().trim().max(300).optional(),
        }),
        req.body,
      );
      const user = me(req);
      const booking = await transitionBooking({
        bookingId: intParam(req),
        user: { id: user.id, role: user.role },
        action: body.action,
        note: body.note,
      });
      res.json({ booking });
    }),
  );

  r.post(
    "/:id/review",
    wrap(async (req, res) => {
      const body = parse(
        z.object({
          rating: z.number().int().min(1).max(5),
          text: z.string().trim().max(1000).default(""),
        }),
        req.body,
      );
      const review = await createReview({ bookingId: intParam(req), userId: me(req).id, ...body });
      res.status(201).json({ review });
    }),
  );

  return r;
}

export function notificationsRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get(
    "/",
    wrap(async (req, res) => {
      const user = me(req);
      const [notifications, unread] = await Promise.all([
        prisma.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.notification.count({ where: { userId: user.id, read: false } }),
      ]);
      res.json({ notifications, unread });
    }),
  );

  r.post(
    "/read-all",
    wrap(async (req, res) => {
      await prisma.notification.updateMany({
        where: { userId: me(req).id, read: false },
        data: { read: true },
      });
      res.status(204).end();
    }),
  );

  r.post(
    "/:id/read",
    wrap(async (req, res) => {
      const out = await prisma.notification.updateMany({
        where: { id: intParam(req), userId: me(req).id },
        data: { read: true },
      });
      if (out.count === 0) throw notFound("Notification not found");
      res.status(204).end();
    }),
  );

  return r;
}
