/* ============================================================
   src/controllers/projectController.js — Requirements 3, 6, 10

   Project records, supervisor assignment and milestones.

   Scoping is enforced in SQL, not after the fact: a student's query
   is filtered by their own id in the WHERE clause, so there is no
   moment where another student's project has been loaded into
   memory and is relying on a later check to stay hidden.
============================================================ */

"use strict";

const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toProject, toMilestone } = require("../utils/presenters");
const notifications = require("../services/notificationService");
const email = require("../services/email");
const { seedMilestones, scheduleMilestones } = require("../services/progressService");

/* One SELECT list, joined to both sides, used by every read here.
   The student portal renders a supervisor card straight off the
   project, which is why the supervisor's contact details ride along. */
const PROJECT_SELECT = `
  SELECT p.id, p.student_id, p.supervisor_id, p.title, p.topic, p.topic_status,
         p.status, p.completion_percent, p.start_date, p.deadline, p.created_at,
         s.first_name  AS student_first_name,
         s.last_name   AS student_last_name,
         s.index_number AS student_index_number,
         s.department  AS student_department,
         v.first_name  AS supervisor_first_name,
         v.last_name   AS supervisor_last_name,
         v.email       AS supervisor_email,
         v.department  AS supervisor_department,
         v.specialization AS supervisor_specialization
    FROM projects p
    JOIN users s ON s.id = p.student_id
    LEFT JOIN users v ON v.id = p.supervisor_id`;

/**
 * Load a project the caller is allowed to touch, or throw.
 * @param {object} executor  db or transaction client
 */
async function loadProjectFor(executor, projectId, user) {
  const { rows } = await executor.query(
    "SELECT id, student_id, supervisor_id, title, status, start_date, deadline FROM projects WHERE id = $1",
    [projectId]
  );
  const project = rows[0];
  if (!project) throw ApiError.notFound("That project does not exist.");

  if (user.role === "student" && project.student_id !== user.id) {
    throw ApiError.forbidden("That is not your project.");
  }
  if (user.role === "supervisor" && project.supervisor_id !== user.id) {
    throw ApiError.forbidden("You do not supervise that project.");
  }
  return project;
}

/* ══════════════════════════════════════
   GET /api/projects
   Student → their own. Supervisor → their assigned projects.
   Admin   → everything, with optional ?status= and ?search=.
══════════════════════════════════════ */
const listProjects = catchAsync(async (req, res) => {
  const conditions = [];
  const params = [];

  if (req.user.role === "student") {
    params.push(req.user.id);
    conditions.push(`p.student_id = $${params.length}`);
  } else if (req.user.role === "supervisor") {
    params.push(req.user.id);
    conditions.push(`p.supervisor_id = $${params.length}`);
  }

  if (req.query.status) {
    params.push(req.query.status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (req.query.supervisorId && req.user.role === "admin") {
    params.push(req.query.supervisorId);
    conditions.push(`p.supervisor_id = $${params.length}`);
  }
  if (req.query.search) {
    params.push(`%${req.query.search.trim()}%`);
    const p = `$${params.length}`;
    conditions.push(`(p.title ILIKE ${p} OR (s.first_name || ' ' || s.last_name) ILIKE ${p})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.query(
    `${PROJECT_SELECT} ${where} ORDER BY s.first_name, s.last_name`,
    params
  );

  res.json({ success: true, count: rows.length, projects: rows.map(toProject) });
});

/* ══════════════════════════════════════
   GET /api/projects/:id
══════════════════════════════════════ */
const getProject = catchAsync(async (req, res) => {
  await loadProjectFor(db, req.params.id, req.user);

  const { rows } = await db.query(`${PROJECT_SELECT} WHERE p.id = $1`, [req.params.id]);
  res.json({ success: true, project: toProject(rows[0]) });
});

async function assertSupervisor(client, supervisorId) {
  const { rows } = await client.query(
    "SELECT id, role, status, first_name, last_name, email FROM users WHERE id = $1",
    [supervisorId]
  );
  const supervisor = rows[0];
  if (!supervisor) throw ApiError.badRequest("That supervisor does not exist.");
  if (supervisor.role !== "supervisor") throw ApiError.badRequest("That user is not a supervisor.");
  if (supervisor.status !== "active") {
    throw ApiError.badRequest("That supervisor's account is not active.");
  }
  return supervisor;
}

/* ══════════════════════════════════════
   POST /api/projects
   Admin creates a project record for a student.
══════════════════════════════════════ */
const createProject = catchAsync(async (req, res) => {
  const { studentId, supervisorId, title, topic, startDate, deadline } = req.body;

  const project = await db.withTransaction(async (client) => {
    const { rows: studentRows } = await client.query(
      "SELECT id, role, first_name, last_name FROM users WHERE id = $1",
      [studentId]
    );
    const student = studentRows[0];
    if (!student) throw ApiError.badRequest("That student does not exist.");
    if (student.role !== "student") throw ApiError.badRequest("That user is not a student.");

    if (supervisorId) await assertSupervisor(client, supervisorId);

    const { rows: existing } = await client.query(
      "SELECT id FROM projects WHERE student_id = $1",
      [studentId]
    );
    if (existing[0]) {
      throw ApiError.conflict(
        `${student.first_name} ${student.last_name} already has a project. Edit that one instead.`
      );
    }

    const { rows } = await client.query(
      `INSERT INTO projects (student_id, supervisor_id, title, topic, start_date, deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        studentId,
        supervisorId || null,
        title || "Untitled Project",
        topic || null,
        startDate || null,
        deadline || null,
        supervisorId ? "In Progress" : "Pending",
      ]
    );

    const projectId = rows[0].id;
    await seedMilestones(client, projectId);
    await scheduleMilestones(client, projectId);

    await notifications.notify(client, {
      userId: studentId,
      type: "system",
      message: `A project record has been created for you: "${title || "Untitled Project"}".`,
      link: "dashboard.html",
    });

    const { rows: full } = await client.query(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
    return full[0];
  });

  res.status(201).json({
    success: true,
    message: "Project created successfully.",
    project: toProject(project),
  });
});

/* ══════════════════════════════════════
   POST /api/projects/assign-supervisor
   Admin. Creates the project if the student does not have one yet,
   so "assign a supervisor" is a single action from the admin UI.
══════════════════════════════════════ */
const assignSupervisor = catchAsync(async (req, res) => {
  const { studentId, supervisorId, title } = req.body;

  const result = await db.withTransaction(async (client) => {
    const { rows: studentRows } = await client.query(
      "SELECT id, role, status, first_name, last_name FROM users WHERE id = $1",
      [studentId]
    );
    const student = studentRows[0];
    if (!student) throw ApiError.badRequest("That student does not exist.");
    if (student.role !== "student") throw ApiError.badRequest("That user is not a student.");

    const supervisor = await assertSupervisor(client, supervisorId);

    /* One statement covers both "create" and "reassign", so a student
       can never end up with two project rows in a race. */
    const { rows } = await client.query(
      `INSERT INTO projects (student_id, supervisor_id, title, status)
            VALUES ($1, $2, COALESCE($3, 'Untitled Project'), 'In Progress')
       ON CONFLICT (student_id) DO UPDATE
            SET supervisor_id = EXCLUDED.supervisor_id,
                title  = COALESCE($3, projects.title),
                status = CASE WHEN projects.status = 'Pending'
                              THEN 'In Progress' ELSE projects.status END
       RETURNING id, (xmax = 0) AS was_created`,
      [studentId, supervisorId, title || null]
    );

    const { id: projectId, was_created: wasCreated } = rows[0];
    await seedMilestones(client, projectId);
    await scheduleMilestones(client, projectId);

    /* Submissions carry their supervisor so a supervisor's review
       queue is a single indexed lookup. Reassignment has to move the
       existing ones across too, or they would stay in the old
       supervisor's queue forever. */
    await client.query(
      "UPDATE submissions SET supervisor_id = $2 WHERE project_id = $1",
      [projectId, supervisorId]
    );

    await notifications.notify(client, {
      userId: studentId,
      type: "system",
      message: `${supervisor.first_name} ${supervisor.last_name} has been assigned as your project supervisor.`,
      link: "dashboard.html",
    });

    await notifications.notify(client, {
      userId: supervisorId,
      type: "system",
      message: `${student.first_name} ${student.last_name} has been assigned to you for supervision.`,
      link: "students.html",
    });

    const { rows: full } = await client.query(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
    return { project: full[0], student, supervisor, wasCreated };
  });

  email
    .activityAlert({
      to: result.supervisor.email,
      name: result.supervisor.first_name,
      subject: "A new student has been assigned to you",
      lines: [
        `${result.student.first_name} ${result.student.last_name} has been assigned to you for project supervision.`,
        "You can review their submissions and schedule meetings from your OPSTS dashboard.",
      ],
      ctaLabel: "Open OPSTS",
      ctaPath: "pages/supervisor/students.html",
    })
    .catch(() => {});

  res.status(result.wasCreated ? 201 : 200).json({
    success: true,
    message: `${result.supervisor.first_name} ${result.supervisor.last_name} is now supervising ${result.student.first_name} ${result.student.last_name}.`,
    project: toProject(result.project),
  });
});

/* ══════════════════════════════════════
   PUT /api/projects/:id
   Admin edits dates, status, title and topic. A supervisor may edit
   the title/topic of a project they supervise, and nothing else.
══════════════════════════════════════ */
const ADMIN_ONLY_FIELDS = {
  status: "status",
  completionPercent: "completion_percent",
  startDate: "start_date",
  deadline: "deadline",
  supervisorId: "supervisor_id",
  topicStatus: "topic_status",
};

const updateProject = catchAsync(async (req, res) => {
  const projectId = req.params.id;

  const project = await db.withTransaction(async (client) => {
    const existing = await loadProjectFor(client, projectId, req.user);
    const isAdmin = req.user.role === "admin";

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.topic !== undefined) updates.topic = req.body.topic || null;

    for (const [field, column] of Object.entries(ADMIN_ONLY_FIELDS)) {
      if (req.body[field] === undefined) continue;
      if (!isAdmin) {
        throw ApiError.forbidden(`Only an administrator can change a project's ${field}.`);
      }
      updates[column] = req.body[field] === "" ? null : req.body[field];
    }

    if (updates.supervisor_id) await assertSupervisor(client, updates.supervisor_id);

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest("There is nothing to update.");
    }

    /* Dates only make sense in order; catching it here gives a clear
       message instead of a silently impossible milestone schedule. */
    const nextStart = updates.start_date ?? existing.start_date;
    const nextDeadline = updates.deadline ?? existing.deadline;
    if (nextStart && nextDeadline && String(nextDeadline) < String(nextStart)) {
      throw ApiError.badRequest("The deadline cannot fall before the start date.");
    }

    const columns = Object.keys(updates);
    const assignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

    await client.query(`UPDATE projects SET ${assignments} WHERE id = $1`, [
      projectId,
      ...columns.map((c) => updates[c]),
    ]);

    if (updates.start_date !== undefined || updates.deadline !== undefined) {
      await scheduleMilestones(client, projectId, { overwrite: true });
    }

    if (updates.status === "Completed") {
      await notifications.notify(client, {
        userId: existing.student_id,
        type: "approval",
        message: `Your project "${updates.title || existing.title}" has been marked as completed. Congratulations!`,
        link: "progress.html",
      });
    }

    if (updates.deadline !== undefined && updates.deadline) {
      await notifications.notify(client, {
        userId: existing.student_id,
        type: "deadline",
        message: `Your project deadline has been set to ${updates.deadline}.`,
        link: "progress.html",
      });
    }

    const { rows } = await client.query(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
    return rows[0];
  });

  res.json({
    success: true,
    message: "Project updated successfully.",
    project: toProject(project),
  });
});

/* ══════════════════════════════════════
   DELETE /api/projects/:id  (admin)
══════════════════════════════════════ */
const deleteProject = catchAsync(async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
  if (rowCount === 0) throw ApiError.notFound("That project does not exist.");
  res.json({ success: true, message: "Project deleted." });
});

/* ══════════════════════════════════════
   GET /api/projects/milestones/:projectId
══════════════════════════════════════ */
const listMilestones = catchAsync(async (req, res) => {
  await loadProjectFor(db, req.params.projectId, req.user);

  const { rows } = await db.query(
    `SELECT id, project_id, chapter_id, label, due_date, status, position
       FROM milestones
      WHERE project_id = $1
      ORDER BY position, created_at`,
    [req.params.projectId]
  );

  res.json({ success: true, count: rows.length, milestones: rows.map(toMilestone) });
});

/* ══════════════════════════════════════
   PUT /api/projects/milestones/:id
   Supervisor or admin adjusts a milestone's due date or label.
   Status is derived from submissions and is not editable by hand —
   see services/progressService.js.
══════════════════════════════════════ */
const updateMilestone = catchAsync(async (req, res) => {
  const { rows: milestoneRows } = await db.query(
    "SELECT id, project_id FROM milestones WHERE id = $1",
    [req.params.id]
  );
  if (!milestoneRows[0]) throw ApiError.notFound("That milestone does not exist.");

  await loadProjectFor(db, milestoneRows[0].project_id, req.user);

  const updates = {};
  if (req.body.label !== undefined) updates.label = req.body.label;
  if (req.body.dueDate !== undefined) updates.due_date = req.body.dueDate || null;

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("There is nothing to update.");
  }

  const columns = Object.keys(updates);
  const assignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

  const { rows } = await db.query(
    `UPDATE milestones SET ${assignments} WHERE id = $1
     RETURNING id, project_id, chapter_id, label, due_date, status, position`,
    [req.params.id, ...columns.map((c) => updates[c])]
  );

  res.json({ success: true, message: "Milestone updated.", milestone: toMilestone(rows[0]) });
});

module.exports = {
  listProjects,
  getProject,
  createProject,
  assignSupervisor,
  updateProject,
  deleteProject,
  listMilestones,
  updateMilestone,
};
