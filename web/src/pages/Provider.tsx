import { useEffect, useState, type FormEvent } from "react";
import { api, hhmmToMin, minToHHMM, money, useApi, type Booking, type Category } from "../api";
import { Empty, ErrorBox, FieldErrors, Loading } from "../ui";
import { BookingCard } from "./Customer";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Tab = "bookings" | "services" | "availability" | "profile";

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: [Tab, string][] = [
    ["bookings", "Bookings"],
    ["services", "Services"],
    ["availability", "Availability"],
    ["profile", "Profile & areas"],
  ];
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Provider() {
  const [tab, setTab] = useState<Tab>("bookings");
  return (
    <div className="container">
      <h1>Provider portal</h1>
      <Tabs tab={tab} setTab={setTab} />
      {tab === "bookings" && <BookingsTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "availability" && <AvailabilityTab />}
      {tab === "profile" && <ProfileTab />}
    </div>
  );
}

function BookingsTab() {
  const stats = useApi<{ pending: number; upcoming: number; completed: number }>("/provider/stats");
  const { data, error, loading, reload } = useApi<{ bookings: Booking[] }>("/bookings");
  const [filter, setFilter] = useState<"upcoming" | "pending" | "all">("upcoming");
  const refresh = () => {
    reload();
    stats.reload();
  };
  const now = Date.now();
  const rows = (data?.bookings ?? []).filter((b) =>
    filter === "all"
      ? true
      : filter === "pending"
        ? b.status === "PENDING"
        : new Date(b.endAt).getTime() > now && ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status),
  );
  return (
    <>
      <div className="stats">
        <div className="card stat">
          <b>{stats.data?.pending ?? "-"}</b>Pending requests
        </div>
        <div className="card stat">
          <b>{stats.data?.upcoming ?? "-"}</b>Upcoming accepted
        </div>
        <div className="card stat">
          <b>{stats.data?.completed ?? "-"}</b>Completed jobs
        </div>
      </div>
      <div className="actions" style={{ marginBottom: ".75rem" }}>
        {(["upcoming", "pending", "all"] as const).map((f) => (
          <button
            key={f}
            className={`btn small ${filter === f ? "" : "secondary"}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      {data && rows.length === 0 && (
        <Empty title="No bookings here" hint="New requests will appear as customers book you." />
      )}
      <div className="list">
        {rows.map((b) => (
          <BookingCard key={b.id} b={b} mode="provider" onChange={refresh} />
        ))}
      </div>
    </>
  );
}

interface Svc {
  id: number;
  title: string;
  description: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  active: boolean;
  categoryId: number;
  category: Category;
}

function ServicesTab() {
  const { data, error, loading, reload } = useApi<{ services: Svc[] }>("/provider/services");
  const cats = useApi<{ categories: Category[] }>("/categories");
  const blank = { id: 0, title: "", description: "", durationMin: 60, price: "500", categoryId: 0 };
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState<unknown>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = {
      title: form.title,
      description: form.description,
      durationMin: Number(form.durationMin),
      priceCents: Math.round(Number(form.price) * 100),
      categoryId: Number(form.categoryId || cats.data?.categories[0]?.id),
    };
    try {
      if (form.id) await api(`/provider/services/${form.id}`, { method: "PATCH", body });
      else await api("/provider/services", { body });
      setForm(blank);
      reload();
    } catch (err) {
      setFormError(err);
    }
  }
  async function toggle(s: Svc) {
    try {
      await api(`/provider/services/${s.id}`, { method: "PATCH", body: { active: !s.active } });
      reload();
    } catch (e) {
      setFormError(e);
    }
  }

  return (
    <div className="layout-2">
      <div>
        {loading && <Loading />}
        {error && <ErrorBox error={error} retry={reload} />}
        {data && data.services.length === 0 && (
          <Empty title="No services yet" hint="Add your first service using the form." />
        )}
        <div className="list">
          {data?.services.map((s) => (
            <div className="card item" key={s.id}>
              <div>
                <strong>{s.title}</strong> {!s.active && <span className="badge cancelled">inactive</span>}
                <div className="muted small-text">
                  {s.category.name} · {s.durationMin} min · {money(s.priceCents, s.currency)}
                </div>
              </div>
              <div className="actions">
                <button
                  className="btn small secondary"
                  onClick={() =>
                    setForm({
                      id: s.id,
                      title: s.title,
                      description: s.description,
                      durationMin: s.durationMin,
                      price: String(s.priceCents / 100),
                      categoryId: s.categoryId,
                    })
                  }
                >
                  Edit
                </button>
                <button className="btn small secondary" onClick={() => toggle(s)}>
                  {s.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <form className="card" onSubmit={save}>
        <h2>{form.id ? "Edit service" : "Add service"}</h2>
        <FieldErrors error={formError} />
        <label>
          Title
          <input
            required
            minLength={3}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            value={form.categoryId || cats.data?.categories[0]?.id || ""}
            onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
          >
            {cats.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="row">
          <label>
            Duration (min)
            <input
              type="number"
              min={15}
              max={480}
              step={15}
              required
              value={form.durationMin}
              onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
            />
          </label>
          <label>
            Price (₹)
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </label>
        </div>
        <div className="actions">
          <button className="btn">{form.id ? "Save changes" : "Add service"}</button>
          {form.id !== 0 && (
            <button type="button" className="btn secondary" onClick={() => setForm(blank)}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

interface Rule {
  weekday: number;
  startMin: number;
  endMin: number;
}
interface Exc {
  id: number;
  date: string;
  startMin: number | null;
  endMin: number | null;
  note: string;
}
type Conflicts = { bookingId: number; startAt: string }[];

function ConflictWarning({ conflicts }: { conflicts: Conflicts }) {
  if (!conflicts.length) return null;
  return (
    <div className="alert warn" role="alert">
      <span>
        {conflicts.length} existing booking(s) fall outside your new hours:{" "}
        {conflicts.map((c) => `#${c.bookingId} (${new Date(c.startAt).toLocaleString()})`).join(", ")}. They
        were kept. Please cancel or honour them.
      </span>
    </div>
  );
}

function AvailabilityTab() {
  const { data, error, loading, reload } = useApi<{ timezone: string; rules: Rule[]; exceptions: Exc[] }>(
    "/provider/availability",
  );
  const [rules, setRules] = useState<Rule[]>([]);
  const [conflicts, setConflicts] = useState<Conflicts>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [ex, setEx] = useState({ date: "", off: true, start: "09:00", end: "13:00", note: "" });

  useEffect(() => {
    if (data) setRules(data.rules);
  }, [data]);

  const upd = (i: number, patch: Partial<Rule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function saveRules() {
    setSaveError(null);
    setSaved(false);
    try {
      const r = await api<{ conflicts: Conflicts }>("/provider/availability", {
        method: "PUT",
        body: { rules: rules.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })) },
      });
      setConflicts(r.conflicts);
      setSaved(true);
      reload();
    } catch (e) {
      setSaveError(e);
    }
  }
  async function addEx(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    try {
      const r = await api<{ conflicts: Conflicts }>("/provider/exceptions", {
        body: {
          date: ex.date,
          startMin: ex.off ? null : hhmmToMin(ex.start),
          endMin: ex.off ? null : hhmmToMin(ex.end),
          note: ex.note,
        },
      });
      setConflicts(r.conflicts);
      setEx({ ...ex, date: "", note: "" });
      reload();
    } catch (err) {
      setSaveError(err);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <>
      <ConflictWarning conflicts={conflicts} />
      <FieldErrors error={saveError} />
      <div className="card">
        <h2>
          Weekly hours <span className="muted small-text">({data?.timezone})</span>
        </h2>
        {rules.length === 0 && (
          <p className="muted">No working hours set. Customers cannot book you until you add some.</p>
        )}
        {rules.map((r, i) => (
          <div className="row" key={i}>
            <label>
              Day
              <select value={r.weekday} onChange={(e) => upd(i, { weekday: Number(e.target.value) })}>
                {DAYS.map((d, n) => (
                  <option key={d} value={n + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="time"
                value={minToHHMM(r.startMin)}
                onChange={(e) => upd(i, { startMin: hhmmToMin(e.target.value) })}
              />
            </label>
            <label>
              To
              <input
                type="time"
                value={minToHHMM(Math.min(r.endMin, 1439))}
                onChange={(e) => upd(i, { endMin: hhmmToMin(e.target.value) })}
              />
            </label>
            <button className="btn small secondary" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div className="actions">
          <button
            className="btn secondary"
            onClick={() => setRules([...rules, { weekday: 1, startMin: 540, endMin: 1020 }])}
          >
            Add hours
          </button>
          <button className="btn" onClick={saveRules}>
            Save weekly hours
          </button>
          {saved && (
            <span role="status" className="muted">
              Saved
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2>Days off and special hours</h2>
        <form onSubmit={addEx}>
          <div className="row">
            <label>
              Date
              <input
                type="date"
                required
                value={ex.date}
                onChange={(e) => setEx({ ...ex, date: e.target.value })}
              />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={ex.off}
                onChange={(e) => setEx({ ...ex, off: e.target.checked })}
              />{" "}
              Day off
            </label>
            {!ex.off && (
              <>
                <label>
                  From
                  <input
                    type="time"
                    value={ex.start}
                    onChange={(e) => setEx({ ...ex, start: e.target.value })}
                  />
                </label>
                <label>
                  To
                  <input type="time" value={ex.end} onChange={(e) => setEx({ ...ex, end: e.target.value })} />
                </label>
              </>
            )}
            <label>
              Note
              <input value={ex.note} onChange={(e) => setEx({ ...ex, note: e.target.value })} />
            </label>
            <button className="btn">Add</button>
          </div>
        </form>
        <div className="list">
          {data?.exceptions.map((x) => (
            <div className="item" key={x.id}>
              <span>
                {x.date}:{" "}
                {x.startMin == null ? "Day off" : `${minToHHMM(x.startMin)} to ${minToHHMM(x.endMin!)}`}{" "}
                {x.note && <span className="muted">({x.note})</span>}
              </span>
              <button
                className="btn small secondary"
                onClick={async () => {
                  await api(`/provider/exceptions/${x.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ProfileTab() {
  const { data, error, loading, reload } = useApi<{
    profile: { bio: string; city: string; timezone: string; areas: string[] };
  }>("/provider/profile");
  const [f, setF] = useState({ bio: "", city: "", timezone: "UTC", areas: "" });
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setF({ ...data.profile, areas: data.profile.areas.join(", ") });
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    try {
      await api("/provider/profile", {
        method: "PUT",
        body: {
          ...f,
          areas: f.areas
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      setSaved(true);
      reload();
    } catch (e2) {
      setErr(e2);
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 560 }}>
      <FieldErrors error={err} />
      <label>
        About you
        <textarea
          rows={4}
          maxLength={1000}
          value={f.bio}
          onChange={(e) => setF({ ...f, bio: e.target.value })}
        />
      </label>
      <label>
        City
        <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
      </label>
      <label>
        Timezone
        <input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} list="tzs2" />
        <datalist id="tzs2">
          {Intl.supportedValuesOf("timeZone").map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </label>
      <label>
        PIN code prefixes you cover (comma separated)
        <input
          value={f.areas}
          placeholder="600, 603, 641"
          onChange={(e) => setF({ ...f, areas: e.target.value })}
        />
      </label>
      <button className="btn">Save profile</button>{" "}
      {saved && (
        <span role="status" className="muted">
          Saved
        </span>
      )}
    </form>
  );
}
