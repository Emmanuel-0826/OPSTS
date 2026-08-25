/* ============================================================
   src/routes/users.js — /api/users

   Every route here is authenticated. Where a route is not admin-
   only, the controller decides between "self" and "admin" — the
   distinction depends on the target id, which a route-level guard
   cannot see.
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/userController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate, rules, body, query } = require("../middleware/validate");
const { writeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  requireRole("admin"),
  [
    query("role").optional().isIn(["student", "supervisor", "admin"])
      .withMessage("Role filter must be student, supervisor or admin."),
    query("status").optional().isIn(["pending", "active", "suspended"])
      .withMessage("Status filter must be pending, active or suspended."),
    query("search").optional().trim().isLength({ max: 100 })
      .withMessage("Search term is too long."),
    validate,
  ],
  controller.listUsers
);

/* Declared before "/:id" so "supervisor" is not swallowed as an id. */
router.get(
  "/supervisor/:id/students",
  [rules.uuidParam("id"), validate],
  controller.listSupervisorStudents
);

router.post(
  "/",
  requireRole("admin"),
  writeLimiter,
  [
    body("role").isIn(["student", "supervisor", "admin"]).withMessage("Choose a valid role."),
    rules.name("firstName"),
    rules.name("lastName"),
    rules.email(),
    rules.password(),
    body("department").trim().notEmpty().withMessage("Please choose a department."),
    body("indexNumber").optional({ values: "falsy" }).trim().isLength({ max: 30 })
      .withMessage("Index number is too long."),
    body("staffId").optional({ values: "falsy" }).trim().isLength({ max: 30 })
      .withMessage("Staff ID is too long."),
    body("level").optional({ values: "falsy" }).trim().isLength({ max: 30 }),
    body("specialization").optional({ values: "falsy" }).trim().isLength({ max: 120 }),
    validate,
  ],
  controller.createUser
);

router.get("/:id", [rules.uuidParam(), validate], controller.getUser);

router.put(
  "/:id",
  writeLimiter,
  [
    rules.uuidParam(),
    body("firstName").optional().trim().notEmpty().withMessage("First name cannot be empty.")
      .isLength({ max: 80 }).withMessage("That name is too long."),
    body("lastName").optional().trim().notEmpty().withMessage("Last name cannot be empty.")
      .isLength({ max: 80 }).withMessage("That name is too long."),
    body("specialization").optional({ values: "null" }).trim().isLength({ max: 120 })
      .withMessage("Specialization is too long."),
    body("department").optional({ values: "null" }).trim().isLength({ max: 120 }),
    body("email").optional().trim().isEmail().withMessage("Please enter a valid email address.")
      .normalizeEmail({ gmail_remove_dots: false }),
    body("status").optional().isIn(["pending", "active", "suspended"])
      .withMessage("Status must be pending, active or suspended."),
    validate,
  ],
  controller.updateUser
);

router.patch(
  "/:id/approve",
  requireRole("admin"),
  [rules.uuidParam(), validate],
  controller.approveUser
);

router.delete(
  "/:id",
  requireRole("admin"),
  [rules.uuidParam(), validate],
  controller.deleteUser
);

module.exports = router;
