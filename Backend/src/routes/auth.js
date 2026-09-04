/* ============================================================
   src/routes/auth.js — /api/auth
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { validate, rules, body } = require("../middleware/validate");
const { loginLimiter, registerLimiter, passwordResetLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post(
  "/register",
  registerLimiter,
  [
    body("role").isIn(["student", "supervisor"]).withMessage("Choose student or supervisor."),
    rules.name("firstName"),
    rules.name("lastName"),
    rules.email(),
    rules.password(),
    body("department").trim().notEmpty().withMessage("Please choose your department."),
    body("indexNumber")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage("Index number must be between 3 and 30 characters.")
      .matches(/^[A-Za-z0-9/-]+$/)
      .withMessage("Index number may only contain letters, digits, hyphens and slashes."),
    body("staffId")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage("Staff ID must be between 3 and 30 characters.")
      .matches(/^[A-Za-z0-9/-]+$/)
      .withMessage("Staff ID may only contain letters, digits, hyphens and slashes."),
    /* Students only — the controller requires it for that role and
       ignores it for supervisors, so the chain stays optional here. */
    body("projectTopic")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 5, max: 200 })
      .withMessage("Your project topic must be between 5 and 200 characters."),
    validate,
  ],
  controller.register
);

router.post(
  "/login",
  loginLimiter,
  [
    rules.email(),
    body("password").isString().notEmpty().withMessage("Please enter your password."),
    body("role")
      .optional({ values: "falsy" })
      .isIn(["student", "supervisor", "admin"])
      .withMessage("That is not a valid role."),
    validate,
  ],
  controller.login
);

router.post(
  "/forgot-password",
  passwordResetLimiter,
  [rules.email(), validate],
  controller.forgotPassword
);

router.post(
  "/reset-password",
  passwordResetLimiter,
  [
    body("token")
      .isString()
      .isLength({ min: 32, max: 128 })
      .withMessage("That reset link is not valid."),
    rules.password("newPassword"),
    validate,
  ],
  controller.resetPassword
);

/* ── Authenticated ───────────────────────────────────────── */
router.get("/me", requireAuth, controller.me);
router.post("/logout", requireAuth, controller.logout);

router.post(
  "/change-password",
  requireAuth,
  [
    body("currentPassword").isString().notEmpty().withMessage("Enter your current password."),
    rules.password("newPassword"),
    validate,
  ],
  controller.changePassword
);

module.exports = router;
