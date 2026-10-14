# Local Services Booking Platform --- TODO

A full-stack web application where customers discover local service
providers, book appointments, and manage bookings. Providers manage
their availability and jobs; administrators manage users, services, and
disputes.

## Project goal

Build a reliable, demonstrable MVP first. Prioritize correct booking and
availability logic over adding lots of features.

## Suggested stack

-   [ ] Frontend: React + TypeScript
-   [ ] Backend: Node.js + Express + TypeScript
-   [ ] Database: PostgreSQL
-   [ ] Database access: Prisma (or another ORM, used consistently)
-   [ ] Authentication: secure cookie-based sessions or JWT in secure
    cookies
-   [ ] Validation: Zod (or equivalent shared/request validation)
-   [ ] Testing: Vitest/Jest + API integration tests
-   [ ] API documentation: OpenAPI/Swagger
-   [ ] Deployment: deploy frontend, API, and PostgreSQL database
-   [ ] Optional later: Redis for caching/queues, email provider for
    notifications

## Phase 1 --- Define scope and setup

-   [ ] Write a short README describing the problem, target users, and
    MVP.
-   [ ] Define three roles: customer, provider, administrator.
-   [ ] Define initial service categories (for example, plumbing,
    electrical, cleaning, pest control).
-   [ ] Define booking states and allowed transitions before
    implementing them.
-   [ ] Create repository and sensible `.gitignore`.
-   [ ] Configure environment variables and provide `.env.example`
    without secrets.
-   [ ] Set up frontend and backend projects with TypeScript.
-   [ ] Configure formatting, linting, and basic CI checks.
-   [ ] Configure local PostgreSQL development database.
-   [ ] Add database migrations and a repeatable seed script.
-   [ ] Add a health-check endpoint such as `GET /health`.
-   [ ] Document local setup and run commands.

## Phase 2 --- Data model

-   [ ] Create `User` model with name, email, password hash, role,
    status, and timestamps.
-   [ ] Create `ProviderProfile` linked to a user.
-   [ ] Create `ServiceCategory`.
-   [ ] Create `Service` with provider, category, title, description,
    duration, price, and active status.
-   [ ] Create `ServiceArea` or a simple location/postcode field for
    provider coverage.
-   [ ] Create provider availability rules (weekday, start time, end
    time, timezone).
-   [ ] Create availability exceptions for days off and special hours.
-   [ ] Create `Booking` with customer, provider, service, start/end
    time, price snapshot, status, and timestamps.
-   [ ] Create `BookingStatusHistory` to record every status transition.
-   [ ] Create `Review` linked to a completed booking.
-   [ ] Add database constraints, foreign keys, indexes, and appropriate
    unique constraints.
-   [ ] Decide and document how currency, timezones, and timestamps are
    stored.
-   [ ] Add tests for important schema constraints.

## Phase 3 --- Authentication and authorization

-   [ ] Implement registration with server-side validation.
-   [ ] Implement login and logout.
-   [ ] Hash passwords with a suitable password-hashing library; never
    store plain-text passwords.
-   [ ] Implement authentication middleware.
-   [ ] Implement role-based authorization for customer, provider, and
    administrator routes.
-   [ ] Ensure users can only access their own bookings and profile
    data.
-   [ ] Ensure providers can only edit their own services and
    availability.
-   [ ] Add rate limiting to login and registration endpoints.
-   [ ] Handle expired/invalid sessions and authentication errors.
-   [ ] Test unauthorized and cross-user access attempts.

## Phase 4 --- Customer-facing website

-   [ ] Build responsive home page with service categories.
-   [ ] Build service listing page.
-   [ ] Add search by service name/category.
-   [ ] Add filters for location/service area, price range, and
    availability.
-   [ ] Add sorting and pagination.
-   [ ] Build provider profile and service detail pages.
-   [ ] Show service price, estimated duration, coverage area, and
    available slots.
-   [ ] Add clear loading, empty, and error states.
-   [ ] Make forms keyboard-accessible and provide useful validation
    messages.

## Phase 5 --- Provider portal

-   [ ] Build provider dashboard with upcoming and recent bookings.
-   [ ] Allow providers to create, edit, activate, and deactivate
    services.
-   [ ] Allow providers to configure weekly availability.
-   [ ] Allow providers to add days off and one-off availability
    exceptions.
-   [ ] Show a calendar or list of booked time slots.
-   [ ] Allow providers to accept or decline pending booking requests.
-   [ ] Allow providers to mark accepted jobs as in progress and
    completed.
-   [ ] Prevent providers from changing bookings that belong to other
    providers.
-   [ ] Show booking history and status-change timestamps.

## Phase 6 --- Booking and availability engine (core engineering work)

-   [ ] Implement an API that returns available slots for a service and
    date.
-   [ ] Calculate slot duration using the service duration and provider
    schedule.
-   [ ] Exclude slots outside working hours or inside provider time-off
    periods.
-   [ ] Exclude slots that overlap confirmed or otherwise blocking
    bookings.
-   [ ] Validate availability again on the server when a booking is
    submitted.
-   [ ] Do not trust availability calculated only by the frontend.
-   [ ] Use a database transaction and an appropriate concurrency-safe
    strategy to prevent double booking.
-   [ ] Add a database-level constraint or locking strategy where
    appropriate; document its limits.
-   [ ] Handle two customers attempting to book the same slot at nearly
    the same time.
-   [ ] Return a clear conflict response if a slot has already been
    taken.
-   [ ] Prevent duplicate booking submissions using an idempotency key
    or equivalent strategy.
-   [ ] Define booking expiration/timeout behavior if pending requests
    temporarily reserve slots.
-   [ ] Handle cancellation and release the slot according to the
    defined rules.
-   [ ] Handle provider schedule changes without silently invalidating
    existing bookings.
-   [ ] Add tests for adjacent slots, overlapping slots, time off, and
    daylight-saving/timezone edge cases where relevant.
-   [ ] Write a short technical note explaining how double booking is
    prevented.

## Phase 7 --- Booking lifecycle and business rules

-   [ ] Define allowed states, for example: `PENDING`, `ACCEPTED`,
    `DECLINED`, `CANCELLED`, `IN_PROGRESS`, `COMPLETED`.
-   [ ] Implement one centralized service for booking state transitions.
-   [ ] Reject invalid transitions (for example, completing a declined
    booking).
-   [ ] Define who may perform each transition.
-   [ ] Define cancellation rules and any cutoff window.
-   [ ] Record every state change in `BookingStatusHistory`.
-   [ ] Store a price snapshot on the booking so later service-price
    changes do not rewrite old bookings.
-   [ ] Ensure reviews can only be submitted for eligible completed
    bookings.
-   [ ] Add integration tests for the full booking lifecycle.

## Phase 8 --- Notifications

-   [ ] Notify the customer when a booking is created, accepted,
    declined, or cancelled.
-   [ ] Notify the provider about new booking requests and
    cancellations.
-   [ ] Start with in-app notifications; add email notifications if time
    permits.
-   [ ] Store notification status and creation time.
-   [ ] Avoid sending duplicate notifications for retried events.
-   [ ] If adding a background queue, make failed jobs retryable and
    observable.
-   [ ] Show notification history in the UI.

## Phase 9 --- Reviews and trust

-   [ ] Allow eligible customers to rate completed bookings.
-   [ ] Enforce one review per eligible booking.
-   [ ] Calculate provider rating from stored reviews.
-   [ ] Show review text, rating, and date.
-   [ ] Allow administrators to hide abusive or inappropriate reviews.
-   [ ] Document the moderation action in an audit log.

## Phase 10 --- Administrator tools

-   [ ] Build an admin dashboard with counts of users, providers,
    services, and bookings.
-   [ ] Search and inspect users and providers.
-   [ ] Activate or suspend an account.
-   [ ] Manage service categories.
-   [ ] Inspect bookings and their status histories.
-   [ ] Review reported services or reviews.
-   [ ] Record sensitive admin actions in an audit log.
-   [ ] Enforce administrator authorization on the backend, not only in
    the UI.

## Phase 11 --- Testing and reliability

-   [ ] Add unit tests for slot calculation and booking state
    transitions.
-   [ ] Add API integration tests for authentication, authorization, and
    booking workflows.
-   [ ] Add a test where two simultaneous requests target the same slot;
    only one may succeed.
-   [ ] Test duplicate submission and retry behavior.
-   [ ] Test cancellation, decline, and slot release.
-   [ ] Test attempts to access another user's booking.
-   [ ] Test invalid payloads and missing fields.
-   [ ] Add consistent error responses and avoid exposing stack traces
    to users.
-   [ ] Add structured server logging without passwords, tokens, or
    other secrets.
-   [ ] Add request IDs to help trace failures.
-   [ ] Add database backup/restore notes for the deployed demo.
-   [ ] Run a basic load test against slot search and booking creation.
-   [ ] Document known limitations honestly.

## Phase 12 --- UI polish and deployment

-   [ ] Make customer, provider, and admin views responsive.
-   [ ] Add skeleton/loading states, empty states, and retry actions.
-   [ ] Confirm forms show clear validation errors.
-   [ ] Add a 404 page and a general error page.
-   [ ] Add sample seed data and demo accounts without real personal
    data.
-   [ ] Deploy the frontend and backend.
-   [ ] Configure production environment variables and allowed origins.
-   [ ] Use HTTPS and secure cookie settings where applicable.
-   [ ] Run database migrations during deployment.
-   [ ] Verify the deployed app using a complete customer-to-provider
    booking flow.
-   [ ] Add screenshots and a short demo video to the README.
-   [ ] Publish API documentation.
-   [ ] Include architecture and booking-sequence diagrams.
-   [ ] Explain the concurrency strategy and its trade-offs in the
    README.

## Phase 13 --- Optional stretch features (only after the MVP works)

-   [ ] Payment sandbox integration with verified webhook handling.
-   [ ] Refund workflow for eligible cancellations.
-   [ ] Provider service-area map.
-   [ ] Calendar export using `.ics`.
-   [ ] Waitlist for unavailable time slots.
-   [ ] Provider analytics for bookings, cancellations, and revenue.
-   [ ] Redis caching for frequently requested service listings.
-   [ ] Background queue for reminders and email delivery.
-   [ ] Audit-log viewer for users and administrators.
-   [ ] Docker Compose for reproducible local development.

## MVP acceptance checklist

The MVP is ready to demonstrate when all of these are true:

-   [ ] A customer can register, sign in, search services, view a
    provider, and book an available slot.
-   [ ] A provider can configure availability and manage incoming
    bookings.
-   [ ] Two simultaneous attempts cannot successfully book the same
    provider/time slot.
-   [ ] A booking cannot be changed by an unrelated user.
-   [ ] Invalid status transitions are rejected by the backend.
-   [ ] Customers and providers receive visible booking status updates.
-   [ ] Core workflows have automated tests.
-   [ ] The deployed application works using documented demo accounts.
-   [ ] The README explains architecture, setup, test commands, and
    important trade-offs.

## Suggested build order

1.  Project setup and data model.
2.  Authentication and role permissions.
3.  Provider services and availability.
4.  Slot search and concurrency-safe booking creation.
5.  Booking lifecycle and cancellation.
6.  Customer/provider dashboards.
7.  Tests, notifications, deployment, and documentation.
8.  Reviews, admin features, and optional stretch work.

**Rule:** finish and test each phase before adding the next. A small,
reliable product is better than a large unfinished feature list.
