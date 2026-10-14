import { describe, expect, it } from "vitest";
import type { BookingStatus } from "@prisma/client";
import { checkTransition, type Action, type Actor } from "../src/lib/stateMachine.js";

const now = new Date("2026-06-01T00:00:00Z");
const far = new Date("2026-06-10T00:00:00Z");
const soon = new Date("2026-06-01T10:00:00Z");
const run = (action: Action, from: BookingStatus, actor: Actor, startAt = far) =>
  checkTransition({ action, from, actor, startAt, now, cutoffHours: 24 });

describe("booking state machine", () => {
  it("allows the happy path", () => {
    expect(run("accept", "PENDING", "provider")).toEqual({ ok: true, to: "ACCEPTED" });
    expect(run("start", "ACCEPTED", "provider")).toEqual({ ok: true, to: "IN_PROGRESS" });
    expect(run("complete", "IN_PROGRESS", "provider")).toEqual({ ok: true, to: "COMPLETED" });
  });

  it("rejects invalid transitions", () => {
    expect(run("complete", "DECLINED", "provider")).toEqual({ ok: false, reason: "invalid_transition" });
    expect(run("accept", "CANCELLED", "provider")).toEqual({ ok: false, reason: "invalid_transition" });
    expect(run("cancel", "COMPLETED", "customer")).toEqual({ ok: false, reason: "invalid_transition" });
    expect(run("start", "PENDING", "provider")).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("restricts who can do what", () => {
    expect(run("accept", "PENDING", "customer")).toEqual({ ok: false, reason: "not_allowed" });
    expect(run("complete", "IN_PROGRESS", "customer")).toEqual({ ok: false, reason: "not_allowed" });
    expect(run("expire", "PENDING", "provider")).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("enforces the cancellation cutoff for customers on accepted bookings only", () => {
    expect(run("cancel", "ACCEPTED", "customer", soon)).toEqual({ ok: false, reason: "cutoff" });
    expect(run("cancel", "ACCEPTED", "customer", far)).toEqual({ ok: true, to: "CANCELLED" });
    expect(run("cancel", "PENDING", "customer", soon)).toEqual({ ok: true, to: "CANCELLED" });
    expect(run("cancel", "ACCEPTED", "provider", soon)).toEqual({ ok: true, to: "CANCELLED" });
  });
});
