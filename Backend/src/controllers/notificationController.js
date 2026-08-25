/* ============================================================
   src/controllers/notificationController.js — Requirement 8

   The frontend polls /notifications/unread-count every few seconds
   for the bell badge, so that endpoint is kept as cheap as
   possible: a single count against a partial index on unread rows,
   returning one integer.
============================================================ */

"use strict";

const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toNotification } = require("../utils/presenters");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/* ══════════════════════════════════════
   GET /api/notifications
   ?scope=all    — admin only, system-wide feed
   ?unreadOnly=1 — just the unread ones
   ?limit=       — capped at 200
══════════════════════════════════════ */
const listNotifications = catchAsync(async (req, res) => {
  const wantsAll = req.query.scope === "all";

  if (wantsAll && req.user.role !== "admin") {
    throw ApiError.forbidden("Only administrators can view system-wide notifications.");
  }

  const conditions = [];
  const params = [];

  if (!wantsAll) {
    params.push(req.user.id);
    conditions.push(`n.user_id = $${params.length}`);
  }
  if (req.query.unreadOnly === "1" || req.query.unreadOnly === "true") {
    conditions.push("n.read = FALSE");
  }

  const limit = Math.min(
    Math.max(Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.query(
    `SELECT n.id, n.user_id, n.type, n.message, n.link, n.read, n.created_at
       FROM notifications n
       ${where}
      ORDER BY n.created_at DESC
      LIMIT $${params.length}`,
    params
  );

  res.json({ success: true, count: rows.length, notifications: rows.map(toNotification) });
});

/* ══════════════════════════════════════
   GET /api/notifications/unread-count
══════════════════════════════════════ */
const unreadCount = catchAsync(async (req, res) => {
  const { rows } = await db.query(
    "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE",
    [req.user.id]
  );
  res.json({ success: true, count: rows[0].count });
});

/* ══════════════════════════════════════
   PATCH /api/notifications/:id/read
   Ownership is part of the WHERE clause, so marking someone else's
   notification read is a 404, not a silent success.
══════════════════════════════════════ */
const markRead = catchAsync(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE notifications
        SET read = TRUE
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, type, message, link, read, created_at`,
    [req.params.id, req.user.id]
  );

  if (!rows[0]) {
    throw ApiError.notFound("That notification does not exist, or it is not yours.");
  }

  res.json({ success: true, notification: toNotification(rows[0]) });
});

/* ══════════════════════════════════════
   PATCH /api/notifications/read-all
══════════════════════════════════════ */
const markAllRead = catchAsync(async (req, res) => {
  const { rowCount } = await db.query(
    "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE",
    [req.user.id]
  );
  res.json({
    success: true,
    message: rowCount === 0 ? "No unread notifications." : `${rowCount} notifications marked read.`,
    updated: rowCount,
  });
});

/* ══════════════════════════════════════
   DELETE /api/notifications/:id
══════════════════════════════════════ */
const deleteNotification = catchAsync(async (req, res) => {
  const { rowCount } = await db.query(
    "DELETE FROM notifications WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.id]
  );
  if (rowCount === 0) {
    throw ApiError.notFound("That notification does not exist, or it is not yours.");
  }
  res.json({ success: true, message: "Notification removed." });
});

module.exports = {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
};
