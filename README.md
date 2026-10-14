# Mr Fix My Home

A booking site for local services like plumbing, electrical work and cleaning. Customers pick a free time slot and book it. Providers set their working hours and accept jobs. Admins keep things in order.

## What you can do
- Customers: search services, book a slot, cancel, get notified, leave a review.
- Providers: add services, set weekly hours and days off, accept or decline requests, mark jobs done.
- Admins: manage users and categories, hide reviews, see an audit log.
- Two people can never book the same slot (see below).

## Tech
- React + TypeScript (Vite)
- Node.js + Express + TypeScript
- PostgreSQL with Prisma
- Tests with Vitest and Supertest

## Run it
You need Node 22+ and PostgreSQL 16+.

```bash
npm run install:all
cp server/.env.example server/.env
```

Open `server/.env` and set `DATABASE_URL` and a long random `JWT_SECRET`. Then:

```bash
npm run db:migrate
npm run db:seed
npm run dev:server
npm run dev:web
```

- Website: http://localhost:5173
- API docs: http://localhost:4000/api/docs

No local database? Run `docker compose up -d postgres` and use `postgresql://mrfixmyhome:mrfixmyhome@localhost:5434/mrfixmyhome` as `DATABASE_URL`.

## Demo logins
Password for all of them is `Password123!`

- Customer: `customer@mrfixmyhome.test`
- Provider: `provider@mrfixmyhome.test`
- Admin: `admin@mrfixmyhome.test`

## Tests
```bash
npm test
```
Uses a separate `mrfixmyhome_test` database and wipes it each run, so never point it at real data.

## How double booking is stopped
- The server rechecks the slot when you book, and bookings for one provider are processed one at a time.
- On top of that, PostgreSQL itself rejects overlapping bookings for the same provider, so two people clicking at the same moment cannot both win.
- Full explanation: [docs/concurrency.md](docs/concurrency.md)

## Docker
```bash
docker compose up --build -d
```
Set `JWT_SECRET` first. The app runs on http://localhost:4000. Add demo data with `docker compose exec app npx tsx prisma/seed.ts`.

## Deploying on a free tier
- `render.yaml` sets up a free Render service. Use a free Neon database and paste its connection string as `DATABASE_URL`.
- Free hosting has limits, so the app protects itself: caps on users, bookings and services, a daily request budget, and a "server is full" banner when they are reached. All of it is configurable in `server/.env.example`.

## Notes
- Prices are in rupees. Times are stored in UTC and shown in the provider's timezone.
- Notifications are in-app only. There are no payments or emails.
