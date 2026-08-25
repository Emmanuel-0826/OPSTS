/* ============================================================
   src/controllers/reportController.js — Requirement 11

   Four reports for the admin dashboard. Each is a single
   aggregate query rather than rows fetched and counted in JS:
   the database is where counting belongs, and it keeps the
   reports page a fixed cost as the cohort grows.
============================================================ */

"use strict";

const db = require("../config/db");
const catchAsync = require("../utils/catchAsync");
const { dateOnly } = require("../utils/presenters");

/* ══════════════════════════════════════
   GET /api/reports/summary
   Feeds both the admin dashboard tiles and the reports page.
══════════════════════════════════════ */
const summary = catchAsync(async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE role = 'student'    AND status = 'active') AS total_students,
      (SELECT count(*)::int FROM users WHERE role = 'supervisor' AND status = 'active') AS total_supervisors,
      (SELECT count(*)::int FROM users WHERE status = 'pending')                        AS pending_approvals,
      (SELECT count(*)::int FROM projects)                                              AS total_projects,
      (SELECT count(*)::int FROM projects WHERE status = 'In Progress')                 AS projects_in_progress,
      (SELECT count(*)::int FROM projects WHERE status = 'Completed')                   AS projects_completed,
      (SELECT count(*)::int FROM projects WHERE status = 'Pending')                     AS projects_pending,
      (SELECT count(*)::int FROM projects WHERE supervisor_id IS NULL)                  AS projects_unassigned,
      (SELECT count(*)::int FROM submissions)                                           AS total_submissions,
      (SELECT count(*)::int FROM submissions WHERE status = 'Approved')                 AS approved_submissions,
      (SELECT count(*)::int FROM submissions WHERE status = 'Under Review')             AS pending_reviews,
      (SELECT count(*)::int FROM feedback)                                              AS total_feedback_given,
      (SELECT count(*)::int FROM meetings WHERE status = 'Upcoming')                    AS upcoming_meetings,
      (SELECT COALESCE(round(avg(completion_percent)), 0)::int FROM projects)           AS average_completion
  `);

  const r = rows[0];

  res.json({
    success: true,
    summary: {
      totalStudents: r.total_students,
      totalSupervisors: r.total_supervisors,
      pendingApprovals: r.pending_approvals,
      totalProjects: r.total_projects,
      projectsInProgress: r.projects_in_progress,
      projectsCompleted: r.projects_completed,
      projectsPending: r.projects_pending,
      projectsUnassigned: r.projects_unassigned,
      totalSubmissions: r.total_submissions,
      approvedSubmissions: r.approved_submissions,
      pendingReviews: r.pending_reviews,
      totalFeedbackGiven: r.total_feedback_given,
      upcomingMeetings: r.upcoming_meetings,
      averageCompletion: r.average_completion,
    },
  });
});

/* ══════════════════════════════════════
   GET /api/reports/completion
   Project count and share per status. Every status appears even
   when its count is zero, so the table does not change shape as
   the cohort moves through the year.
══════════════════════════════════════ */
const completion = catchAsync(async (req, res) => {
  const { rows } = await db.query(`
    WITH all_statuses(status) AS (
      VALUES ('Pending'), ('In Progress'), ('Completed')
    ),
    counted AS (
      SELECT s.status, count(p.id)::int AS count
        FROM all_statuses s
        LEFT JOIN projects p ON p.status = s.status
       GROUP BY s.status
    )
    SELECT status,
           count,
           CASE WHEN sum(count) OVER () = 0 THEN 0
                ELSE round(count * 100.0 / sum(count) OVER ())::int
           END AS percent
      FROM counted
     ORDER BY CASE status
                WHEN 'Pending' THEN 1
                WHEN 'In Progress' THEN 2
                ELSE 3
              END
  `);

  res.json({ success: true, report: rows });
});

/* ══════════════════════════════════════
   GET /api/reports/projects
   Row per project: student, title, supervisor, progress, deadline.
══════════════════════════════════════ */
const projects = catchAsync(async (req, res) => {
  const { rows } = await db.query(`
    SELECT p.id,
           s.first_name || ' ' || s.last_name AS student_name,
           s.index_number,
           p.title,
           COALESCE(v.first_name || ' ' || v.last_name, 'Unassigned') AS supervisor_name,
           p.completion_percent,
           p.status,
           p.start_date,
           p.deadline,
           (SELECT count(*)::int FROM submissions sb WHERE sb.project_id = p.id) AS submission_count
      FROM projects p
      JOIN users s ON s.id = p.student_id
      LEFT JOIN users v ON v.id = p.supervisor_id
     ORDER BY p.completion_percent DESC, s.first_name
  `);

  res.json({
    success: true,
    report: rows.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      indexNumber: r.index_number,
      title: r.title,
      supervisorName: r.supervisor_name,
      completionPercent: Number(r.completion_percent),
      status: r.status,
      startDate: dateOnly(r.start_date),
      deadline: dateOnly(r.deadline),
      submissionCount: r.submission_count,
    })),
  });
});

/* ══════════════════════════════════════
   GET /api/reports/workload
   Per supervisor: students, pending reviews, average progress.
   LEFT JOINs so a supervisor with no students still appears with
   zeros — that absence is exactly what the report exists to show.
══════════════════════════════════════ */
const workload = catchAsync(async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.id,
           u.first_name || ' ' || u.last_name AS name,
           COALESCE(u.department, '—')        AS department,
           COALESCE(u.specialization, '—')    AS specialization,
           count(DISTINCT p.id)::int          AS students_assigned,
           COALESCE(round(avg(p.completion_percent)), 0)::int AS avg_progress,
           (SELECT count(*)::int FROM submissions sb
             WHERE sb.supervisor_id = u.id AND sb.status = 'Under Review') AS pending_reviews,
           (SELECT count(*)::int FROM feedback f WHERE f.supervisor_id = u.id) AS feedback_given
      FROM users u
      LEFT JOIN projects p ON p.supervisor_id = u.id
     WHERE u.role = 'supervisor' AND u.status = 'active'
     GROUP BY u.id, u.first_name, u.last_name, u.department, u.specialization
     ORDER BY students_assigned DESC, name
  `);

  res.json({
    success: true,
    report: rows.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department,
      specialization: r.specialization,
      studentsAssigned: r.students_assigned,
      avgProgress: r.avg_progress,
      pendingReviews: r.pending_reviews,
      feedbackGiven: r.feedback_given,
    })),
  });
});

/* ══════════════════════════════════════
   GET /api/reports/deadlines
   Projects due within ?days= (default 30), plus anything overdue.
   Backs the deadline reminders in requirement 8.
══════════════════════════════════════ */
const deadlines = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 365);

  const { rows } = await db.query(
    `SELECT p.id,
            s.first_name || ' ' || s.last_name AS student_name,
            s.email AS student_email,
            p.title,
            p.deadline,
            p.completion_percent,
            p.status,
            (p.deadline - CURRENT_DATE) AS days_remaining
       FROM projects p
       JOIN users s ON s.id = p.student_id
      WHERE p.deadline IS NOT NULL
        AND p.status <> 'Completed'
        AND p.deadline <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
      ORDER BY p.deadline ASC`,
    [days]
  );

  res.json({
    success: true,
    report: rows.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      studentEmail: r.student_email,
      title: r.title,
      deadline: dateOnly(r.deadline),
      completionPercent: Number(r.completion_percent),
      status: r.status,
      daysRemaining: Number(r.days_remaining),
      overdue: Number(r.days_remaining) < 0,
    })),
  });
});

module.exports = { summary, completion, projects, workload, deadlines };
