import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { FieldErrors } from "../ui";

function useAfterAuth() {
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  return (role: string) =>
    nav(from ?? (role === "PROVIDER" ? "/provider" : role === "ADMIN" ? "/admin" : "/services"), {
      replace: true,
    });
}

const DEMO_PASSWORD = "Password123!";
const DEMO_ACCOUNTS = [
  { role: "Customer", username: "customer@karyvo.test" },
  { role: "Provider", username: "provider@karyvo.test" },
  { role: "Admin", username: "admin@karyvo.test" },
];

export function Login() {
  const { login } = useAuth();
  const after = useAfterAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      after((await login(email, password)).role);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>Sign in</h1>
      <form className="card" onSubmit={submit}>
        <FieldErrors error={error} />
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p>
        New here? <Link to="/register">Create an account</Link>
      </p>
      <section className="card demo" aria-labelledby="demo-title">
        <h2 id="demo-title">Demo accounts</h2>
        <p className="muted small-text">Fake data for trying the app. Click Use to fill the form.</p>
        <div className="list">
          {DEMO_ACCOUNTS.map((a) => (
            <div className="item" key={a.username}>
              <div>
                <strong>{a.role}</strong>
                <div className="small-text">
                  Username: <code>{a.username}</code>
                </div>
                <div className="small-text">
                  Password: <code>{DEMO_PASSWORD}</code>
                </div>
              </div>
              <button
                type="button"
                className="btn small secondary"
                onClick={() => {
                  setEmail(a.username);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                Use
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const after = useAfterAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "CUSTOMER",
    city: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...form };
      if (form.role !== "PROVIDER") {
        delete body.city;
        delete body.timezone;
      }
      after((await register(body)).role);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>Create your account</h1>
      <form className="card" onSubmit={submit}>
        <FieldErrors error={error} />
        <label>
          Full name
          <input required minLength={2} autoComplete="name" value={form.name} onChange={set("name")} />
        </label>
        <label>
          Email
          <input type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </label>
        <label>
          Password (8+ characters)
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
          />
        </label>
        <label>
          I want to
          <select value={form.role} onChange={set("role")}>
            <option value="CUSTOMER">Book services</option>
            <option value="PROVIDER">Offer services</option>
          </select>
        </label>
        {form.role === "PROVIDER" && (
          <>
            <label>
              City
              <input value={form.city} onChange={set("city")} />
            </label>
            <label>
              Timezone
              <input value={form.timezone} onChange={set("timezone")} list="tzs" />
              <datalist id="tzs">
                {Intl.supportedValuesOf("timeZone").map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
          </>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Creating..." : "Sign up"}
        </button>
      </form>
      <p>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
