/* ============================================================
   src/routes/projects.js — /api/projects

   Read routes are open to any signed-in role and scoped inside the
   controller (a student sees only their own). Write routes are
   admin-only, except the title/topic edit a supervisor may make on
   a project they supervise.
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/projectController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate, rules, body, param, query } = require("../middleware/validate");
const { writeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  [
    query("status").optional().isIn(["Pending", "In Progress", "Completed"])
      .withMessage("Status filter must be Pending, In Progress or Completed."),
    query("supervisorId").optional().isUUID().withMessage("That supervisor id is not valid."),
    query("search").optional().trim().isLength({ max: 100 })
      .withMessage("Search term is too long."),
    validate,
  ],
  controller.listProjects
);

/* Static segments before "/:id" so they are not read as ids. */
router.post(
  "/assign-supervisor",
  requireRole("admin"),
  writeLimiter,
  [
    body("studentId").isUUID().withMessage("Please choose a student."),
    body("supervisorId").isUUID().withMessage("Please choose a supervisor."),
    body("title").optional({ values: "falsy" }).trim().isLength({ max: 300 })
      .withMessage("That project title is too long."),
    validate,
  ],
  controller.assignSupervisor
);

router.get(
  "/milestones/:projectId",
  [rules.uuidParam("projectId"), validate],
  controller.listMilestones
);

router.put(
  "/milestones/:id",
  requireRole("supervisor", "admin"),
  writeLimiter,
  [
    rules.uuidParam(),
    body("label").optional().trim().notEmpty().withMessage("A milestone needs a label.")
      .isLength({ max: 200 }).withMessage("That label is too long."),
    rules.isoDate("dueDate", { optional: true }),
    validate,
  ],
  controller.updateMilestone
);

router.post(
  "/",
  requireRole("admin"),
  writeLimiter,
  [
    body("studentId").isUUID().withMessage("Please choose a student."),
    body("supervisorId").optional({ values: "falsy" }).isUUID()
      .withMessage("That supervisor id is not valid."),
    body("title").optional({ values: "falsy" }).trim().isLength({ max: 300 })
      .withMessage("That project title is too long."),
    body("topic").optional({ values: "falsy" }).trim().isLength({ max: 500 })
      .withMessage("That topic is too long."),
    rules.isoDate("startDate", { optional: true }),
    rules.isoDate("deadline", { optional: true }),
    validate,
  ],
  controller.createProject
);

router.get("/:id", [rules.uuidParam(), validate], controller.getProject);

router.put(
  "/:id",
  writeLimiter,
  [
    rules.uuidParam(),
    body("title").optional().trim().notEmpty().withMessage("A project needs a title.")
      .isLength({ max: 300 }).withMessage("That project title is too long."),
    body("topic").optional({ values: "null" }).trim().isLength({ max: 500 })
      .withMessage("That topic is too long."),
    body("status").optional().isIn(["Pending", "In Progress", "Completed"])
      .withMessage("Status must be Pending, In Progress or Completed."),
    body("topicStatus").optional().isIn(["Pending", "Approved", "Rejected"])
      .withMessage("Topic status must be Pending, Approved or Rejected."),
    body("completionPercent").optional().isInt({ min: 0, max: 100 })
      .withMessage("Completion must be a whole number between 0 and 100.").toInt(),
    body("supervisorId").optional({ values: "falsy" }).isUUID()
      .withMessage("That supervisor id is not valid."),
    rules.isoDate("startDate", { optional: true }),
    rules.isoDate("deadline", { optional: true }),
    validate,
  ],
  controller.updateProject
);

router.delete(
  "/:id",
  requireRole("admin"),
  [rules.uuidParam(), validate],
  controller.deleteProject
);

module.exports = router;
