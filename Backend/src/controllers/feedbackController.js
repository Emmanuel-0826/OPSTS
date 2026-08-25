/* ============================================================
   src/controllers/feedbackController.js — Requirement 5

   A supervisor's decision on a submission. Giving feedback is a
   single transaction that does four things together:

     1. records the comment,
     2. moves the submission to Approved or Needs Revision,
     3. recalculates the project's completion and milestones,
     4. notifies the student.

   They belong together: a student who is told "approved" must
   never find a progress bar that disagrees, and a rolled-back
   approval must not leave a notification behind claiming otherwise.
============================================================ */

"use strict";

const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toFeedback } = require("../utils/presenters");
const { chapterLabel } = require("../utils/chapters");
const notifications = require("../services/notificationService");
const email = require("../services/email");
const { recalculateProject } = require("../services/progressService");

const FEEDBACK_SELECT = `
  SELECT f.id, f.submission_id, f.project_id, f.student_id, f.supervisor_id,
         f.chapter_label, f.comment, f.rating, f.created_at,
         sub.chapter_id,
         st.first_name AS student_first_name,
         st.last_name  AS student_last_name,
         sv.first_name AS supervisor_first_name,
         sv.last_name  AS supervisor_last_name
    FROM feedback f
    JOIN users st       ON st.id  = f.student_id
    LEFT JOIN users sv  ON sv.id  = f.supervisor_id
    LEFT JOIN submissions sub ON sub.id = f.submission_id`;

/* ══════════════════════════════════════
   GET /api/feedback
   Student → feedback on their work. Supervisor → feedback they gave.
   Admin → everything. Optional ?submissionId= / ?studentId=.
══════════════════════════════════════ */
const listFeedback = catchAsync(async (req, res) => {
  const conditions = [];
  const params = [];

  if (req.user.role === "student") {
    params.push(req.user.id);
    conditions.push(`f.student_id = $${params.length}`);
  } else if (req.user.role === "supervisor") {
    params.push(req.user.id);
    conditions.push(`f.supervisor_id = $${params.length}`);
  }

  if (req.query.submissionId) {
    params.push(req.query.submissionId);
    conditions.push(`f.submission_id = $${params.length}`);
  }
  if (req.query.studentId && req.user.role !== "student") {
    params.push(req.query.studentId);
    conditions.push(`f.student_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.query(
    `${FEEDBACK_SELECT} ${where} ORDER BY f.created_at DESC`,
    params
  );

  res.json({ success: true, count: rows.length, feedback: rows.map(toFeedback) });
});

/* ══════════════════════════════════════
   POST /api/feedback   (supervisor, or admin)
   Body: submissionId, comment, rating, [chapterLabel]
══════════════════════════════════════ */
const createFeedback = catchAsync(async (req, res) => {
  const { submissionId, comment, rating } = req.body;

  const result = await db.withTransaction(async (client) => {
    /* Locking the submission stops two supervisors (or a double-click)
       from both recording a decision on the same version. */
    const { rows: submissionRows } = await client.query(
      `SELECT sub.id, sub.project_id, sub.student_id, sub.supervisor_id,
              sub.chapter_id, sub.version, sub.status,
              st.first_name AS student_first_name,
              st.last_name  AS student_last_name,
              st.email      AS student_email
         FROM submissions sub
         JOIN users st ON st.id = sub.student_id
        WHERE sub.id = $1
        FOR UPDATE OF sub`,
      [submissionId]
    );
    const submission = submissionRows[0];

    if (!submission) throw ApiError.notFound("That submission does not exist.");

    if (req.user.role === "supervisor" && submission.supervisor_id !== req.user.id) {
      throw ApiError.forbidden("You can only review submissions from your own students.");
    }

    const label = req.body.chapterLabel || chapterLabel(submission.chapter_id);

    const { rows: feedbackRows } = await client.query(
      `INSERT INTO feedback
         (submission_id, project_id, student_id, supervisor_id, chapter_label, comment, rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        submission.id,
        submission.project_id,
        submission.student_id,
        req.user.id,
        label,
        comment,
        rating,
      ]
    );

    await client.query("UPDATE submissions SET status = $2 WHERE id = $1", [
      submission.id,
      rating, // 'Approved' | 'Needs Revision' — the same vocabulary both tables use
    ]);

    const progress = await recalculateProject(client, submission.project_id);

    const reviewerName = `${req.user.first_name} ${req.user.last_name}`;
    await notifications.notify(client, {
      userId: submission.student_id,
      type: rating === "Approved" ? "approval" : "feedback",
      message:
        rating === "Approved"
          ? `${reviewerName} approved your ${label} submission.`
          : `${reviewerName} requested revisions on your ${label} submission.`,
      link: "feedback.html",
    });

    const { rows: full } = await client.query(`${FEEDBACK_SELECT} WHERE f.id = $1`, [
      feedbackRows[0].id,
    ]);

    return { feedback: full[0], submission, label, progress, reviewerName };
  });

  email
    .activityAlert({
      to: result.submission.student_email,
      name: result.submission.student_first_name,
      subject:
        rating === "Approved"
          ? `${result.label} approved`
          : `Revisions requested on ${result.label}`,
      lines: [
        `${result.reviewerName} has reviewed your ${result.label} submission (version ${result.submission.version}).`,
        `Decision: ${rating}.`,
        comment.length > 400 ? `${comment.slice(0, 400)}…` : comment,
      ],
      ctaLabel: "View feedback",
      ctaPath: "pages/Student/feedback.html",
    })
    .catch(() => {});

  res.status(201).json({
    success: true,
    message: "Feedback submitted. The student has been notified.",
    feedback: toFeedback(result.feedback),
    progress: result.progress,
  });
});

/* ══════════════════════════════════════
   GET /api/feedback/:id
══════════════════════════════════════ */
const getFeedback = catchAsync(async (req, res) => {
  const params = [req.params.id];
  let scope = "";

  if (req.user.role === "student") {
    params.push(req.user.id);
    scope = "AND f.student_id = $2";
  } else if (req.user.role === "supervisor") {
    params.push(req.user.id);
    scope = "AND f.supervisor_id = $2";
  }

  const { rows } = await db.query(`${FEEDBACK_SELECT} WHERE f.id = $1 ${scope}`, params);
  if (!rows[0]) {
    throw ApiError.notFound("That feedback does not exist, or you do not have access to it.");
  }

  res.json({ success: true, feedback: toFeedback(rows[0]) });
});

module.exports = { listFeedback, createFeedback, getFeedback };
