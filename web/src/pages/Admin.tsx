import { useState, type FormEvent } from "react";
import { api, fmtDateTime, money, useApi, type Booking, type Category } from "../api";
import { Empty, ErrorBox, FieldErrors, Loading, StatusBadge } from "../ui";

type Tab = "overview" | "users" | "categories" | "bookings" | "reviews" | "reports" | "audit";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["categories", "Categories"],
  ["bookings", "Bookings"],
  ["reviews", "Reviews"],
  ["reports", "Reports"],
  ["audit", "Audit log"],
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="container">
      <h1>Administration</h1>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "categories" && <Categories />}
      {tab === "bookings" && <Bookings />}
      {tab === "reviews" && <Reviews />}
      {tab === "reports" && <Reports />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Wrap<T>({
  r,
  children,
  emptyText,
}: {
  r: { data: T | null; error: unknown; loading: boolean; reload: () => void };
  children: (d: T) => React.ReactNode;
  emptyText?: string;
}) {
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  if (!r.data) return <Empty title={emptyText ?? "Nothing to show"} />;
  return <>{children(r.data)}</>;
}

function Overview() {
  const r = useApi<{
    users: number;
    providers: number;
    services: number;
    bookings: number;
    pendingReports: number;
    bookingsByStatus: Record<string, number>;
  }>("/admin/stats");
  return (
    <Wrap r={r}>
      {(d) => (
        <>
          <div className="stats">
            <div className="card stat">
              <b>{d.users}</b>Users
            </div>
            <div className="card stat">
              <b>{d.providers}</b>Providers
            </div>
            <div className="card stat">
              <b>{d.services}</b>Services
            </div>
            <div className="card stat">
              <b>{d.bookings}</b>Bookings
            </div>
            <div className="card stat">
              <b>{d.pendingReports}</b>Open reports
            </div>
          </div>
          <div className="card">
            <h2>Bookings by status</h2>
            {Object.keys(d.bookingsByStatus).length === 0 && <p className="muted">No bookings yet.</p>}
            <div className="actions">
              {Object.entries(d.bookingsByStatus).map(([s, n]) => (
                <span key={s}>
                  <StatusBadge status={s} /> {n}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </Wrap>
  );
}

interface U {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}
function Users() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const r = useApi<{ users: U[] }>(`/admin/users?q=${encodeURIComponent(q)}&role=${role}`);
  async function toggle(u: U) {
    setErr(null);
    try {
      await api(`/admin/users/${u.id}/status`, {
        method: "PATCH",
        body: { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" },
      });
      r.reload();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <>
      <div className="row">
        <label>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All</option>
            <option>CUSTOMER</option>
            <option>PROVIDER</option>
            <option>ADMIN</option>
          </select>
        </label>
      </div>
      {!!err && <ErrorBox error={err} />}
      <Wrap r={r}>
        {(d) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>
                      <StatusBadge status={u.status === "ACTIVE" ? "accepted" : "cancelled"} />{" "}
                      {u.status.toLowerCase()}
                    </td>
                    <td>
                      <button className="btn small secondary" onClick={() => toggle(u)}>
                        {u.status === "ACTIVE" ? "Suspend" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Wrap>
    </>
  );
}

function Categories() {
  const r = useApi<{ categories: Category[] }>("/categories");
  const [name, setName] = useState("");
  const [err, setErr] = useState<unknown>(null);
  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      r.reload();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <>
      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => {
            await api("/admin/categories", { body: { name } });
            setName("");
          });
        }}
      >
        <label>
          New category
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn">Add</button>
      </form>
      <FieldErrors error={err} />
      <Wrap r={r}>
        {(d) => (
          <div className="list">
            {d.categories.map((c) => (
              <div className="card item" key={c.id}>
                <strong>{c.name}</strong>
                <div className="actions">
                  <button
                    className="btn small secondary"
                    onClick={() => {
                      const n = prompt("Rename category", c.name);
                      if (n)
                        void run(() =>
                          api(`/admin/categories/${c.id}`, { method: "PATCH", body: { name: n } }),
                        );
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => {
                      if (confirm(`Delete ${c.name}?`))
                        void run(() => api(`/admin/categories/${c.id}`, { method: "DELETE" }));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Wrap>
    </>
  );
}

function Bookings() {
  const [status, setStatus] = useState("");
  const r = useApi<{ bookings: Booking[] }>(`/admin/bookings?status=${status}`);
  const [detail, setDetail] = useState<Booking | null>(null);
  return (
    <>
      <label style={{ maxWidth: 240 }}>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "IN_PROGRESS", "COMPLETED", "EXPIRED"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      <Wrap r={r}>
        {(d) =>
          d.bookings.length === 0 ? (
            <Empty title="No bookings" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Service</th>
                    <th>Customer</th>
                    <th>Provider</th>
                    <th>When</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.bookings.map((b) => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.serviceTitle}</td>
                      <td>{b.customer?.name}</td>
                      <td>{b.provider.user?.name}</td>
                      <td>{fmtDateTime(b.startAt)}</td>
                      <td>{money(b.priceCents, b.currency)}</td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                      <td>
                        <button
                          className="btn small secondary"
                          onClick={async () =>
                            setDetail((await api<{ booking: Booking }>(`/bookings/${b.id}`)).booking)
                          }
                        >
                          History
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Wrap>
      {detail && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <div className="item">
            <h3>Booking #{detail.id} history</h3>
            <button className="btn small secondary" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
          <ul className="history">
            {detail.history?.map((h) => (
              <li key={h.id}>
                {fmtDateTime(h.createdAt)}: {h.fromStatus ? `${h.fromStatus} → ` : ""}
                {h.toStatus}
                {h.note ? ` (${h.note})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

interface Rv {
  id: number;
  rating: number;
  text: string;
  hidden: boolean;
  customer: { name: string };
}
function Reviews() {
  const r = useApi<{ reviews: Rv[] }>("/admin/reviews");
  return (
    <Wrap r={r}>
      {(d) =>
        d.reviews.length === 0 ? (
          <Empty title="No reviews yet" />
        ) : (
          <div className="list">
            {d.reviews.map((v) => (
              <div className="card item" key={v.id}>
                <div>
                  <strong>{v.customer.name}</strong> {"★".repeat(v.rating)}{" "}
                  {v.hidden && <span className="badge cancelled">hidden</span>}
                  <div>{v.text}</div>
                </div>
                <button
                  className="btn small secondary"
                  onClick={async () => {
                    const reason = v.hidden
                      ? ""
                      : (prompt("Reason for hiding (recorded in the audit log)") ?? "");
                    await api(`/admin/reviews/${v.id}/hide`, { body: { hidden: !v.hidden, reason } });
                    r.reload();
                  }}
                >
                  {v.hidden ? "Restore" : "Hide"}
                </button>
              </div>
            ))}
          </div>
        )
      }
    </Wrap>
  );
}

interface Rp {
  id: number;
  targetType: string;
  targetId: number;
  reason: string;
  resolved: boolean;
  reporter: { name: string };
}
function Reports() {
  const r = useApi<{ reports: Rp[] }>("/admin/reports");
  return (
    <Wrap r={r}>
      {(d) =>
        d.reports.length === 0 ? (
          <Empty title="No reports" />
        ) : (
          <div className="list">
            {d.reports.map((p) => (
              <div className="card item" key={p.id}>
                <div>
                  <strong>
                    {p.targetType} #{p.targetId}
                  </strong>{" "}
                  reported by {p.reporter.name}
                  <div>{p.reason}</div>
                </div>
                {p.resolved ? (
                  <span className="badge completed">resolved</span>
                ) : (
                  <button
                    className="btn small"
                    onClick={async () => {
                      await api(`/admin/reports/${p.id}/resolve`, { method: "POST", body: {} });
                      r.reload();
                    }}
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      }
    </Wrap>
  );
}

function Audit() {
  const r = useApi<{
    logs: {
      id: number;
      action: string;
      targetType: string;
      targetId: number;
      detail: string;
      createdAt: string;
      actor: { name: string };
    }[];
  }>("/admin/audit-logs");
  return (
    <Wrap r={r}>
      {(d) =>
        d.logs.length === 0 ? (
          <Empty title="No admin actions recorded yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {d.logs.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtDateTime(l.createdAt)}</td>
                    <td>{l.actor.name}</td>
                    <td>{l.action}</td>
                    <td>
                      {l.targetType} #{l.targetId}
                    </td>
                    <td>{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </Wrap>
  );
}
