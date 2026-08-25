/* ============================================================
   src/services/progressService.js — Requirements 3 & 6

   Progress is derived, never stored by hand. One rule defines it:

       completion % = approved chapters / 5 × 100

   where "approved" means the *latest* version of that chapter is
   Approved. Resubmitting a chapter that was previously approved
   therefore correctly drops the percentage back until it is
   approved again — the number always describes the current state
   of the work, not the high-water mark.

   Milestones track the same source of truth, so the timeline on
   the student's progress page can never disagree with the bar
   above it.
============================================================ */

"use strict";

const { CHAPTERS, TOTAL_CHAPTERS } = require("../utils/chapters");

/**
 * Create the five chapter milestones for a new project.
 * Safe to call more than once — existing milestones are left alone.
 */
async function seedMilestones(executor, projectId) {
  await executor.query(
    `INSERT INTO milestones (project_id, chapter_id, label, position)
     SELECT $1, c.chapter_id, c.label, c.position
       FROM unnest($2::text[], $3::text[], $4::int[])
            AS c(chapter_id, label, position)
      WHERE NOT EXISTS (
        SELECT 1 FROM milestones m
         WHERE m.project_id = $1 AND m.chapter_id = c.chapter_id
      )`,
    [
      projectId,
      CHAPTERS.map((c) => c.id),
      CHAPTERS.map((c) => `${c.label} – ${c.title}`),
      CHAPTERS.map((_, i) => i + 1),
    ]
  );
}

/**
 * Spread milestone due dates evenly between a project's start date
 * and deadline, so the timeline means something as soon as an admin
 * sets the dates. Milestones an admin has edited by hand keep their
 * date only if `overwrite` is false.
 */
async function scheduleMilestones(executor, projectId, { overwrite = false } = {}) {
  const { rows } = await executor.query(
    "SELECT start_date, deadline FROM projects WHERE id = $1",
    [projectId]
  );
  const project = rows[0];
  if (!project || !project.start_date || !project.deadline) return;

  const start = new Date(`${project.start_date}T00:00:00Z`);
  const end = new Date(`${project.deadline}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

  const span = end.getTime() - start.getTime();
  const dueDates = CHAPTERS.map((_, i) =>
    new Date(start.getTime() + (span * (i + 1)) / TOTAL_CHAPTERS).toISOString().slice(0, 10)
  );

  await executor.query(
    `UPDATE milestones AS m
        SET due_date = d.due_date::date
       FROM unnest($2::text[], $3::text[]) AS d(chapter_id, due_date)
      WHERE m.project_id = $1
        AND m.chapter_id = d.chapter_id
        AND ($4::boolean OR m.due_date IS NULL)`,
    [projectId, CHAPTERS.map((c) => c.id), dueDates, overwrite]
  );
}

/**
 * Recompute completion percentage, project status and milestone
 * statuses from the submissions table.
 *
 * Must run inside the same transaction as the change that triggered
 * it (a new submission, a feedback decision), so a reader can never
 * observe a submission without its resulting progress.
 *
 * @returns {Promise<{completionPercent: number, approvedChapters: number, status: string}>}
 */
async function recalculateProject(client, projectId) {
  /* Latest version of each chapter for this project. DISTINCT ON is
     the cheapest way Postgres does "top 1 per group". */
  const { rows: latest } = await client.query(
    `SELECT DISTINCT ON (chapter_id) chapter_id, status
       FROM submissions
      WHERE project_id = $1
      ORDER BY chapter_id, version DESC`,
    [projectId]
  );

  const statusByChapter = new Map(latest.map((r) => [r.chapter_id, r.status]));
  const approvedChapters = latest.filter((r) => r.status === "Approved").length;
  const completionPercent = Math.round((approvedChapters / TOTAL_CHAPTERS) * 100);

  /* Milestone status mirrors the chapter's latest submission. */
  const milestoneStatuses = CHAPTERS.map((c) => {
    const s = statusByChapter.get(c.id);
    if (s === "Approved") return "Completed";
    if (s === "Under Review" || s === "Needs Revision") return "In Progress";
    return "Pending";
  });

  await client.query(
    `UPDATE milestones AS m
        SET status = s.status
       FROM unnest($2::text[], $3::text[]) AS s(chapter_id, status)
      WHERE m.project_id = $1
        AND m.chapter_id = s.chapter_id
        AND m.status IS DISTINCT FROM s.status`,
    [projectId, CHAPTERS.map((c) => c.id), milestoneStatuses]
  );

  /* A project moves itself out of "Pending" once real work arrives.
     It never marks itself "Completed": that is an administrator's
     decision (Manage Projects → Mark Completed), and a completed
     project stays completed even as percentages move. */
  const { rows } = await client.query(
    `UPDATE projects
        SET completion_percent = $2,
            status = CASE
                       WHEN status = 'Completed' THEN 'Completed'
                       WHEN $3::int > 0          THEN 'In Progress'
                       ELSE status
                     END
      WHERE id = $1
      RETURNING completion_percent, status`,
    [projectId, completionPercent, latest.length]
  );

  return {
    completionPercent,
    approvedChapters,
    status: rows[0] ? rows[0].status : "Pending",
  };
}

module.exports = { seedMilestones, scheduleMilestones, recalculateProject };
