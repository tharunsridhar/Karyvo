import { Prisma, type Booking, type BookingStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound, AppError } from "../lib/errors.js";
import { computeSlots, isValidDate, localDate } from "../lib/slots.js";
import { BLOCKING, actorFor, checkTransition, type Action } from "../lib/stateMachine.js";

type Db = Prisma.TransactionClient;

interface Principal {
  id: number;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
}

async function notify(
  db: Db,
  userId: number,
  type: string,
  message: string,
  bookingId: number,
  eventKey: string,
) {
  // dedupeKey makes retried events harmless: the second insert is skipped.
  await db.notification.createMany({
    data: [{ userId, type, message, bookingId, dedupeKey: `${eventKey}:u${userId}` }],
    skipDuplicates: true,
  });
}

function fmt(d: Date, tz: string) {
  return DateTime.fromJSDate(d, { zone: tz }).toFormat("ccc d LLL, HH:mm");
}

export async function availableSlots(serviceId: number, date: string) {
  if (!isValidDate(date)) throw badRequest("date must be YYYY-MM-DD");
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { provider: { include: { user: true } } },
  });
  if (!service || !service.active || service.provider.user.status !== "ACTIVE") {
    throw notFound("Service not found");
  }
  const tz = service.provider.timezone;
  const dayStart = DateTime.fromISO(date, { zone: tz }).startOf("day");
  const [rules, exception, busy] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { providerId: service.providerId } }),
    prisma.availabilityException.findUnique({
      where: { providerId_date: { providerId: service.providerId, date } },
    }),
    prisma.booking.findMany({
      where: {
        providerId: service.providerId,
        status: { in: BLOCKING },
        startAt: { lt: dayStart.plus({ days: 2 }).toJSDate() },
        endAt: { gt: dayStart.minus({ days: 1 }).toJSDate() },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);
  const slots = computeSlots({
    date,
    timezone: tz,
    rules,
    exception,
    durationMin: service.durationMin,
    busy: busy.map((b) => ({ start: b.startAt, end: b.endAt })),
    now: new Date(),
    stepMin: config.slotStepMinutes,
  });
  return { service, timezone: tz, slots };
}

function isOverlapError(e: unknown) {
  const msg = String((e as Error)?.message ?? "");
  return msg.includes("booking_no_overlap") || msg.includes("23P01");
}

export async function createBooking(args: {
  customerId: number;
  serviceId: number;
  startAt: Date;
  notes: string;
  idempotencyKey?: string;
}): Promise<{ booking: Booking; replay: boolean }> {
  await expireStale();
  const { customerId, idempotencyKey } = args;

  const findReplay = async () =>
    idempotencyKey
      ? prisma.booking.findUnique({
          where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
        })
      : null;

  const existing = await findReplay();
  if (existing) return { booking: existing, replay: true };

  const now = new Date();
  if (args.startAt <= now) throw badRequest("Start time must be in the future");
  if (args.startAt.getTime() > now.getTime() + config.bookingHorizonDays * 86_400_000) {
    throw badRequest(`Bookings can be made up to ${config.bookingHorizonDays} days ahead`);
  }

  const svc = await prisma.service.findUnique({
    where: { id: args.serviceId },
    include: { provider: true },
  });
  if (!svc) throw notFound("Service not found");
  if (svc.provider.userId === customerId) throw badRequest("You cannot book your own service");

  // Server-side availability check. The frontend's slot list is never trusted.
  const date = localDate(args.startAt, svc.provider.timezone);
  const { slots } = await availableSlots(svc.id, date);
  if (!slots.some((s) => s.getTime() === args.startAt.getTime())) {
    throw conflict("That time slot is not available", "SLOT_UNAVAILABLE");
  }

  const endAt = new Date(args.startAt.getTime() + svc.durationMin * 60_000);
  try {
    // The exclusion constraint on Booking is the real guard: if a concurrent request
    // inserted an overlapping blocking booking first, this insert fails atomically.
    const booking = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.create({
        data: {
          customerId,
          providerId: svc.providerId,
          serviceId: svc.id,
          startAt: args.startAt,
          endAt,
          priceCents: svc.priceCents,
          currency: svc.currency,
          serviceTitle: svc.title,
          notes: args.notes,
          idempotencyKey,
        },
      });
      await tx.bookingStatusHistory.create({
        data: { bookingId: b.id, toStatus: "PENDING", actorId: customerId, note: "Booking requested" },
      });
      await notify(
        tx,
        svc.provider.userId,
        "BOOKING_REQUESTED",
        `New booking request for ${svc.title} on ${fmt(args.startAt, svc.provider.timezone)}`,
        b.id,
        `booking:${b.id}:created`,
      );
      await notify(
        tx,
        customerId,
        "BOOKING_CREATED",
        `Your request for ${svc.title} on ${fmt(args.startAt, svc.provider.timezone)} was sent`,
        b.id,
        `booking:${b.id}:created`,
      );
      return b;
    });
    return { booking, replay: false };
  } catch (e) {
    if (isOverlapError(e)) throw conflict("That time slot was just taken", "SLOT_TAKEN");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await findReplay();
      if (again) return { booking: again, replay: true };
    }
    throw e;
  }
}

export async function transitionBooking(args: {
  bookingId: number;
  user: Principal | "system";
  action: Action;
  note?: string;
}): Promise<Booking> {
  const { bookingId, user, action } = args;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { provider: true, service: true },
  });
  if (!booking) throw notFound("Booking not found");

  let actor;
  if (user === "system") actor = "system" as const;
  else {
    const isProvider = booking.provider.userId === user.id;
    const isCustomer = booking.customerId === user.id;
    if (user.role !== "ADMIN" && !isProvider && !isCustomer) throw notFound("Booking not found");
    actor = actorFor(user.role, isProvider);
    if (actor === "customer" && !isCustomer) throw notFound("Booking not found");
  }
  if (!actor) throw forbidden();

  const result = checkTransition({
    action,
    from: booking.status,
    actor,
    startAt: booking.startAt,
    now: new Date(),
    cutoffHours: config.cancelCutoffHours,
  });
  if (!result.ok) {
    if (result.reason === "not_allowed") throw forbidden(`You cannot ${action} this booking`);
    if (result.reason === "cutoff") {
      throw new AppError(
        409,
        "CANCEL_CUTOFF",
        `Accepted bookings cannot be cancelled within ${config.cancelCutoffHours} hours of the start time`,
      );
    }
    throw conflict(`Cannot ${action} a booking that is ${booking.status}`, "INVALID_TRANSITION");
  }

  const tz = booking.provider.timezone;
  const userId = user === "system" ? null : user.id;
  return prisma.$transaction(async (tx) => {
    // Compare-and-set on the old status so two racing transitions cannot both win.
    const res = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: { status: result.to },
    });
    if (res.count === 0) throw conflict("Booking was changed by someone else", "STALE_STATUS");
    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        fromStatus: booking.status,
        toStatus: result.to,
        actorId: userId,
        note: args.note ?? (actor === "system" ? "Expired automatically" : ""),
      },
    });

    const when = fmt(booking.startAt, tz);
    const title = booking.serviceTitle;
    const key = `booking:${bookingId}:${result.to}`;
    const toCustomer: Partial<Record<BookingStatus, string>> = {
      ACCEPTED: `Your booking for ${title} on ${when} was accepted`,
      DECLINED: `Your booking for ${title} on ${when} was declined`,
      EXPIRED: `Your request for ${title} on ${when} expired without a response`,
      IN_PROGRESS: `Your ${title} job has started`,
      COMPLETED: `Your ${title} job is complete. You can now leave a review`,
    };
    if (result.to === "CANCELLED") {
      if (actor !== "customer") {
        await notify(
          tx,
          booking.customerId,
          "BOOKING_CANCELLED",
          `Your booking for ${title} on ${when} was cancelled`,
          bookingId,
          key,
        );
      }
      if (actor !== "provider") {
        await notify(
          tx,
          booking.provider.userId,
          "BOOKING_CANCELLED",
          `Booking for ${title} on ${when} was cancelled`,
          bookingId,
          key,
        );
      }
    } else if (toCustomer[result.to]) {
      await notify(tx, booking.customerId, `BOOKING_${result.to}`, toCustomer[result.to]!, bookingId, key);
    }
    if (result.to === "EXPIRED") {
      await notify(
        tx,
        booking.provider.userId,
        "BOOKING_EXPIRED",
        `Request for ${title} on ${when} expired`,
        bookingId,
        key,
      );
    }
    return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  });
}

/**
 * Pending requests reserve their slot (they are blocking) but only temporarily:
 * they expire after PENDING_TTL_MINUTES or once the start time has passed.
 */
export async function expireStale(): Promise<number> {
  const cutoff = new Date(Date.now() - config.pendingTtlMinutes * 60_000);
  const stale = await prisma.booking.findMany({
    where: { status: "PENDING", OR: [{ createdAt: { lt: cutoff } }, { startAt: { lte: new Date() } }] },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of stale) {
    try {
      await transitionBooking({ bookingId: id, user: "system", action: "expire" });
      n++;
    } catch {
      // another worker got there first; fine
    }
  }
  return n;
}

export async function createReview(args: {
  bookingId: number;
  userId: number;
  rating: number;
  text: string;
}) {
  const booking = await prisma.booking.findUnique({ where: { id: args.bookingId } });
  if (!booking || booking.customerId !== args.userId) throw notFound("Booking not found");
  if (booking.status !== "COMPLETED") {
    throw conflict("Only completed bookings can be reviewed", "NOT_REVIEWABLE");
  }
  try {
    return await prisma.review.create({
      data: {
        bookingId: booking.id,
        customerId: args.userId,
        providerId: booking.providerId,
        rating: args.rating,
        text: args.text,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("This booking has already been reviewed", "ALREADY_REVIEWED");
    }
    throw e;
  }
}
