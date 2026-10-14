import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { Role, User } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { wrap } from "../lib/http.js";

export const COOKIE = "fixitbro_token";

export function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure,
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  };
}

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

/** Loads the user from the DB on every request so suspensions take effect immediately. */
export const requireAuth: RequestHandler = wrap(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw unauthorized();
  let sub: number;
  try {
    sub = Number((jwt.verify(token, config.jwtSecret) as jwt.JwtPayload).sub);
  } catch {
    throw unauthorized("Session expired or invalid, please sign in again");
  }
  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user) throw unauthorized("Session expired or invalid, please sign in again");
  if (user.status !== "ACTIVE") throw forbidden("This account is suspended");
  req.user = user;
  next();
});

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export function me(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
