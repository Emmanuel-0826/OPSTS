/* ============================================================
   src/server.js — Process entry point

   Boot order: config (validated on require) → database check →
   migrations → default admin → HTTP listener → reminder sweep.
   If the database is unreachable or a migration fails, the
   process exits non-zero rather than serving errors.
============================================================ */

"use strict";

const config = require("./config/env");
const db = require("./config/db");
const { migrate } = require("./db/migrate");
const reminders = require("./services/reminderService");
const bootstrap = require("./services/bootstrap");

async function start() {
  /* Fail fast if Postgres is down — every request needs it. */
  const info = await db.assertConnection();
  // eslint-disable-next-line no-console
  console.log(`[db] connected to "${info.db}"`);

  await migrate();

  /* A fresh database has no accounts and no admin self-registration,
     so seed one administrator to sign in with. No-op once one exists. */
  await bootstrap.ensureDefaultAdmin();
  await bootstrap.warnAboutDefaultCredentials();

  /* Say plainly, once, whether mail can leave the building.

     Every email in this app is deliberately fire-and-forget: the
     account approval, the feedback, the meeting invite and the
     submission receipt all commit first and mail afterwards, and
     none of them fail if the mail does. That is the right trade —
     but it also means an unconfigured SMTP host is completely
     silent at the point of use. Every action reports success and
     nothing is ever delivered. Print the state at boot so the
     answer to "why did nobody get an email?" is in the log. */
  const email = require("./services/email");
  // eslint-disable-next-line no-console
  console.log(
    email.isConfigured
      ? `[email] SMTP configured (${config.email.host}:${config.email.port}) — notification emails will be sent`
      : "[email] SMTP not configured (EMAIL_HOST/EMAIL_USER are unset) — " +
        "notification emails will be logged to this console, not delivered"
  );

  /* Require the app only after the database is known-good, so a
     boot-time crash is always a clear config/db message. */
  const app = require("./app");

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] OPSTS API listening on http://localhost:${config.port} (${config.env})`
    );
  });

  reminders.start();

  /* ── Graceful shutdown ────────────────────────────────────
     Stop accepting connections, let in-flight requests finish,
     then release the pool. A second signal forces exit. */
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;

    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received — shutting down`);
    reminders.stop();

    server.close(async () => {
      try {
        await db.close();
      } finally {
        process.exit(0);
      }
    });

    /* Failsafe: never hang on a stuck connection. */
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/* Crash visibly on programmer errors instead of limping on with
   unknown state; a supervisor (nodemon/pm2/systemd) restarts us. */
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[fatal] unhandled rejection:", reason);
  process.exit(1);
});

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[fatal] failed to start:", err.message);
  process.exit(1);
});
