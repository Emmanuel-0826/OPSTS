# OPSTS Backend

REST API for the Online Project Supervision and Tracking System — Node.js,
Express 5, and PostgreSQL. Built to sit behind the existing static
`Frontend/` portal with no changes to the frontend's API contract
(`js/api.js`, `Api.baseUrl = "http://localhost:5000/api"`).

## Requirements

- Node.js ≥ 18
- PostgreSQL ≥ 13 (uses `gen_random_uuid()`, built in since PG13)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` — or the discrete `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` fields.
- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  In development the server generates a temporary one and warns if this is
  left blank; in production it refuses to start.
- `CORS_ORIGINS` — comma-separated list of origins allowed to call the API
  (e.g. wherever you serve `Frontend/` from). Left empty, development allows
  any origin and production refuses all cross-origin calls.
- `EMAIL_*` / `ZOOM_*` are optional. Without them the API still works fully;
  it logs emails instead of sending them, and meetings are scheduled without
  an auto-generated Zoom link.

Create the database and role (adjust to your local Postgres setup):

```sql
CREATE ROLE opsts_app LOGIN PASSWORD 'opsts_dev_password';
CREATE DATABASE opsts OWNER opsts_app ENCODING 'UTF8';
```

Run migrations (also runs automatically on `npm start`/`npm run dev`):

```bash
npm run migrate
```

### The first administrator

There is no admin self-registration — the role can only be created from the
server. The first time the API starts against a database with **no
administrator in it**, it seeds one automatically:

| | |
|---|---|
| **Email** | `admin@opsts.local` |
| **Password** | `Admin@OPSTS2026` |

Sign in with those, then change the password immediately
(**Profile → Change Password**). Until you do, the API logs a warning on
every boot and the portal shows a reminder on sign-in.

Override the seeded values with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`
(plus optional `DEFAULT_ADMIN_FIRST_NAME`, `_LAST_NAME`, `_STAFF_ID`) in `.env`.

Three things stop this from being a backdoor:

- It only runs when **no** administrator exists. It never resets or
  "repairs" an existing account, so it cannot be used to regain access to a
  live system.
- The seeded account is flagged `must_change_password`; the flag clears the
  moment a real password is set, and is reported to the client until then.
- **In production the built-in password is refused.** `DEFAULT_ADMIN_PASSWORD`
  must be set explicitly, or the API starts with no admin and tells you to
  run `create-admin`.

To create an administrator manually at any time:

```bash
npm run create-admin -- --email admin@yourschool.edu --password "Change-Me-123" \
  --first Ama --last Owusu
```

Add `--must-change` when the password is a shared or documented one, so the
owner is prompted to replace it.

Start the API:

```bash
npm run dev     # nodemon, restarts on change
npm start       # plain node
```

Serve the frontend on any static server (it's already a complete site,
just no build step) and point `API_BASE_URL` in `Frontend/js/api.js` at
this server if you're not using the default `http://localhost:5000/api`.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run migrate` | Apply any pending SQL migrations |
| `npm run create-admin` | Bootstrap the first admin account |
| `npm run seed-demo` | Populate one supervisor + three students with submissions, feedback, meetings — via the live API |
| `npm run smoke` | End-to-end test: register → approve → assign → submit → review → track → meet → notify → report, against the running API |

## Architecture

```
src/
  config/       env loader (validates & freezes config), pg pool
  db/           SQL migrations + the runner that applies them
  middleware/   auth (JWT), validation, uploads, rate limiting, error handling
  controllers/  one file per resource — request in, presenter-shaped JSON out
  services/     things that aren't simple CRUD: progress calculation,
                notifications, email, Zoom meeting links
  routes/       thin: auth guard → validation chain → controller
  utils/        ApiError, presenters (DB row → API shape), chapter constants
  scripts/      createAdmin, seedDemo, smokeTest
```

**Data model.** One project per student (enforced by a unique constraint),
five fixed chapters (`src/utils/chapters.js`, mirrors `Frontend/js/data.js`
`DB_CHAPTERS`), submissions versioned per chapter, feedback tied 1:1 to a
submission, meetings with a participants join table, and a flat
notifications table the bell UI polls.

**Progress is derived, not stored by hand.** A project's completion
percentage, status, and milestone statuses are recalculated from the
submissions table (`services/progressService.js`) inside the same
transaction as whatever changed them — a new submission, a feedback
decision. There is no code path where a client can set completion
percentage directly; the rule (`approved chapters ÷ 5 × 100`) always holds.

**Access control is enforced in SQL, not just in a `requireRole` check.**
A student's queries filter by their own id in the `WHERE` clause; a
supervisor's filter by their assignment. There's no code path where another
user's row is loaded into memory and relies on a later check to stay hidden.

**File uploads never touch the filesystem with a client-supplied name.**
Stored under a random filename in `uploads/` (outside anything served by
URL); downloads are streamed back through an authenticated, ownership-
checked route, never a static file handler.

**Self-service registration starts `pending`.** A student or supervisor who
registers cannot see a single project until an administrator approves them
— `PATCH /api/users/:id/approve`. Administrator accounts are never created
through the API; only `npm run create-admin`.

## API summary

All routes are under `/api`. Authenticated routes expect
`Authorization: Bearer <token>`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/forgot-password`, `/reset-password`, `/change-password`, `GET /auth/me`, `POST /auth/logout` |
| Users | `GET/POST /users`, `GET/PUT/DELETE /users/:id`, `PATCH /users/:id/approve`, `GET /users/supervisor/:id/students` |
| Projects | `GET/POST /projects`, `GET/PUT/DELETE /projects/:id`, `POST /projects/assign-supervisor`, `GET /projects/milestones/:projectId`, `PUT /projects/milestones/:id` |
| Submissions | `GET/POST /submissions`, `GET/DELETE /submissions/:id`, `GET /submissions/:id/download`, `POST /submissions/:id/reopen` |
| Feedback | `GET/POST /feedback`, `GET /feedback/:id` |
| Meetings | `GET/POST /meetings`, `POST /meetings/request`, `PUT/DELETE /meetings/:id` |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id` |
| Reports | `GET /reports/summary`, `/completion`, `/projects`, `/workload`, `/deadlines`, `GET /reports/export/:type` (all admin only) |
| Reference | `GET /health`, `GET /chapters` (public) |

Every response is JSON: `{ success: boolean, message?, ...payload }`. Errors
always carry a `message` safe to show a user directly — this is what
`Frontend/js/api.js` surfaces in toasts and alerts.
