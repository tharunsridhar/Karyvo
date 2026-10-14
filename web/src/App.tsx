import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import Admin from "./pages/Admin";
import { Login, Register } from "./pages/AuthPages";
import { Home, ServiceDetail, Services } from "./pages/Browse";
import { MyBookings, Notifications } from "./pages/Customer";
import Provider from "./pages/Provider";
import { Empty, RequireRole, StatusBanner } from "./ui";

function Nav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    const poll = () =>
      api<{ unread: number }>("/notifications")
        .then((r) => live && setUnread(r.unread))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [user]);

  return (
    <header className="nav">
      <nav className="nav-inner" aria-label="Main">
        <Link to="/" className="logo">
          FixItBro
        </Link>
        <NavLink className="link" to="/services">
          Find services
        </NavLink>
        {user?.role === "PROVIDER" && (
          <NavLink className="link" to="/provider">
            Provider portal
          </NavLink>
        )}
        {user?.role === "ADMIN" && (
          <NavLink className="link" to="/admin">
            Admin
          </NavLink>
        )}
        {user && user.role !== "ADMIN" && (
          <NavLink className="link" to="/bookings">
            My bookings
          </NavLink>
        )}
        {user ? (
          <>
            <NavLink className="link" to="/notifications">
              Notifications
              {unread > 0 && (
                <span className="count" aria-label={`${unread} unread`}>
                  {unread}
                </span>
              )}
            </NavLink>
            <span className="muted small-text">{user.name}</span>
            <button
              className="link"
              onClick={async () => {
                await logout();
                nav("/");
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <NavLink className="link" to="/login">
              Sign in
            </NavLink>
            <Link className="btn small" to="/register">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

function NotFound() {
  return (
    <div className="container">
      <Empty
        title="404: page not found"
        hint="That page does not exist."
        action={
          <Link className="btn" to="/">
            Back to home
          </Link>
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <StatusBanner />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:id" element={<ServiceDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/bookings"
            element={
              <RequireRole>
                <MyBookings />
              </RequireRole>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireRole>
                <Notifications />
              </RequireRole>
            }
          />
          <Route
            path="/provider"
            element={
              <RequireRole roles={["PROVIDER"]}>
                <Provider />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={["ADMIN"]}>
                <Admin />
              </RequireRole>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer>FixItBro demo project. Not a real marketplace.</footer>
    </>
  );
}
