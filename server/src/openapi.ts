const err = {
  description: "Error",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};
const ok = (description = "OK") => ({ description });
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const json = (schema: object) => ({ required: true, content: { "application/json": { schema } } });

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Mr Fix My Home API",
    version: "1.0.0",
    description:
      "Local services booking platform. Auth uses an httpOnly cookie (mrfixmyhome_token) set by /auth/login or /auth/register. Errors share one shape: { error: { code, message, details?, requestId } }.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "mrfixmyhome_token" } },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
              requestId: { type: "string" },
            },
          },
        },
      },
      BookingStatus: {
        type: "string",
        enum: ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "IN_PROGRESS", "COMPLETED", "EXPIRED"],
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        security: [],
        summary: "Register a customer or provider",
        requestBody: json({
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            password: { type: "string", minLength: 8 },
            role: { type: "string", enum: ["CUSTOMER", "PROVIDER"] },
            timezone: { type: "string" },
            city: { type: "string" },
          },
        }),
        responses: { 201: ok("Created, cookie set"), 400: err, 409: err, 429: err },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        security: [],
        summary: "Sign in",
        requestBody: json({
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string" }, password: { type: "string" } },
        }),
        responses: { 200: ok("Cookie set"), 401: err, 403: err, 429: err },
      },
    },
    "/auth/logout": { post: { tags: ["Auth"], summary: "Sign out", responses: { 204: ok() } } },
    "/auth/me": { get: { tags: ["Auth"], summary: "Current user", responses: { 200: ok(), 401: err } } },
    "/categories": {
      get: { tags: ["Catalogue"], security: [], summary: "List categories", responses: { 200: ok() } },
    },
    "/services": {
      get: {
        tags: ["Catalogue"],
        security: [],
        summary: "Search services",
        parameters: [
          "q",
          "categoryId",
          "postcode",
          "minPrice",
          "maxPrice",
          "date",
          "sort",
          "page",
          "pageSize",
        ].map((n) => ({ name: n, in: "query", schema: { type: "string" } })),
        responses: { 200: ok("Paged results") },
      },
    },
    "/services/{id}": {
      get: {
        tags: ["Catalogue"],
        security: [],
        summary: "Service detail",
        parameters: [idParam],
        responses: { 200: ok(), 404: err },
      },
    },
    "/services/{id}/slots": {
      get: {
        tags: ["Catalogue"],
        security: [],
        summary: "Available slots for a provider-local date",
        parameters: [
          idParam,
          { name: "date", in: "query", required: true, schema: { type: "string", example: "2026-11-02" } },
        ],
        responses: { 200: ok("ISO start times (UTC)"), 400: err, 404: err },
      },
    },
    "/providers/{id}": {
      get: {
        tags: ["Catalogue"],
        security: [],
        summary: "Provider profile and reviews",
        parameters: [idParam],
        responses: { 200: ok(), 404: err },
      },
    },
    "/bookings": {
      post: {
        tags: ["Bookings"],
        summary: "Request a booking",
        description:
          "Send an Idempotency-Key header to make retries safe. A repeated key returns the original booking with 200. A taken slot returns 409 SLOT_TAKEN or SLOT_UNAVAILABLE.",
        parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
        requestBody: json({
          type: "object",
          required: ["serviceId", "startAt"],
          properties: {
            serviceId: { type: "integer" },
            startAt: { type: "string", format: "date-time" },
            notes: { type: "string" },
          },
        }),
        responses: { 201: ok("Created"), 200: ok("Idempotent replay"), 400: err, 409: err },
      },
      get: {
        tags: ["Bookings"],
        summary: "My bookings (customer, or provider's own jobs)",
        responses: { 200: ok() },
      },
    },
    "/bookings/{id}": {
      get: {
        tags: ["Bookings"],
        summary: "Booking with status history",
        parameters: [idParam],
        responses: { 200: ok(), 404: err },
      },
    },
    "/bookings/{id}/transition": {
      post: {
        tags: ["Bookings"],
        summary: "Change booking state",
        description:
          "accept/decline/start/complete: provider. cancel: customer (24h cutoff once accepted), provider or admin.",
        parameters: [idParam],
        requestBody: json({
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["accept", "decline", "cancel", "start", "complete"] },
            note: { type: "string" },
          },
        }),
        responses: { 200: ok(), 403: err, 404: err, 409: err },
      },
    },
    "/bookings/{id}/review": {
      post: {
        tags: ["Reviews"],
        summary: "Review a completed booking (once)",
        parameters: [idParam],
        requestBody: json({
          type: "object",
          required: ["rating"],
          properties: { rating: { type: "integer", minimum: 1, maximum: 5 }, text: { type: "string" } },
        }),
        responses: { 201: ok(), 404: err, 409: err },
      },
    },
    "/notifications": {
      get: { tags: ["Notifications"], summary: "My notifications", responses: { 200: ok() } },
    },
    "/notifications/read-all": {
      post: { tags: ["Notifications"], summary: "Mark all read", responses: { 204: ok() } },
    },
    "/notifications/{id}/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark one read",
        parameters: [idParam],
        responses: { 204: ok(), 404: err },
      },
    },
    "/reports": {
      post: {
        tags: ["Reviews"],
        summary: "Report a service or review",
        requestBody: json({
          type: "object",
          required: ["targetType", "targetId", "reason"],
          properties: {
            targetType: { type: "string", enum: ["service", "review"] },
            targetId: { type: "integer" },
            reason: { type: "string" },
          },
        }),
        responses: { 201: ok(), 404: err },
      },
    },
    "/provider/profile": {
      get: { tags: ["Provider"], summary: "Own profile", responses: { 200: ok() } },
      put: {
        tags: ["Provider"],
        summary: "Update profile and coverage areas",
        responses: { 200: ok("Returns schedule conflicts") },
      },
    },
    "/provider/services": {
      get: { tags: ["Provider"], summary: "Own services", responses: { 200: ok() } },
      post: { tags: ["Provider"], summary: "Create service", responses: { 201: ok(), 400: err } },
    },
    "/provider/services/{id}": {
      patch: {
        tags: ["Provider"],
        summary: "Edit, activate or deactivate own service",
        parameters: [idParam],
        responses: { 200: ok(), 404: err },
      },
    },
    "/provider/availability": {
      get: { tags: ["Provider"], summary: "Weekly rules and exceptions", responses: { 200: ok() } },
      put: {
        tags: ["Provider"],
        summary: "Replace weekly rules. Existing bookings are kept; affected ones are returned as conflicts.",
        responses: { 200: ok() },
      },
    },
    "/provider/exceptions": {
      post: { tags: ["Provider"], summary: "Add day off or special hours", responses: { 201: ok() } },
    },
    "/provider/exceptions/{id}": {
      delete: {
        tags: ["Provider"],
        summary: "Remove exception",
        parameters: [idParam],
        responses: { 204: ok(), 404: err },
      },
    },
    "/admin/stats": { get: { tags: ["Admin"], summary: "Counts", responses: { 200: ok(), 403: err } } },
    "/admin/users": { get: { tags: ["Admin"], summary: "Search users", responses: { 200: ok() } } },
    "/admin/users/{id}/status": {
      patch: {
        tags: ["Admin"],
        summary: "Activate or suspend",
        parameters: [idParam],
        responses: { 200: ok() },
      },
    },
    "/admin/categories": {
      post: { tags: ["Admin"], summary: "Create category", responses: { 201: ok(), 409: err } },
    },
    "/admin/categories/{id}": {
      patch: { tags: ["Admin"], summary: "Rename category", parameters: [idParam], responses: { 200: ok() } },
      delete: {
        tags: ["Admin"],
        summary: "Delete unused category",
        parameters: [idParam],
        responses: { 204: ok(), 409: err },
      },
    },
    "/admin/bookings": { get: { tags: ["Admin"], summary: "All bookings", responses: { 200: ok() } } },
    "/admin/reviews": { get: { tags: ["Admin"], summary: "All reviews", responses: { 200: ok() } } },
    "/admin/reviews/{id}/hide": {
      post: {
        tags: ["Admin"],
        summary: "Hide or restore review (audited)",
        parameters: [idParam],
        responses: { 200: ok() },
      },
    },
    "/admin/reports": { get: { tags: ["Admin"], summary: "Reports", responses: { 200: ok() } } },
    "/admin/reports/{id}/resolve": {
      post: { tags: ["Admin"], summary: "Resolve report", parameters: [idParam], responses: { 204: ok() } },
    },
    "/admin/audit-logs": { get: { tags: ["Admin"], summary: "Audit log", responses: { 200: ok() } } },
  },
};
