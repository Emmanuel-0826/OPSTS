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
