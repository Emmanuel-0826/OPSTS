/* ============================================================
   src/services/bootstrap.js — First-boot default administrator

   A fresh install has no accounts, and there is no admin
   self-registration — so without this there would be no way to
   sign in and approve the first user. This seeds one administrator
   the first time the API starts against an empty users table.

   Default credentials are a real weakness (a known password on a
   reachable host), so three things keep this honest:

     1. It only ever runs when the table contains NO administrator.
        It never resets or "repairs" an existing account, so it
        cannot be used to regain access to a live system.
     2. The seeded account is flagged must_change_password, the API
        reports that on every session, and the portal nudges the
        owner until it is cleared.
     3. In production the built-in password is refused outright.
        DEFAULT_ADMIN_PASSWORD must be set explicitly, or the API
        starts with no admin and tells the operator to run
        `npm run create-admin`.
============================================================ */

"use strict";

const bcrypt = require("bcryptjs");
const config = require("../config/env");
const db = require("../config/db");

/* Documented in README.md and .env.example. Development only. */
const BUILT_IN_EMAIL = "admin@opsts.local";
const BUILT_IN_PASSWORD = "Admin@OPSTS2026";

/**
 * Create the default administrator if no administrator exists.
 *
 * @returns {Promise<{created: boolean, email?: string, password?: string,
 *                    reason?: string}>}
 */
async function ensureDefaultAdmin({ log = console.log } = {}) {
  const { rows: existing } = await db.query(
    "SELECT count(*)::int AS n FROM users WHERE role = 'admin'"
  );

  if (existing[0].n > 0) {
    return { created: false, reason: "an administrator already exists" };
  }

  const email = (process.env.DEFAULT_ADMIN_EMAIL || BUILT_IN_EMAIL).trim().toLowerCase();
  const configuredPassword = process.env.DEFAULT_ADMIN_PASSWORD || "";

  /* Seeding a publicly documented password onto a production host is
     exactly the vulnerability this feature would otherwise create. */
  if (config.isProd && !configuredPassword) {
    log(
      "[bootstrap] No administrator exists and DEFAULT_ADMIN_PASSWORD is not set. " +
        "Refusing to seed the built-in default password in production.\n" +
        "            Create the first administrator with:\n" +
        "              npm run create-admin -- --email you@school.edu --password '<strong-password>'"
    );
    return { created: false, reason: "production requires an explicit DEFAULT_ADMIN_PASSWORD" };
  }

  const password = configuredPassword || BUILT_IN_PASSWORD;

  if (password.length < 8) {
    log("[bootstrap] DEFAULT_ADMIN_PASSWORD is shorter than 8 characters — not seeding.");
    return { created: false, reason: "DEFAULT_ADMIN_PASSWORD too short" };
  }

  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

  /* ON CONFLICT covers the case where the email is already taken by a
     non-admin account: better to do nothing than to fail the boot. */
  const { rows } = await db.query(
    `INSERT INTO users
       (first_name, last_name, email, password_hash, role, status,
        staff_id, department, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', 'active', $5, 'Administration', TRUE)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [
      process.env.DEFAULT_ADMIN_FIRST_NAME || "System",
      process.env.DEFAULT_ADMIN_LAST_NAME || "Administrator",
      email,
      passwordHash,
      process.env.DEFAULT_ADMIN_STAFF_ID || "ADMIN-001",
    ]
  );

  if (rows.length === 0) {
    log(
      `[bootstrap] Could not seed the default administrator: ${email} is already ` +
        "in use by a non-administrator account. Run `npm run create-admin` with a different email."
    );
    return { created: false, reason: "email already in use" };
  }

  /* Only echo the password when it is the built-in one — it is already
     public in the README. An operator-supplied secret is never logged. */
  const banner = [
    "",
    "  ┌──────────────────────────────────────────────────────────────┐",
    "  │  DEFAULT ADMINISTRATOR CREATED                               │",
    "  ├──────────────────────────────────────────────────────────────┤",
    `  │  Email     : ${email.padEnd(48)}│`,
    configuredPassword
      ? `  │  Password  : ${"(from DEFAULT_ADMIN_PASSWORD)".padEnd(48)}│`
      : `  │  Password  : ${password.padEnd(48)}│`,
    "  ├──────────────────────────────────────────────────────────────┤",
    "  │  Sign in, then change this password immediately:             │",
    "  │  Profile → Change Password                                   │",
    "  └──────────────────────────────────────────────────────────────┘",
    "",
  ].join("\n");

  log(banner);

  return { created: true, email, password: configuredPassword ? undefined : password };
}

/**
 * Warn at every boot while any account still has the password it was
 * given by someone else. A one-off message at creation time is easy
 * to miss; a warning on every restart is not.
 */
async function warnAboutDefaultCredentials({ log = console.warn } = {}) {
  const { rows } = await db.query(
    `SELECT email FROM users
      WHERE must_change_password = TRUE AND role = 'admin'
      ORDER BY created_at`
  );

  if (rows.length === 0) return 0;

  log(
    `[security] ${rows.length} administrator account(s) still use their ` +
      `initial password: ${rows.map((r) => r.email).join(", ")}. ` +
      "Sign in and change it (Profile → Change Password)."
  );
  return rows.length;
}

module.exports = {
  ensureDefaultAdmin,
  warnAboutDefaultCredentials,
  BUILT_IN_EMAIL,
  BUILT_IN_PASSWORD,
};
