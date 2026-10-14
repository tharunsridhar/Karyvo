import { describe, expect, it } from "vitest";
import { computeSlots } from "../src/lib/slots.js";

const base = {
  timezone: "UTC",
  rules: [{ weekday: 1, startMin: 540, endMin: 720 }], // Mon 09:00-12:00
  durationMin: 60,
  busy: [] as { start: Date; end: Date }[],
  now: new Date("2026-01-01T00:00:00Z"),
  stepMin: 30,
};
const MON = "2026-06-01"; // a Monday
const times = (d: Date[]) => d.map((x) => x.toISOString().slice(11, 16));

describe("computeSlots", () => {
  it("generates grid slots that fit inside the window", () => {
    const s = computeSlots({ ...base, date: MON });
    expect(times(s)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("returns nothing on days without rules", () => {
    expect(computeSlots({ ...base, date: "2026-06-02" })).toEqual([]);
  });

  it("excludes overlapping bookings but allows adjacent ones", () => {
    const busy = [{ start: new Date("2026-06-01T10:00:00Z"), end: new Date("2026-06-01T11:00:00Z") }];
    const s = computeSlots({ ...base, date: MON, busy });
    // 09:00-10:00 ends exactly when the booking starts (adjacent, ok); 09:30 and 10:30 overlap
    expect(times(s)).toEqual(["09:00", "11:00"]);
  });

  it("treats a day off exception as no slots", () => {
    expect(computeSlots({ ...base, date: MON, exception: { startMin: null, endMin: null } })).toEqual([]);
  });

  it("uses exception hours instead of weekly rules", () => {
    const s = computeSlots({ ...base, date: MON, exception: { startMin: 600, endMin: 660 } });
    expect(times(s)).toEqual(["10:00"]);
  });

  it("drops slots in the past", () => {
    const s = computeSlots({ ...base, date: MON, now: new Date("2026-06-01T09:45:00Z") });
    expect(times(s)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("respects the provider timezone", () => {
    const s = computeSlots({ ...base, timezone: "America/New_York", date: MON });
    expect(times(s)[0]).toBe("13:00"); // 09:00 EDT = 13:00 UTC
  });

  it("skips wall-clock times that do not exist during a DST gap", () => {
    // London springs forward on 2026-03-29: 01:00 becomes 02:00, so 01:00 and 01:30 do not exist
    const s = computeSlots({
      ...base,
      timezone: "Europe/London",
      date: "2026-03-29",
      rules: [{ weekday: 7, startMin: 0, endMin: 180 }],
      durationMin: 30,
      now: new Date("2026-03-01T00:00:00Z"),
    });
    const local = s.map((d) =>
      d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }),
    );
    expect(local).toEqual(["00:00", "00:30", "02:00", "02:30"]);
  });

  it("keeps the same local hours across a DST change", () => {
    const rules = [{ weekday: 7, startMin: 540, endMin: 600 }];
    const now = new Date("2026-03-01T00:00:00Z");
    const before = computeSlots({ ...base, timezone: "Europe/London", date: "2026-03-22", rules, now });
    const after = computeSlots({ ...base, timezone: "Europe/London", date: "2026-03-29", rules, now });
    expect(before[0].toISOString()).toBe("2026-03-22T09:00:00.000Z"); // GMT
    expect(after[0].toISOString()).toBe("2026-03-29T08:00:00.000Z"); // BST
  });
});
