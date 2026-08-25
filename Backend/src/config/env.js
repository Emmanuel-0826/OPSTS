/* ============================================================
   src/config/env.js — Configuration loader & validator

   Reads .env once, validates everything the app depends on, and
   exposes a frozen config object. Fails loudly at boot rather
   than surfacing an undefined value halfway through a request.
============================================================ */

"use strict";

const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

/** Read an integer env var, falling back to a default. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer (got "${raw}").`);
  }
  return parsed;
}

/** Read a boolean env var ("true"/"1" are truthy). */
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

/* ── JWT secret ────────────────────────────────────────────
   In production a weak or missing secret is fatal: it would let
   anyone mint their own tokens. In development we generate an
   ephemeral one so a fresh clone runs without setup, at the cost
   of invalidating sessions on restart.                          */
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (isProd) {
    throw new Error(
      "JWT_SECRET is missing or shorter than 32 characters. Refusing to start in production."
    );
  }
  jwtSecret = crypto.randomBytes(48).toString("hex");
  // eslint-disable-next-line no-console
  console.warn(
    "[config] JWT_SECRET not set — generated a temporary one. " +
      "Sessions will not survive a restart. Set JWT_SECRET in .env."
  );
}

const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  port: int("PORT", 5000),

  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  db: Object.freeze({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || "127.0.0.1",
    port: int("PGPORT", 5432),
    database: process.env.PGDATABASE || "opsts",
    user: process.env.PGUSER || "opsts_app",
    password: process.env.PGPASSWORD || "",
    ssl: bool("PGSSL", false) ? { rejectUnauthorized: false } : false,
    maxPoolSize: int("PG_POOL_MAX", 10),
  }),

  auth: Object.freeze({
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
    bcryptRounds: int("BCRYPT_ROUNDS", 12),
    resetTtlMinutes: int("PASSWORD_RESET_TTL_MINUTES", 30),
  }),

  uploads: Object.freeze({
    dir: path.isAbsolute(process.env.UPLOAD_DIR || "")
      ? process.env.UPLOAD_DIR
      : path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads"),
    maxBytes: int("MAX_UPLOAD_MB", 20) * 1024 * 1024,
  }),

  email: Object.freeze({
    host: process.env.EMAIL_HOST || "",
    port: int("EMAIL_PORT", 587),
    secure: bool("EMAIL_SECURE", false),
    user: process.env.EMAIL_USER || "",
    pass: process.env.EMAIL_PASS || "",
    from: process.env.EMAIL_FROM || "OPSTS <no-reply@opsts.local>",
    appUrl: process.env.APP_URL || "http://localhost:5500",
  }),

  zoom: Object.freeze({
    accountId: process.env.ZOOM_ACCOUNT_ID || "",
    clientId: process.env.ZOOM_CLIENT_ID || "",
    clientSecret: process.env.ZOOM_CLIENT_SECRET || "",
  }),
});

module.exports = config;
