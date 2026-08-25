/* ============================================================
   src/routes/reports.js — /api/reports

   Reports aggregate across every student and supervisor in the
   system, so the whole router is administrator-only.
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/reportController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate, query } = require("../middleware/validate");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/summary", controller.summary);
router.get("/completion", controller.completion);
router.get("/projects", controller.projects);
router.get("/workload", controller.workload);

router.get(
  "/deadlines",
  [
    query("days").optional().isInt({ min: 1, max: 365 })
      .withMessage("days must be between 1 and 365."),
    validate,
  ],
  controller.deadlines
);

module.exports = router;
