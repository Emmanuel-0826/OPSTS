/* ============================================================
   src/middleware/auth.js — JWT authentication & role guards

   The token carries only an id, role and token version. Every
   protected request re-reads the user row, so a suspended or
   deleted account loses access immediately instead of staying
   valid until the token expires.
============================================================ */

"use strict";

const jwt = require("jsonwebtoken");
const config = require("../config/env");
const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toUser } = require("../utils/presenters");

/**
 * Issue a signed token for a user row.
 * Short-lived by design; the frontend keeps it in sessionStorage,
 * so it dies with the tab as well as with the clock.
 */
function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.token_version },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn, issuer: "opsts-api" }
  );
}

function extractToken(req) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Require a valid token. Populates req.user with the live database
 * row (snake_case) and req.currentUser with the API shape.
 */
const requireAuth = catchAsync(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized("Authentication required. Please sign in.");

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, { issuer: "opsts-api" });
  } catch (err) {
    const message =
      err.name === "TokenExpiredError"
        ? "Your session has expired. Please sign in again."
        : "Your session is no longer valid. Please sign in again.";
    throw ApiError.unauthorized(message);
  }

  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, role, status, department,
            index_number, staff_id, level, specialization, token_version,
            must_change_password,
            created_at, last_login_at
       FROM users
      WHERE id = $1`,
    [payload.sub]
  );

  const user = rows[0];
  if (!user) throw ApiError.unauthorized("Your account no longer exists.");

  /* Password changes bump token_version, which retires every token
     minted before the change. */
  if (Number(user.token_version) !== Number(payload.tv)) {
    throw ApiError.unauthorized("Your session has ended. Please sign in again.");
  }

  if (user.status !== "active") {
    throw ApiError.forbidden(
      user.status === "pending"
        ? "Your account is awaiting administrator approval."
        : "Your account has been suspended. Contact the administrator."
    );
  }

  req.user = user;
  req.currentUser = toUser(user);
  next();
});

/**
 * Restrict a route to one or more roles. Always used after requireAuth.
 * @param {...('student'|'supervisor'|'admin')} roles
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden("This action is only available to " + roles.join(" or ") + " accounts.")
      );
    }
    next();
  };
}

module.exports = { issueToken, requireAuth, requireRole };
