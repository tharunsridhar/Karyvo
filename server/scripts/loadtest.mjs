// Basic load test: slot search and booking creation against a running API.
// Usage: node scripts/loadtest.mjs [baseUrl]   (run `npm run db:seed` first)
import autocannon from "autocannon";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:4000";
const day = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

async function login(email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.headers.getSetCookie()[0].split(";")[0];
}

function run(opts) {
  return new Promise((resolve, reject) =>
    autocannon({ duration: 10, connections: 20, ...opts }, (err, r) => (err ? reject(err) : resolve(r))),
  );
}

function summary(name, r) {
  const codes = Object.entries(r.statusCodeStats ?? {})
    .map(([c, v]) => `${c}:${v.count}`)
    .join(" ");
  console.log(
    `${name}: ${Math.round(r.requests.average)} req/s, p50 ${r.latency.p50}ms, p99 ${r.latency.p99}ms, ` +
      `errors ${r.errors}, non-2xx ${r.non2xx}, codes [${codes}]`,
  );
}

const cookie = await login("customer2@karyvo.test");

summary("slot search", await run({ url: `${base}/api/services/1/slots?date=${day}` }));

// Every request uses a fresh idempotency key against a handful of start times,
// so most return 409. That is the point: the DB constraint must hold under pressure.
const times = ["09:00", "09:30", "10:00", "13:00", "14:30", "16:00"].map((t) => `${day}T${t}:00.000Z`);
summary(
  "booking creation",
  await run({
    url: `${base}/api/bookings`,
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    requests: [
      {
        setupRequest: (req) => ({
          ...req,
          headers: { ...req.headers, "Idempotency-Key": randomUUID() },
          body: JSON.stringify({ serviceId: 1, startAt: times[Math.floor(Math.random() * times.length)] }),
        }),
      },
    ],
  }),
);
console.log("Check: no two blocking bookings overlap, see docs/concurrency.md for the SQL.");
