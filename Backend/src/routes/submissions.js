/* ============================================================
   src/routes/submissions.js — /api/submissions
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/submissionController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { uploadChapter } = require("../middleware/upload");
const { validate, rules, body, query } = require("../middleware/validate");
const { writeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  [
    query("status").optional().isIn(["Under Review", "Approved", "Needs Revision"])
      .withMessage("Status filter must be Under Review, Approved or Needs Revision."),
    query("chapterId").optional().trim().isLength({ max: 20 }),
    query("studentId").optional().isUUID().withMessage("That student id is not valid."),
    validate,
  ],
  controller.listSubmissions
);

/* Multipart body: the file is parsed by multer, and the remaining
   fields (chapterId, notes) are validated inside the controller —
   express-validator cannot see them until multer has run. */
router.post(
  "/",
  requireRole("student"),
  writeLimiter,
  uploadChapter,
  controller.createSubmission
);

router.get("/:id", [rules.uuidParam(), validate], controller.getSubmission);

router.get(
  "/:id/download",
  [rules.uuidParam(), validate],
  controller.downloadSubmission
);

/* Reopening an approved chapter is the only way a student can submit
   it again, so it is a supervisor's call — or an admin's. */
router.post(
  "/:id/reopen",
  requireRole("supervisor", "admin"),
  writeLimiter,
  [
    rules.uuidParam(),
    body("reason").optional({ values: "falsy" }).trim().isLength({ max: 500 })
      .withMessage("A reason must be 500 characters or fewer."),
    validate,
  ],
  controller.reopenSubmission
);

router.delete("/:id", [rules.uuidParam(), validate], controller.deleteSubmission);

module.exports = router;
