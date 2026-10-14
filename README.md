# Karyvo

Local services booking platform. Customers find providers (plumbers, electricians, cleaners and so on), pick a real free time slot and book it. Providers manage services, working hours and incoming jobs. Admins manage users, categories and moderation.

## Problem and users
- Customers want to see real availability, not call around.
- Providers want requests that fit their schedule and never double up.
- Admins need to suspend bad accounts and hide abusive reviews, with a trail.

## What the MVP does
- Customer: register, sign in, search and filter services, view a provider, book a slot, cancel, get notified, leave a review after completion.
- Provider: create and edit services, set weekly hours, add days off or special hours, accept or decline requests, run jobs through in progress and completed.
- Admin: dashboard counts, user search and suspension, category management, booking inspection with history, review moderation, report handling, audit log.
- Booking engine: server-side slot generation, timezone and DST aware, concurrency safe (see below).

## Stack
- Frontend: React 19, TypeScript, Vite, React Router
- Backend: Node.js, Express 4, TypeScript, Zod validation
- Database: PostgreSQL 16+, Prisma ORM, raw SQL for the exclusion constraint
- Auth: bcrypt password hashes, JWT in an httpOnly cookie
- Tests: Vitest and Supertest against a real PostgreSQL database
- Docs: OpenAPI at `/api/docs`
- Logging: pino with request IDs, cookies and auth headers redacted

## Architecture
```
Browser (React SPA)
   |  JSON over HTTPS, httpOnly cookie
   v
Express API
   routes -> zod validation -> services (booking, slots, state machine) -> Prisma
   |
   v
PostgreSQL (exclusion constraint guards double booking)
```
- `server/src/lib/slots.ts`: pure slot calculation, unit tested.
- `server/src/lib/stateMachine.ts`: pure transition rules, one place for who can do what.
- `server/src/services/bookingService.ts`: create, transition, expire and review logic.
- `server/src/routes/*`: thin HTTP layer per area (auth, public, provider, bookings, admin).

### Booking sequence
```
Customer           API                          PostgreSQL
   |  GET /services/:id/slots?date  |                |
   |------------------------------->| read rules,    |
   |<-------------------------------| bookings       |
   |  POST /bookings (Idempotency-Key)               |
   |------------------------------->| expire stale   |
   |                                | re-check slot  |
   |                                | INSERT booking |
   |                                |--------------->| exclusion check
   |                                |<---------------| ok or 23P01
   |<-------------------------------| 201 or 409     |
Provider accepts -> compare-and-set status -> history row -> notification
```

## Double booking strategy
- Short version: a PostgreSQL exclusion constraint rejects overlapping blocking bookings for one provider.
- App check first for a clean error, database constraint as the real guarantee.
- Idempotency keys make client retries safe.
- Full write-up with trade-offs: [docs/concurrency.md](docs/concurrency.md)

## Booking states
```
PENDING -> ACCEPTED -> IN_PROGRESS -> COMPLETED
PENDING -> DECLINED            (provider)
PENDING -> EXPIRED             (system, after 24h or start time passes)
PENDING | ACCEPTED -> CANCELLED (customer, provider or admin)
```
- Pending, accepted and in progress block the slot. All other states release it.
- Customers cannot cancel an accepted booking within 24 hours of the start. Providers and admins can.
- Reviews: only the customer, only completed bookings, one per booking. Admins can hide them.
- Prices and service titles are copied onto the booking, so later edits do not rewrite history.

## Roles
- CUSTOMER: browse, book, cancel own bookings, review.
- PROVIDER: everything a customer can do, plus the provider portal for their own data only.
- ADMIN: created by seed only. Cannot be self-registered.
- Other people's bookings return 404 rather than 403, so ids cannot be probed.

## Data decisions
- Timestamps: UTC.
- Working hours: local minutes after midnight plus weekday, interpreted in the provider's IANA timezone.
- Money: integer cents plus a currency code.
- Coverage areas: postcode prefixes (for example `SW1`).
- Categories seeded: Plumbing, Electrical, Cleaning, Pest Control, Gardening, Painting.

## Local setup
Needs Node 22+ and PostgreSQL 16+.

1. Install dependencies
```bash
npm run install:all
```
2. Database. Pick one:
   - Docker: `docker compose up -d postgres`, then use the default `.env.example` URL.
   - Windows with PostgreSQL installed: `powershell -File scripts/dev-db.ps1` (private instance on port 5433).
3. Configure the server
```bash
cp server/.env.example server/.env
```
   - Edit `DATABASE_URL` and set a long `JWT_SECRET`.
4. Create tables and demo data
```bash
npm run db:migrate
npm run db:seed
```
5. Run both apps in two terminals
```bash
npm run dev:server
npm run dev:web
```
   - Web: http://localhost:5173
   - API: http://localhost:4000, docs at http://localhost:4000/api/docs, health at `/health`

## Demo accounts
All use the password `Password123!`. Fake data only.

| Role | Email |
|------|-------|
| Admin | admin@karyvo.test |
| Customer | customer@karyvo.test, customer2@karyvo.test |
| Provider | provider@karyvo.test, provider2@karyvo.test, provider3@karyvo.test |

## Commands
```bash
npm test                    # unit and API integration tests (needs the test database)
npm run lint                # eslint (server) and oxlint (web)
npm run build               # compile server and web
npm --prefix server run loadtest   # basic load test, API must be running and seeded
```
- Tests use `TEST_DATABASE_URL`, default `postgresql://karyvo@localhost:5433/karyvo_test`. Migrations are applied automatically.
- Tests wipe the test database. Never point it at real data.

## Tests
- Unit: slot calculation (adjacent, overlapping, day off, special hours, timezone, DST gap) and the state machine.
- Integration: registration and login, validation errors, rate limiting, suspended users, role checks, cross-user access.
- Booking: lifecycle with history and notifications, invalid transitions, decline and cancel release the slot, cancel cutoff, expiry, price snapshot, schedule change conflicts.
- Concurrency: 8 simultaneous bookings for one slot give one winner. Overlaps are also rejected when inserting rows directly.
- Duplicates: repeated and concurrent retries with one idempotency key create one booking and one notification.

## Deployment
- A `Dockerfile` builds the web app and API into one image. The API serves the built frontend.
- `docker-compose.yml` runs the app with PostgreSQL. Set `JWT_SECRET` first.
- On start the container runs `prisma migrate deploy`, then the API.
- Production settings: `NODE_ENV=production`, `COOKIE_SECURE=true` behind HTTPS, `CORS_ORIGIN` set to the real site origin.
- The app refuses to start in production with the dev JWT secret.
- Backup: `pg_dump -Fc "$DATABASE_URL" > karyvo.dump`. Restore: `pg_restore --clean --no-owner -d "$DATABASE_URL" karyvo.dump`.
- Not deployed anywhere yet. See limitations.

## Load test result (local, one process, laptop)
- Slot search: about 105 requests per second, p99 about 370 ms.
- Booking creation with 20 connections hammering 6 start times: 3 bookings created, 854 clean 409 conflicts, 0 errors, no overlaps.
- Numbers are from a dev machine and only show the constraint holds under pressure.

## Known limitations
- Not deployed to a public host, and no screenshots or demo video yet.
- In-app notifications only. No email, and the bell polls every 30 seconds.
- Search filters by postcode and date in application code after the database query. Fine for a demo, not for a large catalogue.
- Slots start on a 30 minute grid.
- One provider calendar equals one worker. No teams or parallel capacity.
- No payments, refunds or calendar export.
- CSRF is covered by `SameSite=Lax` cookies, JSON-only bodies and a locked CORS origin, without a separate token.
- The in progress step has no time check. A provider can start a job early.
- Expiry sweep runs inside the API process. Run several instances and each sweeps, which is safe but redundant.
