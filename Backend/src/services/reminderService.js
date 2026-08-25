/* ============================================================
   src/services/reminderService.js — Requirement 8, deadline reminders

   Runs on an interval inside the API process. That is the right
   trade for a departmental system of this size — no extra worker
   to deploy or monitor — with one consequence worth naming: if the
   API is scaled to more than one instance, every instance would
   run the sweep. The guard against duplicate reminders is the
   existence check below, not the schedule, so a second instance
   would produce at most a small race rather than a second inbox
   full of mail.
============================================================ */

"use strict";

const db = require("../config/db");
const email = require("./email");

/* Reminder thresholds, in days before the deadline. */
const MILESTONES = [14, 7, 3, 1];

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // four times a day

/**
 * Notify students whose project deadline crosses one of the
 * thresholds today, and whose project is not yet complete.
 * @returns {Promise<number>} reminders sent
 */
async function sweepDeadlines() {
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.deadline, p.completion_percent,
            (p.deadline - CURRENT_DATE) AS days_remaining,
            s.id AS student_id, s.first_name, s.email,
            p.supervisor_id
       FROM projects p
       JOIN users s ON s.id = p.student_id
      WHERE p.deadline IS NOT NULL
        AND p.status <> 'Completed'
        AND s.status = 'active'
        AND (p.deadline - CURRENT_DATE) = ANY($1::int[])`,
    [MILESTONES]
  );

  let sent = 0;

  for (const row of rows) {
    const days = Number(row.days_remaining);
    const message =
      `Your project deadline for "${row.title}" is in ${days} ` +
      `${days === 1 ? "day" : "days"} (${row.deadline}). ` +
      `You are currently at ${row.completion_percent}% completion.`;

    /* One reminder per project per threshold: an identical unsent-today
       message means this sweep already ran. */
    const { rows: inserted } = await db.query(
      `INSERT INTO notifications (user_id, type, message, link)
       SELECT $1, 'deadline', $2, 'progress.html'
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE user_id = $1
             AND type = 'deadline'
             AND message = $2
        )
       RETURNING id`,
      [row.student_id, message]
    );

    if (inserted.length === 0) continue;
    sent += 1;

    email
      .activityAlert({
        to: row.email,
        name: row.first_name,
        subject: `Project deadline in ${days} ${days === 1 ? "day" : "days"}`,
        lines: [
          message,
          "Sign in to OPSTS to check your outstanding chapters.",
        ],
        ctaLabel: "View progress",
        ctaPath: "pages/Student/progress.html",
      })
      .catch(() => {});

    if (row.supervisor_id && days <= 7) {
      await db.query(
        `INSERT INTO notifications (user_id, type, message, link)
         SELECT $1, 'deadline', $2, 'progress.html'
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications
             WHERE user_id = $1 AND type = 'deadline' AND message = $2
          )`,
        [
          row.supervisor_id,
          `${row.first_name}'s project deadline is in ${days} ${days === 1 ? "day" : "days"} ` +
            `and is at ${row.completion_percent}% completion.`,
        ]
      );
    }
  }

  return sent;
}

let timer = null;

/** Start the periodic sweep. Safe to call once at boot. */
function start({ log = console.log } = {}) {
  if (timer) return;

  const run = () =>
    sweepDeadlines()
      .then((sent) => {
        if (sent > 0) log(`[reminders] sent ${sent} deadline reminder(s)`);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[reminders] sweep failed:", err.message);
      });

  /* First sweep a minute after boot, so a restart loop cannot turn
     into a mail storm and startup stays fast. */
  setTimeout(run, 60_000).unref();

  timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { sweepDeadlines, start, stop, MILESTONES };
