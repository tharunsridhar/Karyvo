import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { conflict, forbidden, unauthorized } from "../lib/errors.js";
import { parse, wrap } from "../lib/http.js";
import { assertCapacity } from "../services/demoGuard.js";
import { isValidTimezone } from "../lib/slots.js";
import { COOKIE, cookieOptions, me, requireAuth, signToken } from "../middleware/auth.js";
import type { User } from "@prisma/client";

export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  role: z.enum(["CUSTOMER", "PROVIDER"]).default("CUSTOMER"),
  timezone: z.string().optional(),
  city: z.string().trim().max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export function authRouter() {
  const r = Router();

  r.post(
    "/register",
    wrap(async (req, res) => {
      const body = parse(registerSchema, req.body);
      if (body.timezone && !isValidTimezone(body.timezone)) {
        throw conflict("Unknown timezone", "BAD_TIMEZONE");
      }
      if (await prisma.user.findUnique({ where: { email: body.email } })) {
        throw conflict("An account with this email already exists", "EMAIL_TAKEN");
      }
      await assertCapacity("users");
      const passwordHash = await bcrypt.hash(body.password, 10);
      const user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash,
          role: body.role,
          provider:
            body.role === "PROVIDER"
              ? { create: { timezone: body.timezone ?? "UTC", city: body.city ?? "" } }
              : undefined,
        },
      });
      res.cookie(COOKIE, signToken(user.id), cookieOptions());
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  r.post(
    "/login",
    wrap(async (req, res) => {
      const body = parse(loginSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      // Same error for unknown email and wrong password to avoid account enumeration.
      const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
      if (!user || !ok) throw unauthorized("Incorrect email or password");
      if (user.status !== "ACTIVE") throw forbidden("This account is suspended");
      res.cookie(COOKIE, signToken(user.id), cookieOptions());
      res.json({ user: publicUser(user) });
    }),
  );

  r.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.status(204).end();
  });

  r.get(
    "/me",
    requireAuth,
    wrap(async (req, res) => {
      res.json({ user: publicUser(me(req)) });
    }),
  );

  return r;
}
