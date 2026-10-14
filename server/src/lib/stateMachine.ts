import type { BookingStatus, Role } from "@prisma/client";

export type Action = "accept" | "decline" | "cancel" | "start" | "complete" | "expire";
export type Actor = "customer" | "provider" | "admin" | "system";

interface Transition {
  from: BookingStatus;
  to: BookingStatus;
  actors: Actor[];
}

const T: Record<Action, Transition[]> = {
  accept: [{ from: "PENDING", to: "ACCEPTED", actors: ["provider"] }],
  decline: [{ from: "PENDING", to: "DECLINED", actors: ["provider"] }],
  cancel: [
    { from: "PENDING", to: "CANCELLED", actors: ["customer", "provider", "admin"] },
    { from: "ACCEPTED", to: "CANCELLED", actors: ["customer", "provider", "admin"] },
  ],
  start: [{ from: "ACCEPTED", to: "IN_PROGRESS", actors: ["provider"] }],
  complete: [{ from: "IN_PROGRESS", to: "COMPLETED", actors: ["provider"] }],
  expire: [{ from: "PENDING", to: "EXPIRED", actors: ["system"] }],
};

export const BLOCKING: BookingStatus[] = ["PENDING", "ACCEPTED", "IN_PROGRESS"];

export type TransitionResult =
  { ok: true; to: BookingStatus } | { ok: false; reason: "invalid_transition" | "not_allowed" | "cutoff" };

/** Pure transition check. Cutoff applies only to customers cancelling an accepted booking. */
export function checkTransition(args: {
  action: Action;
  from: BookingStatus;
  actor: Actor;
  startAt: Date;
  now: Date;
  cutoffHours: number;
}): TransitionResult {
  const t = T[args.action].find((x) => x.from === args.from);
  if (!t) return { ok: false, reason: "invalid_transition" };
  if (!t.actors.includes(args.actor)) return { ok: false, reason: "not_allowed" };
  if (args.action === "cancel" && args.actor === "customer" && args.from === "ACCEPTED") {
    const hoursLeft = (args.startAt.getTime() - args.now.getTime()) / 3_600_000;
    if (hoursLeft < args.cutoffHours) return { ok: false, reason: "cutoff" };
  }
  return { ok: true, to: t.to };
}

export function actorFor(role: Role, isBookingProvider: boolean): Actor | null {
  if (role === "ADMIN") return "admin";
  if (isBookingProvider) return "provider";
  if (role === "CUSTOMER" || role === "PROVIDER") return "customer";
  return null;
}
