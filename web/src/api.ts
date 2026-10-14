import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { field: string; message: string }[];
  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      credentials: "include",
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (e?.code === "SERVER_FULL") window.dispatchEvent(new Event("mrfixmyhome:full"));
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? "Something went wrong", e?.details);
  }
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface ServiceItem {
  id: number;
  title: string;
  description: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  category: Category;
  provider: {
    id: number;
    name: string;
    city: string;
    areas: string[];
    rating: number | null;
    reviewCount: number;
    bio?: string;
    timezone?: string;
  };
}

export interface Booking {
  id: number;
  status: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  currency: string;
  serviceTitle: string;
  notes: string;
  customer?: { id: number; name: string };
  provider: { id: number; timezone?: string; user?: { name: string } };
  review?: { id: number; rating: number; text: string } | null;
  history?: { id: number; fromStatus: string | null; toStatus: string; note: string; createdAt: string }[];
}

export const money = (cents: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const fmtDateTime = (iso: string, tz?: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(
    new Date(iso),
  );

export const fmtTime = (iso: string, tz?: string) =>
  new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: tz }).format(new Date(iso));

export const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
