/* ============================================================
   src/controllers/userController.js — Requirements 1 & 10

   User management for administrators, plus the self-service
   profile update every role uses.

   The rule that shapes this file: a user may edit their own
   profile, but only an administrator may change anything that
   confers access — role, status, index/staff number. Those fields
   are stripped from a self-update rather than rejected, so an
   ordinary "save profile" never fails just because the client
   sent an extra field.
============================================================ */

"use strict";

const bcrypt = require("bcryptjs");
const config = require("../config/env");
const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toUser } = require("../utils/presenters");
const notifications = require("../services/notificationService");
const email = require("../services/email");
const { seedMilestones } = require("../services/progressService");

const USER_COLUMNS = `
  id, first_name, last_name, email, role, status, department,
  index_number, staff_id, level, specialization, must_change_password,
  proposed_topic, created_at, last_login_at`;

/* A student names their topic when they register. Their project
   shell is created later, at approval, so the topic has to travel
   on the user row until there is a project to put it on. The
   fallback keeps the old placeholder for accounts created before
   the registration form asked. */
const PROJECT_SHELL_SQL = `
  INSERT INTO projects (student_id, title, topic)
  VALUES ($1, COALESCE(NULLIF(btrim($2), ''), 'Untitled Project'), NULLIF(btrim($2), ''))
  ON CONFLICT (student_id) DO NOTHING
  RETURNING id`;

/* ══════════════════════════════════════
   GET /api/users
   Admin only. Filters: ?role= &status= &search=
══════════════════════════════════════ */
const listUsers = catchAsync(async (req, res) => {
  const { role, status, search } = req.query;

  /* Filters are appended as parameters, never as SQL text. */
  const conditions = [];
  const params = [];

  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.trim()}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(first_name ILIKE ${p} OR last_name ILIKE ${p} OR email ILIKE ${p}
        OR index_number ILIKE ${p} OR staff_id ILIKE ${p}
        OR (first_name || ' ' || last_name) ILIKE ${p})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS} FROM users ${where}
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        first_name, last_name`,
    params
  );

  res.json({ success: true, count: rows.length, users: rows.map(toUser) });
});

/* ══════════════════════════════════════
   GET /api/users/:id
   Self, or admin.
══════════════════════════════════════ */
const getUser = catchAsync(async (req, res) => {
  if (req.user.role !== "admin" && req.user.id !== req.params.id) {
    throw ApiError.forbidden("You can only view your own profile.");
  }

  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
    req.params.id,
  ]);
  if (!rows[0]) throw ApiError.notFound("That user does not exist.");

  res.json({ success: true, user: toUser(rows[0]) });
});

/* ══════════════════════════════════════
   GET /api/users/supervisor/:id/students
   A supervisor's own list, or any list for an admin.
══════════════════════════════════════ */
const listSupervisorStudents = catchAsync(async (req, res) => {
  const supervisorId = req.params.id;

  if (req.user.role === "supervisor" && req.user.id !== supervisorId) {
    throw ApiError.forbidden("You can only view the students assigned to you.");
  }
  if (req.user.role === "student") {
    throw ApiError.forbidden("This action is only available to supervisor or admin accounts.");
  }

  const { rows } = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.status,
            u.department, u.index_number, u.staff_id, u.level, u.specialization,
            u.must_change_password,
            u.created_at, u.last_login_at
       FROM projects p
       JOIN users u ON u.id = p.student_id
      WHERE p.supervisor_id = $1
      ORDER BY u.first_name, u.last_name`,
    [supervisorId]
  );

  res.json({ success: true, count: rows.length, students: rows.map(toUser) });
});

/* ══════════════════════════════════════
   POST /api/users
   Admin creates an account directly — it starts active, because an
   administrator creating it *is* the approval step.
══════════════════════════════════════ */
const createUser = catchAsync(async (req, res) => {
  const { role, firstName, lastName, email: address, password, department } = req.body;

  const indexNumber = role === "student" ? (req.body.indexNumber || "").trim() : null;
  const staffId = role !== "student" ? (req.body.staffId || "").trim() : null;

  if (role === "student" && !indexNumber) {
    throw ApiError.badRequest("An index number is required for student accounts.");
  }
  if (role !== "student" && !staffId) {
    throw ApiError.badRequest("A staff ID is required for supervisor and admin accounts.");
  }

  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

  const user = await db.withTransaction(async (client) => {
    /* must_change_password: the administrator chose this password, not
       the account's owner, so prompt them to replace it on first use. */
    const { rows } = await client.query(
      `INSERT INTO users
         (first_name, last_name, email, password_hash, role, status,
          department, index_number, staff_id, level, specialization,
          must_change_password)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, TRUE)
       RETURNING ${USER_COLUMNS}`,
      [
        firstName,
        lastName,
        address,
        passwordHash,
        role,
        department || null,
        indexNumber || null,
        staffId || null,
        role === "student" ? req.body.level || "Level 400" : null,
        role === "supervisor" ? req.body.specialization || null : null,
      ]
    );

    const created = rows[0];

    /* Every active student gets a project shell immediately, so the
       Assign Supervisors page has something to attach a supervisor to
       and the student's dashboard is not empty on first sign-in. */
    if (created.role === "student") {
      const { rows: projectRows } = await client.query(PROJECT_SHELL_SQL, [
        created.id,
        req.body.projectTopic || null,
      ]);
      if (projectRows[0]) await seedMilestones(client, projectRows[0].id);
    }

    return created;
  });

  /* Best-effort: the admin UI also shows the password on screen, so a
     failed email is an inconvenience, not a lost account. */
  email
    .accountCreated({
      to: user.email,
      name: user.first_name,
      temporaryPassword: password,
    })
    .catch(() => {});

  res.status(201).json({
    success: true,
    message: `${user.first_name} ${user.last_name} was added successfully.`,
    user: toUser(user),
  });
});

/* ══════════════════════════════════════
   PUT /api/users/:id
   Self-service profile edit, or an admin editing anyone.
══════════════════════════════════════ */
const updateUser = catchAsync(async (req, res) => {
  const targetId = req.params.id;
  const isAdmin = req.user.role === "admin";
  const isSelf = req.user.id === targetId;

  if (!isAdmin && !isSelf) {
    throw ApiError.forbidden("You can only update your own profile.");
  }

  const { rows: existingRows } = await db.query(
    "SELECT id, role, status, email, first_name, last_name FROM users WHERE id = $1",
    [targetId]
  );
  const existing = existingRows[0];
  if (!existing) throw ApiError.notFound("That user does not exist.");

  /* Fields anyone may change about themselves. */
  const updates = {};
  if (req.body.firstName !== undefined) updates.first_name = req.body.firstName;
  if (req.body.lastName !== undefined) updates.last_name = req.body.lastName;
  if (req.body.specialization !== undefined) {
    if (existing.role !== "supervisor") {
      throw ApiError.badRequest("Only supervisors have a specialization.");
    }
    updates.specialization = req.body.specialization || null;
  }

  /* Fields that grant or restrict access — administrators only. */
  if (isAdmin) {
    if (req.body.department !== undefined) updates.department = req.body.department || null;
    if (req.body.level !== undefined) updates.level = req.body.level || null;
    if (req.body.indexNumber !== undefined) updates.index_number = req.body.indexNumber || null;
    if (req.body.staffId !== undefined) updates.staff_id = req.body.staffId || null;
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.status !== undefined) {
      if (!["pending", "active", "suspended"].includes(req.body.status)) {
        throw ApiError.badRequest("Status must be pending, active or suspended.");
      }
      if (targetId === req.user.id && req.body.status !== "active") {
        throw ApiError.badRequest("You cannot deactivate your own administrator account.");
      }
      updates.status = req.body.status;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("There is nothing to update.");
  }

  const columns = Object.keys(updates);
  const assignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

  const { rows } = await db.query(
    `UPDATE users SET ${assignments} WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [targetId, ...columns.map((c) => updates[c])]
  );

  res.json({
    success: true,
    message: "Profile updated successfully.",
    user: toUser(rows[0]),
  });
});

/* ══════════════════════════════════════
   PATCH /api/users/:id/approve
   Approving a student also gives them a project shell — titled with
   the topic they registered — so an admin can assign a supervisor
   straight away without a second step and without inventing a topic.
══════════════════════════════════════ */
const approveUser = catchAsync(async (req, res) => {
  const targetId = req.params.id;

  const user = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET status = 'active'
        WHERE id = $1 AND status <> 'active'
        RETURNING ${USER_COLUMNS}`,
      [targetId]
    );

    if (!rows[0]) {
      const { rows: check } = await client.query("SELECT status FROM users WHERE id = $1", [
        targetId,
      ]);
      if (!check[0]) throw ApiError.notFound("That user does not exist.");
      throw ApiError.conflict("That account is already active.");
    }

    const approved = rows[0];

    if (approved.role === "student") {
      const { rows: projectRows } = await client.query(PROJECT_SHELL_SQL, [
        approved.id,
        approved.proposed_topic,
      ]);
      if (projectRows[0]) await seedMilestones(client, projectRows[0].id);
    }

    await notifications.notify(client, {
      userId: approved.id,
      type: "approval",
      message:
        "Your account has been approved. Welcome to OPSTS!" +
        (approved.role === "student" && approved.proposed_topic
          ? ` Your project has been created with the topic you registered: "${approved.proposed_topic}".`
          : ""),
      link: "dashboard.html",
    });

    return approved;
  });

  email.accountApproved({ to: user.email, name: user.first_name }).catch(() => {});

  res.json({
    success: true,
    message: `${user.first_name} ${user.last_name} has been approved.`,
    user: toUser(user),
  });
});

/* ══════════════════════════════════════
   DELETE /api/users/:id
   Hard delete. The schema cascades to that user's project,
   submissions, feedback and notifications.
══════════════════════════════════════ */
const deleteUser = catchAsync(async (req, res) => {
  const targetId = req.params.id;

  if (targetId === req.user.id) {
    throw ApiError.badRequest("You cannot remove your own account.");
  }

  const { rows } = await db.query(
    "SELECT id, role, first_name, last_name FROM users WHERE id = $1",
    [targetId]
  );
  const target = rows[0];
  if (!target) throw ApiError.notFound("That user does not exist.");

  /* Removing the last administrator would lock everyone out of user
     management with no way back in. */
  if (target.role === "admin") {
    const { rows: countRows } = await db.query(
      "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'"
    );
    if (countRows[0].n <= 1) {
      throw ApiError.badRequest("You cannot remove the only remaining administrator.");
    }
  }

  await db.query("DELETE FROM users WHERE id = $1", [targetId]);

  res.json({
    success: true,
    message: `${target.first_name} ${target.last_name} has been removed.`,
  });
});

module.exports = {
  listUsers,
  getUser,
  listSupervisorStudents,
  createUser,
  updateUser,
  approveUser,
  deleteUser,
};
