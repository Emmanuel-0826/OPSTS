/* ============================================================
   src/routes/meetings.js — /api/meetings
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/meetingController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate, rules, body, query } = require("../middleware/validate");
const { writeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const PLATFORMS = ["Zoom", "Google Meet", "In-Person"];

router.use(requireAuth);

router.get(
  "/",
  [
    query("status").optional().isIn(["Upcoming", "Completed", "Cancelled"])
      .withMessage("Status filter must be Upcoming, Completed or Cancelled."),
    validate,
  ],
  controller.listMeetings
);

/* Static segment before "/:id". */
router.post(
  "/request",
  requireRole("student"),
  writeLimiter,
  [
    body("topic").trim().notEmpty().withMessage("Please describe what the meeting is about.")
      .isLength({ max: 200 }).withMessage("That topic is too long."),
    rules.isoDate("date"),
    rules.time("time"),
    body("platform").optional({ values: "falsy" }).isIn(PLATFORMS)
      .withMessage("Choose Zoom, Google Meet or In-Person."),
    body("notes").optional({ values: "falsy" }).trim().isLength({ max: 2000 })
      .withMessage("Notes must be 2000 characters or fewer."),
    validate,
  ],
  controller.requestMeeting
);

router.post(
  "/",
  requireRole("supervisor", "admin"),
  writeLimiter,
  [
    body("title").trim().notEmpty().withMessage("Please give the meeting a title.")
      .isLength({ max: 200 }).withMessage("That title is too long."),
    rules.isoDate("date"),
    rules.time("time"),
    body("duration").optional({ values: "falsy" }).trim().isLength({ max: 40 }),
    body("platform").optional({ values: "falsy" }).isIn(PLATFORMS)
      .withMessage("Choose Zoom, Google Meet or In-Person."),
    /* An attacker-supplied javascript: or data: URL would become a
       clickable link in another user's browser, so only http(s) is allowed. */
    body("link").optional({ values: "falsy" }).trim()
      .isURL({ protocols: ["http", "https"], require_protocol: true })
      .withMessage("A meeting link must be a full http(s) URL.")
      .isLength({ max: 500 }).withMessage("That link is too long."),
    body("notes").optional({ values: "falsy" }).trim().isLength({ max: 2000 })
      .withMessage("Notes must be 2000 characters or fewer."),
    body("studentIds").isArray({ min: 1 }).withMessage("Select at least one student."),
    body("studentIds.*").isUUID().withMessage("One of the selected students is not valid."),
    body("supervisorId").optional({ values: "falsy" }).isUUID()
      .withMessage("That supervisor id is not valid."),
    validate,
  ],
  controller.createMeeting
);

router.put(
  "/:id",
  writeLimiter,
  [
    rules.uuidParam(),
    body("title").optional().trim().notEmpty().withMessage("A meeting needs a title.")
      .isLength({ max: 200 }),
    rules.isoDate("date", { optional: true }),
    rules.time("time", { optional: true }),
    body("duration").optional({ values: "falsy" }).trim().isLength({ max: 40 }),
    body("platform").optional({ values: "falsy" }).isIn(PLATFORMS)
      .withMessage("Choose Zoom, Google Meet or In-Person."),
    body("link").optional({ values: "null" }).trim()
      .isURL({ protocols: ["http", "https"], require_protocol: true })
      .withMessage("A meeting link must be a full http(s) URL."),
    body("notes").optional({ values: "null" }).trim().isLength({ max: 2000 }),
    body("status").optional().isIn(["Upcoming", "Completed", "Cancelled"])
      .withMessage("Status must be Upcoming, Completed or Cancelled."),
    body("confirm").optional().isBoolean().withMessage("confirm must be true or false.").toBoolean(),
    validate,
  ],
  controller.updateMeeting
);

router.delete("/:id", [rules.uuidParam(), validate], controller.deleteMeeting);

module.exports = router;
