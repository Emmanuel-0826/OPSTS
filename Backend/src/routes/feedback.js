/* ============================================================
   src/routes/feedback.js — /api/feedback
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/feedbackController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate, rules, body, query } = require("../middleware/validate");
const { writeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  [
    query("submissionId").optional().isUUID().withMessage("That submission id is not valid."),
    query("studentId").optional().isUUID().withMessage("That student id is not valid."),
    validate,
  ],
  controller.listFeedback
);

router.post(
  "/",
  requireRole("supervisor", "admin"),
  writeLimiter,
  [
    body("submissionId").isUUID().withMessage("That submission id is not valid."),
    body("comment").trim().notEmpty().withMessage("Please enter your feedback comments.")
      .isLength({ max: 5000 }).withMessage("Feedback must be 5000 characters or fewer."),
    /* The same two words the submissions table uses for status — a
       feedback decision *is* the submission's new status. */
    body("rating").isIn(["Approved", "Needs Revision"])
      .withMessage("Decision must be Approved or Needs Revision."),
    body("chapterLabel").optional({ values: "falsy" }).trim().isLength({ max: 200 }),
    validate,
  ],
  controller.createFeedback
);

router.get("/:id", [rules.uuidParam(), validate], controller.getFeedback);

module.exports = router;
