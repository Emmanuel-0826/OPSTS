/* ============================================================
   src/routes/notifications.js — /api/notifications
============================================================ */

"use strict";

const express = require("express");
const controller = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/auth");
const { validate, rules, query } = require("../middleware/validate");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  [
    query("scope").optional().isIn(["all", "mine"])
      .withMessage("Scope must be all or mine."),
    query("unreadOnly").optional().isIn(["0", "1", "true", "false"]),
    query("limit").optional().isInt({ min: 1, max: 200 })
      .withMessage("Limit must be between 1 and 200."),
    validate,
  ],
  controller.listNotifications
);

/* Static segments before "/:id" so they are not read as ids. */
router.get("/unread-count", controller.unreadCount);
router.patch("/read-all", controller.markAllRead);

router.patch("/:id/read", [rules.uuidParam(), validate], controller.markRead);
router.delete("/:id", [rules.uuidParam(), validate], controller.deleteNotification);

module.exports = router;
