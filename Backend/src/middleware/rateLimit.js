/* ============================================================
   src/middleware/rateLimit.js — Abuse throttles

   Three tiers, because the endpoints have very different risk:
     * loginLimiter  — credential stuffing is the threat, so this is
                       the tightest, and it counts only failures so a
                       busy honest user is never locked out.
     * writeLimiter  — uploads and other writes: expensive, but normal.
     * apiLimiter    — a broad ceiling for everything else.
============================================================ */

"use strict";

const rateLimit = require("express-rate-limit");
const config = require("../config/env");

/** Shared JSON shape so throttled responses look like every other error. */
function handler(req, res) {
  res.status(429).json({
    success: false,
    message: "Too many requests. Please wait a moment and try again.",
  });
}

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
};

/* Rate limits are a nuisance while developing against the API,
   so they are relaxed (not removed) outside production. */
const scale = config.isProd ? 1 : 10;

const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 600 * scale,
});

const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 8 * scale,
  skipSuccessfulRequests: true,
  handler(req, res) {
    res.status(429).json({
      success: false,
      message:
        "Too many failed sign-in attempts. Please wait 15 minutes before trying again, " +
        "or reset your password.",
    });
  },
});

const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5 * scale,
});

const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10 * scale,
});

const writeLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 120 * scale,
});

module.exports = {
  apiLimiter,
  loginLimiter,
  passwordResetLimiter,
  registerLimiter,
  writeLimiter,
};
