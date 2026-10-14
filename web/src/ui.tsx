import { Component, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ApiError } from "./api";
import { useAuth } from "./auth";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton-wrap" role="status" aria-live="polite" aria-label={label}>
      <div className="skeleton" />
      <div className="skeleton short" />
      <div className="skeleton" />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "Something went wrong";
  return (
    <div className="alert error" role="alert">
      <span>{msg}</span>
      {retry && (
        <button className="btn small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function FieldErrors({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="alert error" role="alert">
      <div>
        {e.message}
        {e.details && e.details.length > 0 && (
          <ul>
            {e.details.map((d, i) => (
              <li key={i}>
                {d.field ? `${d.field}: ` : ""}
                {d.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase()}`}>{status.replace("_", " ").toLowerCase()}</span>;
}

export function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">No reviews yet</span>;
  return (
    <span aria-label={`${value} out of 5`}>
      <span className="stars">
        {"★".repeat(Math.round(value))}
        {"☆".repeat(5 - Math.round(value))}
      </span>{" "}
      {value}
    </span>
  );
}

export function RequireRole({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <Empty
        title="You do not have access to this page"
        action={
          <Link className="btn" to="/">
            Go home
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="container">
          <Empty
            title="Something went wrong"
            hint="An unexpected error occurred in the app."
            action={
              <button className="btn" onClick={() => window.location.assign("/")}>
                Reload
              </button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
