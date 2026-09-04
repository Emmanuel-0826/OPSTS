/* ============================================================
   src/controllers/authController.js — Requirement 1

   Registration, login, logout, password reset, change password.

   Two security decisions run through the whole file:

     * No user enumeration. Login and forgot-password give the same
       answer whether or not the address exists, so the endpoints
       cannot be used to harvest a list of valid accounts.
     * Self-service accounts start `pending`. A stranger who
       registers cannot see a single project until an administrator
       approves them, which is what makes open registration safe.
============================================================ */

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("../config/env");
const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toUser } = require("../utils/presenters");
const { issueToken } = require("../middleware/auth");
const notifications = require("../services/notificationService");
const email = require("../services/email");

const USER_COLUMNS = `
  id, first_name, last_name, email, role, status, department,
  index_number, staff_id, level, specialization, token_version,
  must_change_password, proposed_topic,
  created_at, last_login_at`;

/* Hashing a throwaway string when no user matches keeps the response
   time for "unknown email" close to "wrong password", so timing does
   not leak which addresses are registered. */
const DUMMY_HASH = bcrypt.hashSync("opsts-timing-equaliser", 10);

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* ══════════════════════════════════════
   POST /api/auth/register
   Self-service sign-up for students and supervisors.
══════════════════════════════════════ */
const register = catchAsync(async (req, res) => {
  const { role, firstName, lastName, email: address, password, department } = req.body;

  if (role !== "student" && role !== "supervisor") {
    throw ApiError.badRequest("You can only register as a student or a supervisor.");
  }

  const indexNumber = role === "student" ? (req.body.indexNumber || "").trim() : null;
  const staffId = role === "supervisor" ? (req.body.staffId || "").trim() : null;

  /* The student's own words for what they intend to work on. It
     becomes the title and topic of the project shell the moment
     the account is approved, so nobody has to re-enter it. */
  const projectTopic = role === "student" ? (req.body.projectTopic || "").trim() : null;

  if (role === "student" && !indexNumber) {
    throw ApiError.badRequest("Your student index number is required.");
  }
  if (role === "supervisor" && !staffId) {
    throw ApiError.badRequest("Your staff ID is required.");
  }
  if (role === "student" && !projectTopic) {
    throw ApiError.badRequest("Please describe your project topic.");
  }

  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

  const created = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users
         (first_name, last_name, email, password_hash, role, status,
          department, index_number, staff_id, level, proposed_topic)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
       RETURNING ${USER_COLUMNS}`,
      [
        firstName,
        lastName,
        address,
        passwordHash,
        role,
        department || null,
        indexNumber || null,
        staffId || null,
        role === "student" ? "Level 400" : null,
        projectTopic || null,
      ]
    );

    const user = rows[0];

    await notifications.notifyAdmins(client, {
      type: "system",
      message:
        `${user.first_name} ${user.last_name} registered as a ${role} and is awaiting approval.` +
        (projectTopic ? ` Proposed topic: "${projectTopic}".` : ""),
      link: "users.html",
    });

    return user;
  });

  res.status(201).json({
    success: true,
    message:
      "Account created. An administrator will review your registration — " +
      "you will be able to sign in once it is approved.",
    user: toUser(created),
  });
});

/* ══════════════════════════════════════
   POST /api/auth/login
══════════════════════════════════════ */
const login = catchAsync(async (req, res) => {
  const { email: address, password, role } = req.body;

  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [address]
  );
  const user = rows[0];

  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  /* One message for "no such user", "wrong password" and "wrong role
     tab": each of these individually would tell an attacker something. */
  if (!user || !passwordMatches || (role && user.role !== role)) {
    throw ApiError.unauthorized("Incorrect email, password, or role. Please try again.");
  }

  if (user.status === "pending") {
    throw ApiError.forbidden(
      "Your account has not been approved yet. Please contact your administrator."
    );
  }
  if (user.status === "suspended") {
    throw ApiError.forbidden("Your account has been suspended. Please contact your administrator.");
  }

  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  delete user.password_hash;

  res.json({
    success: true,
    message: "Signed in successfully.",
    token: issueToken(user),
    user: toUser({ ...user, last_login_at: new Date() }),
  });
});

/* ══════════════════════════════════════
   GET /api/auth/me
   Lets a client re-hydrate the session without a fresh login.
══════════════════════════════════════ */
const me = catchAsync(async (req, res) => {
  res.json({ success: true, user: req.currentUser });
});

/* ══════════════════════════════════════
   POST /api/auth/logout
   Tokens are stateless, so "logging out" is a client-side discard.
   This endpoint exists so the client has one call to make, and so
   `all: true` can retire every token the account has issued.
══════════════════════════════════════ */
const logout = catchAsync(async (req, res) => {
  if (req.body && req.body.all === true) {
    await db.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [
      req.user.id,
    ]);
    return res.json({ success: true, message: "Signed out on all devices." });
  }
  res.json({ success: true, message: "Signed out." });
});

/* ══════════════════════════════════════
   POST /api/auth/change-password
══════════════════════════════════════ */
const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (!rows[0]) throw ApiError.unauthorized("Your account no longer exists.");

  const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!matches) throw ApiError.badRequest("Your current password is incorrect.");

  if (currentPassword === newPassword) {
    throw ApiError.badRequest("Your new password must be different from your current one.");
  }

  const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);

  /* Bumping token_version retires every existing token, including the
     one making this request — a stolen token stops working the moment
     the real owner changes their password. The client is handed a
     fresh one below so the user is not bounced to the login screen.

     must_change_password clears here too: the owner has now chosen
     their own password, so the "initial password" prompt no longer
     applies. */
  await db.query(
    `UPDATE users
        SET password_hash = $2,
            token_version = token_version + 1,
            must_change_password = FALSE,
            reset_token_hash = NULL,
            reset_token_expires_at = NULL
      WHERE id = $1`,
    [req.user.id, passwordHash]
  );

  const refreshed = { ...req.user, token_version: Number(req.user.token_version) + 1 };

  res.json({
    success: true,
    message: "Password changed successfully.",
    token: issueToken(refreshed),
  });
});

/* ══════════════════════════════════════
   POST /api/auth/forgot-password
══════════════════════════════════════ */
const forgotPassword = catchAsync(async (req, res) => {
  const { email: address } = req.body;

  /* Identical response in every case — found, not found, or inactive. */
  const genericResponse = {
    success: true,
    message:
      "If an account exists for that email address, a password reset link has been sent to it.",
  };

  const { rows } = await db.query(
    "SELECT id, first_name, last_name, email, status FROM users WHERE email = $1",
    [address]
  );
  const user = rows[0];

  if (!user || user.status !== "active") {
    return res.json(genericResponse);
  }

  /* The raw token goes in the email; only its hash is stored, so a
     database leak does not hand over working reset links. */
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.auth.resetTtlMinutes * 60 * 1000);

  await db.query(
    "UPDATE users SET reset_token_hash = $2, reset_token_expires_at = $3 WHERE id = $1",
    [user.id, hashResetToken(token), expiresAt]
  );

  await email.passwordReset({
    to: user.email,
    name: user.first_name,
    token,
  });

  res.json(genericResponse);
});

/* ══════════════════════════════════════
   POST /api/auth/reset-password
══════════════════════════════════════ */
const resetPassword = catchAsync(async (req, res) => {
  const { token, newPassword } = req.body;

  const { rows } = await db.query(
    `SELECT id, email, first_name FROM users
      WHERE reset_token_hash = $1
        AND reset_token_expires_at IS NOT NULL
        AND reset_token_expires_at > now()`,
    [hashResetToken(token)]
  );
  const user = rows[0];

  if (!user) {
    throw ApiError.badRequest(
      "That password reset link is invalid or has expired. Please request a new one."
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);

  await db.query(
    `UPDATE users
        SET password_hash = $2,
            token_version = token_version + 1,
            must_change_password = FALSE,
            reset_token_hash = NULL,
            reset_token_expires_at = NULL
      WHERE id = $1`,
    [user.id, passwordHash]
  );

  res.json({
    success: true,
    message: "Your password has been reset. You can now sign in with your new password.",
  });
});

module.exports = {
  register,
  login,
  me,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
};
