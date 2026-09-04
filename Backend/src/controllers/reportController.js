/* ============================================================
   src/controllers/reportController.js — Requirement 11

   Five reports for the admin dashboard. Each is a single
   aggregate query rather than rows fetched and counted in JS:
   the database is where counting belongs, and it keeps the
   reports page a fixed cost as the cohort grows.

   Every report is fetched by a `fetch*` function and rendered by
   two handlers — one answering JSON to the page, one answering a
   CSV download. Deriving both from the same function is what stops
   the exported file and the table on screen from drifting apart:
   there is no second query to forget to update.
============================================================ */

"use strict";

const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { dateOnly } = require("../utils/presenters");
const { toCsv, sendCsv } = require("../utils/csv");

/* ══════════════════════════════════════
   GET /api/reports/summary
   Feeds both the admin dashboard tiles and the reports page.
══════════════════════════════════════ */
async function fetchSummary() {
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

  return {
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
  };
}

const summary = catchAsync(async (req, res) => {
  res.json({ success: true, summary: await fetchSummary() });
});

/* ══════════════════════════════════════
   GET /api/reports/completion
   Project count and share per status. Every status appears even
   when its count is zero, so the table does not change shape as
   the cohort moves through the year.
══════════════════════════════════════ */
async function fetchCompletion() {
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

  return rows;
}

const completion = catchAsync(async (req, res) => {
  res.json({ success: true, report: await fetchCompletion() });
});

/* ══════════════════════════════════════
   GET /api/reports/projects
   Row per project: student, title, supervisor, progress, deadline.
══════════════════════════════════════ */
async function fetchProjects() {
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

  return rows.map((r) => ({
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
  }));
}

const projects = catchAsync(async (req, res) => {
  res.json({ success: true, report: await fetchProjects() });
});

/* ══════════════════════════════════════
   GET /api/reports/workload
   Per supervisor: students, pending reviews, average progress.
   LEFT JOINs so a supervisor with no students still appears with
   zeros — that absence is exactly what the report exists to show.
══════════════════════════════════════ */
async function fetchWorkload() {
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

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department,
    specialization: r.specialization,
    studentsAssigned: r.students_assigned,
    avgProgress: r.avg_progress,
    pendingReviews: r.pending_reviews,
    feedbackGiven: r.feedback_given,
  }));
}

const workload = catchAsync(async (req, res) => {
  res.json({ success: true, report: await fetchWorkload() });
});

/* ══════════════════════════════════════
   GET /api/reports/deadlines
   Projects due within ?days= (default 30), plus anything overdue.
   Backs the deadline reminders in requirement 8.
══════════════════════════════════════ */
async function fetchDeadlines(rawDays) {
  const days = Math.min(Math.max(Number.parseInt(rawDays, 10) || 30, 1), 365);

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

  return rows.map((r) => ({
    id: r.id,
    studentName: r.student_name,
    studentEmail: r.student_email,
    title: r.title,
    deadline: dateOnly(r.deadline),
    completionPercent: Number(r.completion_percent),
    status: r.status,
    daysRemaining: Number(r.days_remaining),
    overdue: Number(r.days_remaining) < 0,
  }));
}

const deadlines = catchAsync(async (req, res) => {
  res.json({ success: true, report: await fetchDeadlines(req.query.days) });
});

/* ══════════════════════════════════════
   GET /api/reports/export/:type
   The same five reports as a CSV download.

   Each entry names the file, the column headings, and how one
   record becomes one row — so adding a report to the page and
   adding it to the exports is the same small piece of work, and a
   report that cannot be exported is a missing entry rather than a
   silently empty file.
══════════════════════════════════════ */
const EXPORTS = Object.freeze({
  summary: {
    label: "system-summary",
    headers: ["Metric", "Value"],
    /* The summary is one object, not a list. Reading down a column
       of metric/value pairs is how a spreadsheet wants it. */
    async rows() {
      const s = await fetchSummary();
      return [
        ["Total students", s.totalStudents],
        ["Total supervisors", s.totalSupervisors],
        ["Pending approvals", s.pendingApprovals],
        ["Total projects", s.totalProjects],
        ["Projects in progress", s.projectsInProgress],
        ["Projects completed", s.projectsCompleted],
        ["Projects pending", s.projectsPending],
        ["Projects without a supervisor", s.projectsUnassigned],
        ["Total chapter submissions", s.totalSubmissions],
        ["Approved submissions", s.approvedSubmissions],
        ["Submissions awaiting review", s.pendingReviews],
        ["Feedback entries given", s.totalFeedbackGiven],
        ["Upcoming meetings", s.upcomingMeetings],
        ["Average completion (%)", s.averageCompletion],
      ];
    },
  },

  completion: {
    label: "completion",
    headers: ["Status", "Projects", "Percentage"],
    async rows() {
      const report = await fetchCompletion();
      return report.map((r) => [r.status, r.count, `${r.percent}%`]);
    },
  },

  projects: {
    label: "project-progress",
    headers: [
      "Student",
      "Index number",
      "Project title",
      "Supervisor",
      "Completion (%)",
      "Status",
      "Start date",
      "Deadline",
      "Submissions",
    ],
    async rows() {
      const report = await fetchProjects();
      return report.map((p) => [
        p.studentName,
        p.indexNumber,
        p.title,
        p.supervisorName,
        p.completionPercent,
        p.status,
        p.startDate,
        p.deadline,
        p.submissionCount,
      ]);
    },
  },

  workload: {
    label: "supervisor-workload",
    headers: [
      "Supervisor",
      "Department",
      "Specialization",
      "Students assigned",
      "Pending reviews",
      "Average progress (%)",
      "Feedback given",
    ],
    async rows() {
      const report = await fetchWorkload();
      return report.map((w) => [
        w.name,
        w.department,
        w.specialization,
        w.studentsAssigned,
        w.pendingReviews,
        w.avgProgress,
        w.feedbackGiven,
      ]);
    },
  },

  deadlines: {
    label: "deadlines",
    headers: [
      "Student",
      "Email",
      "Project title",
      "Deadline",
      "Days remaining",
      "Overdue",
      "Completion (%)",
      "Status",
    ],
    async rows(req) {
      const report = await fetchDeadlines(req.query.days);
      return report.map((d) => [
        d.studentName,
        d.studentEmail,
        d.title,
        d.deadline,
        d.daysRemaining,
        d.overdue ? "Yes" : "No",
        d.completionPercent,
        d.status,
      ]);
    },
  },
});

/** The names the route accepts, so the list lives in one place. */
const EXPORTABLE = Object.freeze(Object.keys(EXPORTS));

const exportReport = catchAsync(async (req, res) => {
  const definition = EXPORTS[req.params.type];
  if (!definition) {
    throw ApiError.badRequest(
      `There is no "${req.params.type}" report. Choose one of: ${EXPORTABLE.join(", ")}.`
    );
  }

  const rows = await definition.rows(req);
  const stamp = new Date().toISOString().slice(0, 10);

  sendCsv(
    res,
    `opsts-${definition.label}-${stamp}.csv`,
    toCsv(definition.headers, rows)
  );
});

module.exports = { summary, completion, projects, workload, deadlines, exportReport, EXPORTABLE };
