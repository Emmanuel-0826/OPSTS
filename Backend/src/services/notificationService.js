/* ============================================================
   src/services/notificationService.js — Requirement 8

   Every function takes an `executor` (the pool, or a transaction
   client). That is what lets a notification be written in the same
   transaction as the event that caused it: a student is never told
   "feedback received" for feedback that got rolled back.

   Notifications are best-effort when raised outside a transaction —
   a failure to notify must not fail the action itself.
============================================================ */

"use strict";

const db = require("../config/db");

/** Types the frontend has an icon for (Utils.notifIcon). */
const TYPES = Object.freeze([
  "feedback",
  "meeting",
  "deadline",
  "submission",
  "approval",
  "system",
]);

/**
 * Write one notification.
 * @param {object} executor        db, or a transaction client
 * @param {object} n
 * @param {string} n.userId
 * @param {string} n.type          one of TYPES
 * @param {string} n.message
 * @param {string} [n.link]        relative page the bell should link to
 */
async function notify(executor, { userId, type, message, link = null }) {
  if (!userId) return null;
  const safeType = TYPES.includes(type) ? type : "system";

  const { rows } = await executor.query(
    `INSERT INTO notifications (user_id, type, message, link)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, type, message, link, read, created_at`,
    [userId, safeType, message, link]
  );
  return rows[0];
}

/** Write the same notification to several users in one statement. */
async function notifyMany(executor, userIds, { type, message, link = null }) {
  const recipients = [...new Set((userIds || []).filter(Boolean))];
  if (recipients.length === 0) return [];

  const safeType = TYPES.includes(type) ? type : "system";

  const { rows } = await executor.query(
    `INSERT INTO notifications (user_id, type, message, link)
     SELECT uid, $2, $3, $4 FROM unnest($1::uuid[]) AS uid
     RETURNING id, user_id, type, message, link, read, created_at`,
    [recipients, safeType, message, link]
  );
  return rows;
}

/** Fan out to every active administrator (new registrations, etc.). */
async function notifyAdmins(executor, { type, message, link = null }) {
  const { rows } = await executor.query(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active'"
  );
  return notifyMany(
    executor,
    rows.map((r) => r.id),
    { type, message, link }
  );
}

/**
 * Fire-and-forget variant for callers outside a transaction.
 * Logs and swallows failures so a notification problem never
 * turns a successful action into an error response.
 */
function notifySafe(payload) {
  return notify(db, payload).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[notifications] failed to write:", err.message);
    return null;
  });
}

module.exports = { TYPES, notify, notifyMany, notifyAdmins, notifySafe };
