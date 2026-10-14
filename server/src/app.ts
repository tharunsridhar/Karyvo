import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { AppError } from "./lib/errors.js";
import { openapi } from "./openapi.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { bookingsRouter, notificationsRouter } from "./routes/bookings.js";
import { providerRouter } from "./routes/provider.js";
import { publicRouter } from "./routes/public.js";

export const logger = pino({
  level: config.env === "test" ? "silent" : "info",
  redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']", "password"],
});

export function createApp(opts: { authRateMax?: number } = {}) {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers["x-request-id"] as string) || randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "up" });
    } catch {
      res.status(503).json({ status: "degraded", db: "down" });
    }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.authRateMax ?? config.authRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try again later" } },
  });
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);

  app.use("/api/auth", authRouter());
  app.use("/api", publicRouter());
  app.use("/api/provider", providerRouter());
  app.use("/api/bookings", bookingsRouter());
  app.use("/api/notifications", notificationsRouter());
  app.use("/api/admin", adminRouter());

  app.get("/api/openapi.json", (_req, res) => res.json(openapi));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));

  // In production the API also serves the built frontend (single deployable).
  if (config.webDist && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get(/^\/(?!api\/|health).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const requestId = String(req.id ?? "");
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Validation failed", requestId } });
      return;
    }
    if ((err as { type?: string }).type === "entity.parse.failed") {
      res
        .status(400)
        .json({ error: { code: "BAD_JSON", message: "Request body is not valid JSON", requestId } });
      return;
    }
    req.log.error({ err: { message: err.message, stack: err.stack } }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", requestId } });
  };
  app.use(onError);

  return app;
}
