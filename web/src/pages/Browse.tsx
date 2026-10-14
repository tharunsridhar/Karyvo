import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, fmtTime, money, useApi, type Category, type ServiceItem } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, Stars } from "../ui";

export function Home() {
  const { data } = useApi<{ categories: Category[] }>("/categories");
  const nav = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="container">
      <section className="hero">
        <h1>Book trusted local help, on your schedule</h1>
        <p>
          Plumbers, electricians, cleaners and more. See real availability and book a time in under a minute.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            nav(`/services?q=${encodeURIComponent(q)}`);
          }}
          role="search"
        >
          <input
            aria-label="Search services"
            placeholder="What do you need? e.g. leak repair"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn secondary" style={{ background: "#fff" }}>
            Search
          </button>
        </form>
      </section>
      <h2>Browse by category</h2>
      <div className="cats">
        {data?.categories.map((c) => (
          <Link key={c.id} className="pill" to={`/services?categoryId=${c.id}`}>
            {c.name}
          </Link>
        ))}
      </div>
      <h2>How it works</h2>
      <div className="grid">
        <div className="card">
          <h3>1. Search</h3>
          <p className="muted">Filter by category, price, area and the day you need.</p>
        </div>
        <div className="card">
          <h3>2. Pick a slot</h3>
          <p className="muted">Only genuinely free times are shown, checked again when you book.</p>
        </div>
        <div className="card">
          <h3>3. Get confirmed</h3>
          <p className="muted">The provider accepts your request and you get notified.</p>
        </div>
      </div>
    </div>
  );
}

export function Services() {
  const [params, setParams] = useSearchParams();
  const { data: cats } = useApi<{ categories: Category[] }>("/categories");
  const qs = params.toString();
  const { data, error, loading, reload } = useApi<{
    items: ServiceItem[];
    total: number;
    page: number;
    totalPages: number;
  }>(`/services?${qs}`);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p);
  };
  const [filters, setFilters] = useState({
    q: params.get("q") ?? "",
    postcode: params.get("postcode") ?? "",
    maxPrice: params.get("maxPrice") ? String(Number(params.get("maxPrice")) / 100) : "",
  });
  function apply(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams(params);
    (["q", "postcode"] as const).forEach((k) => (filters[k] ? p.set(k, filters[k]) : p.delete(k)));
    filters.maxPrice
      ? p.set("maxPrice", String(Math.round(Number(filters.maxPrice) * 100)))
      : p.delete("maxPrice");
    p.delete("page");
    setParams(p);
  }

  return (
    <div className="container">
      <h1>Find a service</h1>
      <form className="card" onSubmit={apply} role="search" aria-label="Filter services">
        <div className="row">
          <label>
            Search
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Service or category"
            />
          </label>
          <label>
            Category
            <select
              value={params.get("categoryId") ?? ""}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="">All</option>
              {cats?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Postcode
            <input
              value={filters.postcode}
              onChange={(e) => setFilters({ ...filters, postcode: e.target.value })}
              placeholder="e.g. SW1A"
            />
          </label>
          <label>
            Max price
            <input
              type="number"
              min="0"
              value={filters.maxPrice}
              onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
            />
          </label>
          <label>
            Available on
            <input
              type="date"
              value={params.get("date") ?? ""}
              onChange={(e) => set("date", e.target.value)}
            />
          </label>
          <label>
            Sort by
            <select value={params.get("sort") ?? "newest"} onChange={(e) => set("sort", e.target.value)}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="rating">Top rated</option>
            </select>
          </label>
          <button className="btn">Apply</button>
        </div>
      </form>

      <div style={{ marginTop: "1rem" }} aria-live="polite">
        {loading && <Loading label="Loading services" />}
        {error && <ErrorBox error={error} retry={reload} />}
        {data && data.items.length === 0 && (
          <Empty
            title="No services match your search"
            hint="Try removing a filter or searching a broader term."
            action={
              <button
                className="btn secondary"
                onClick={() => {
                  setFilters({ q: "", postcode: "", maxPrice: "" });
                  setParams({});
                }}
              >
                Clear filters
              </button>
            }
          />
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="muted">
              {data.total} result{data.total === 1 ? "" : "s"}
            </p>
            <div className="grid">
              {data.items.map((s) => (
                <Link key={s.id} to={`/services/${s.id}`} className="card service">
                  <span className="pill" style={{ alignSelf: "flex-start" }}>
                    {s.category.name}
                  </span>
                  <h3>{s.title}</h3>
                  <span className="muted small-text">
                    {s.provider.name}, {s.provider.city || "n/a"}
                  </span>
                  <Stars value={s.provider.rating} />
                  <span className="price">
                    {money(s.priceCents, s.currency)}{" "}
                    <span className="muted small-text">· {s.durationMin} min</span>
                  </span>
                </Link>
              ))}
            </div>
            {data.totalPages > 1 && (
              <nav className="pager" aria-label="Pagination">
                <button
                  className="btn small secondary"
                  disabled={data.page <= 1}
                  onClick={() => set("page", String(data.page - 1))}
                >
                  Previous
                </button>
                <span>
                  Page {data.page} of {data.totalPages}
                </span>
                <button
                  className="btn small secondary"
                  disabled={data.page >= data.totalPages}
                  onClick={() => set("page", String(data.page + 1))}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Review {
  id: number;
  rating: number;
  text: string;
  createdAt: string;
  author: string;
}

export function ServiceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<{ service: ServiceItem }>(`/services/${id}`);
  const providerId = data?.service.provider.id;
  const { data: prov } = useApi<{ reviews: Review[] }>(providerId ? `/providers/${providerId}` : null);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotError, setSlotError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<unknown>(null);
  const key = useRef(crypto.randomUUID());
  const tz = data?.service.provider.timezone;

  async function loadSlots() {
    setSlots(null);
    setSlotError(null);
    setSelected(null);
    try {
      setSlots((await api<{ slots: string[] }>(`/services/${id}/slots?date=${date}`)).slots);
    } catch (e) {
      setSlotError(e);
    }
  }
  useEffect(() => {
    if (data) void loadSlots(); /* eslint-disable-next-line */
  }, [date, data?.service.id]);

  async function book(e: FormEvent) {
    e.preventDefault();
    if (!user) return nav("/login", { state: { from: `/services/${id}` } });
    if (!selected) return;
    setBusy(true);
    setBookError(null);
    try {
      await api("/bookings", {
        body: { serviceId: Number(id), startAt: selected, notes },
        headers: { "Idempotency-Key": key.current },
      });
      key.current = crypto.randomUUID();
      nav("/bookings");
    } catch (err) {
      setBookError(err);
      if (err instanceof ApiError && err.status === 409) void loadSlots();
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="container">
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="container">
        <ErrorBox error={error} retry={reload} />
        <Link to="/services">Back to services</Link>
      </div>
    );
  const s = data!.service;

  return (
    <div className="container layout-2">
      <div>
        <span className="pill">{s.category.name}</span>
        <h1>{s.title}</h1>
        <p>{s.description || "No description provided."}</p>
        <p className="price">
          {money(s.priceCents, s.currency)}{" "}
          <span className="muted small-text">· about {s.durationMin} minutes</span>
        </p>
        <div className="card">
          <h2>{s.provider.name}</h2>
          <Stars value={s.provider.rating} />{" "}
          <span className="muted small-text">
            ({s.provider.reviewCount} review{s.provider.reviewCount === 1 ? "" : "s"})
          </span>
          <p>{s.provider.bio}</p>
          <p className="small-text muted">
            Based in {s.provider.city || "n/a"}. Covers:{" "}
            {s.provider.areas.length ? s.provider.areas.join(", ") : "ask the provider"}. Times shown in {tz}.
          </p>
        </div>
        <h2 style={{ marginTop: "1.5rem" }}>Reviews</h2>
        {prov?.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
        <div className="list">
          {prov?.reviews.map((r) => (
            <div className="card" key={r.id}>
              <Stars value={r.rating} /> <strong>{r.author}</strong>{" "}
              <span className="muted small-text">{new Date(r.createdAt).toLocaleDateString()}</span>
              <p>{r.text}</p>
            </div>
          ))}
        </div>
      </div>

      <form className="card" onSubmit={book} aria-label="Book this service">
        <h2>Book a time</h2>
        <label>
          Date
          <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div aria-live="polite">
          {slots === null && !slotError && <Loading label="Loading times" />}
          {!!slotError && <ErrorBox error={slotError} retry={loadSlots} />}
          {slots && slots.length === 0 && (
            <p className="muted">No free times on this day. Try another date.</p>
          )}
          {slots && slots.length > 0 && (
            <div className="slots" role="group" aria-label="Available times">
              {slots.map((t) => (
                <button
                  type="button"
                  key={t}
                  className="slot"
                  aria-pressed={selected === t}
                  onClick={() => setSelected(t)}
                >
                  {fmtTime(t, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
        <label>
          Notes for the provider (optional)
          <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {!!bookError && <ErrorBox error={bookError} />}
        <button className="btn" disabled={!selected || busy}>
          {busy ? "Booking..." : user ? "Request booking" : "Sign in to book"}
        </button>
        <p className="muted small-text">
          The provider confirms your request. Pending requests expire after 24 hours.
        </p>
      </form>
    </div>
  );
}
