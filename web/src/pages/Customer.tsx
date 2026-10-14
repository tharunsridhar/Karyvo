import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, fmtDateTime, money, useApi, type Booking } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, StatusBadge } from "../ui";

export function BookingCard({
  b,
  onChange,
  mode,
}: {
  b: Booking;
  onChange: () => void;
  mode: "customer" | "provider";
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const tz = b.provider.timezone;

  async function act(action: string) {
    if (action === "cancel" && !confirm("Cancel this booking?")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/bookings/${b.id}/transition`, { body: { action } });
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setOpen(!open);
    if (!open && !detail) {
      try {
        setDetail((await api<{ booking: Booking }>(`/bookings/${b.id}`)).booking);
      } catch (e) {
        setError(e);
      }
    }
  }
  async function review(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/bookings/${b.id}/review`, { body: { rating, text } });
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const s = b.status;
  return (
    <div className="card">
      <div className="item">
        <div>
          <strong>{b.serviceTitle}</strong> <StatusBadge status={s} />
          <div className="muted small-text">
            {fmtDateTime(b.startAt, tz)} · {money(b.priceCents, b.currency)} ·{" "}
            {mode === "provider" ? `Customer: ${b.customer?.name}` : `Provider: ${b.provider.user?.name}`}
          </div>
          {b.notes && <div className="small-text">Notes: {b.notes}</div>}
        </div>
        <div className="actions">
          {mode === "provider" && s === "PENDING" && (
            <>
              <button className="btn small" disabled={busy} onClick={() => act("accept")}>
                Accept
              </button>
              <button className="btn small danger" disabled={busy} onClick={() => act("decline")}>
                Decline
              </button>
            </>
          )}
          {mode === "provider" && s === "ACCEPTED" && (
            <button className="btn small" disabled={busy} onClick={() => act("start")}>
              Start job
            </button>
          )}
          {mode === "provider" && s === "IN_PROGRESS" && (
            <button className="btn small" disabled={busy} onClick={() => act("complete")}>
              Mark completed
            </button>
          )}
          {(s === "PENDING" || s === "ACCEPTED") && (
            <button className="btn small secondary" disabled={busy} onClick={() => act("cancel")}>
              Cancel
            </button>
          )}
          <button className="btn small secondary" onClick={toggle} aria-expanded={open}>
            History
          </button>
        </div>
      </div>
      {!!error && <ErrorBox error={error} />}
      {open && (
        <ul className="history">
          {!detail && <li>Loading...</li>}
          {detail?.history?.map((h) => (
            <li key={h.id}>
              {fmtDateTime(h.createdAt)}: {h.fromStatus ? `${h.fromStatus} → ` : ""}
              {h.toStatus}
              {h.note ? ` (${h.note})` : ""}
            </li>
          ))}
        </ul>
      )}
      {mode === "customer" && s === "COMPLETED" && !b.review && (
        <form onSubmit={review} style={{ marginTop: ".75rem" }}>
          <div className="row">
            <label>
              Rating
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} star{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "3 1 220px" }}>
              Review
              <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
            </label>
            <button className="btn small" disabled={busy}>
              Leave review
            </button>
          </div>
        </form>
      )}
      {b.review && (
        <div className="small-text muted">
          Review: {"★".repeat(b.review.rating)} {b.review.text}
        </div>
      )}
    </div>
  );
}

export function MyBookings() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<{ bookings: Booking[] }>("/bookings");
  const mode = user?.role === "PROVIDER" ? "provider" : "customer";
  return (
    <div className="container">
      <h1>{mode === "provider" ? "Jobs booked with you" : "My bookings"}</h1>
      {loading && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      {data && data.bookings.length === 0 && (
        <Empty
          title="No bookings yet"
          action={
            <Link className="btn" to="/services">
              Find a service
            </Link>
          }
        />
      )}
      <div className="list">
        {data?.bookings.map((b) => (
          <BookingCard key={b.id} b={b} mode={mode} onChange={reload} />
        ))}
      </div>
    </div>
  );
}

interface Note {
  id: number;
  message: string;
  read: boolean;
  createdAt: string;
  bookingId: number | null;
}

export function Notifications() {
  const { data, error, loading, reload } = useApi<{ notifications: Note[]; unread: number }>(
    "/notifications",
  );
  return (
    <div className="container">
      <div className="item">
        <h1>Notifications</h1>
        {!!data?.unread && (
          <button
            className="btn small secondary"
            onClick={async () => {
              await api("/notifications/read-all", { method: "POST", body: {} });
              reload();
            }}
          >
            Mark all read
          </button>
        )}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      {data && data.notifications.length === 0 && (
        <Empty title="Nothing here yet" hint="Booking updates will show up here." />
      )}
      <div className="list">
        {data?.notifications.map((n) => (
          <div key={n.id} className={`card ${n.read ? "" : "unread"}`}>
            {n.message}
            <div className="muted small-text">{fmtDateTime(n.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
