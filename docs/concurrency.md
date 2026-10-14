# How Mr Fix My Home prevents double booking

## The problem
- Two customers open the same free slot and both press "Book" at nearly the same moment.
- Both requests check availability, both see the slot as free, both try to insert.
- An app-level check alone ("is it free? then insert") has a gap between check and insert.

## The solution: three layers

### 1. Fast path check (application)
- `availableSlots()` builds the free slots from working hours, days off and existing blocking bookings.
- `createBooking()` re-runs it on the server for the exact start time. The frontend list is never trusted.
- This gives a clean `409 SLOT_UNAVAILABLE` in the normal case and keeps the database out of the hot path.

### 2. The real guard: a PostgreSQL exclusion constraint
- Defined in `server/prisma/migrations/*_init/migration.sql`:

```sql
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap EXCLUDE USING gist (
  "providerId" WITH =,
  tsrange("startAt", "endAt", '[)') WITH &&
) WHERE ("status" IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS'));
```

- Meaning: no two blocking bookings for the same provider can have overlapping time ranges.
- Ranges are half-open `[start, end)`, so 10:00-11:00 and 11:00-12:00 are allowed back to back.
- The check runs inside the insert, protected by the index, so it is atomic across concurrent transactions.
- When two requests race, one insert wins and the other fails with Postgres error `23P01`.
- The API maps that error to `409 SLOT_TAKEN`.
- Declined, cancelled, expired and completed bookings are outside the `WHERE`, so they release the slot.

### 3. Idempotency
- Clients send an `Idempotency-Key` header. `(customerId, idempotencyKey)` is unique.
- A retried request returns the original booking with `200` and `Idempotent-Replay: true`.
- If two retries race, the unique violation is caught and the original row is returned.

## Status changes
- Transitions use compare-and-set: `UPDATE ... WHERE id = ? AND status = <old status>`.
- If another request changed the status first, zero rows update and the API returns `409 STALE_STATUS`.
- Every change writes a `BookingStatusHistory` row in the same transaction.

## Pending requests and expiry
- A `PENDING` request blocks its slot so two customers cannot both be waiting on the same time.
- It expires after `PENDING_TTL_MINUTES` (default 24h) or once its start time passes, and moves to `EXPIRED`.
- Expiry runs lazily on reads and every 60 seconds in the server process.

## Verified by tests
- `tests/booking.test.ts`: 8 simultaneous requests for one slot give exactly one `201` and seven `409`.
- Same file: inserting overlapping rows directly through Prisma, bypassing the API, is rejected by the database.
- Same file: concurrent retries with one idempotency key create exactly one booking.

## Limits and trade-offs
- Uses `btree_gist`, which is PostgreSQL specific. Moving databases means re-implementing this with locks.
- The constraint guards one provider's calendar. It does not model a provider with several workers in parallel.
- Slot grid is fixed at 30 minutes (`slotStepMinutes`). A 45 minute service still starts on the half hour.
- Timestamps are stored as UTC `timestamp`. Working hours are stored as local minutes plus the provider's IANA timezone, so DST is handled when slots are generated.
- Changing working hours never cancels existing bookings. The API returns `conflicts` so the provider can resolve them.
- A provider who is booked on a day and then marks it as a day off keeps the booking until they cancel it.

## Check for overlaps by hand
```sql
SELECT a.id, b.id
FROM "Booking" a JOIN "Booking" b
  ON a."providerId" = b."providerId" AND a.id < b.id
 AND tsrange(a."startAt", a."endAt") && tsrange(b."startAt", b."endAt")
WHERE a.status IN ('PENDING','ACCEPTED','IN_PROGRESS')
  AND b.status IN ('PENDING','ACCEPTED','IN_PROGRESS');
-- expected: 0 rows
```
