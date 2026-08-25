/* ============================================================
   src/controllers/meetingController.js — Requirement 7

   Supervisors schedule meetings; students request them. A request
   is stored as a meeting with meeting_type 'Requested' rather than
   in a separate table — it is the same event at an earlier stage,
   and keeping one table means the history view needs no union.
============================================================ */

"use strict";

const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toMeeting } = require("../utils/presenters");
const notifications = require("../services/notificationService");
const email = require("../services/email");
const { resolveMeetingLink } = require("../services/meetingLinkService");

/* Participants are aggregated into JSON so a meeting and its
   attendees arrive in one round trip. FILTER drops the NULL row a
   LEFT JOIN produces for a meeting with no participants yet. */
const MEETING_SELECT = `
  SELECT m.id, m.title, m.supervisor_id, m.organizer_id, m.scheduled_date,
         m.scheduled_time, m.duration, m.platform, m.link, m.notes,
         m.meeting_type, m.status, m.created_at,
         sv.first_name AS supervisor_first_name,
         sv.last_name  AS supervisor_last_name,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',   pu.id,
               'name', pu.first_name || ' ' || pu.last_name,
               'role', pu.role
             ) ORDER BY pu.first_name
           ) FILTER (WHERE pu.id IS NOT NULL),
           '[]'::jsonb
         ) AS participants
    FROM meetings m
    LEFT JOIN users sv ON sv.id = m.supervisor_id
    LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
    LEFT JOIN users pu ON pu.id = mp.user_id`;

const MEETING_GROUP_BY = `
  GROUP BY m.id, sv.first_name, sv.last_name`;

/**
 * Meetings that have already started are reported as Completed.
 * Deriving this from the clock keeps "Upcoming" honest without a
 * background job, and the row is updated so reports stay consistent.
 */
async function closePastMeetings() {
  await db.query(
    `UPDATE meetings
        SET status = 'Completed'
      WHERE status = 'Upcoming'
        AND (scheduled_date::text || ' ' || scheduled_time)::timestamp < now()`
  );
}

/* ══════════════════════════════════════
   GET /api/meetings
   Everything the caller organises or is invited to.
══════════════════════════════════════ */
const listMeetings = catchAsync(async (req, res) => {
  await closePastMeetings();

  const conditions = [];
  const params = [];

  if (req.user.role !== "admin") {
    params.push(req.user.id);
    const p = `$${params.length}`;
    conditions.push(
      `(m.supervisor_id = ${p} OR m.organizer_id = ${p}
        OR EXISTS (SELECT 1 FROM meeting_participants x
                    WHERE x.meeting_id = m.id AND x.user_id = ${p}))`
    );
  }

  if (req.query.status) {
    params.push(req.query.status);
    conditions.push(`m.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await db.query(
    `${MEETING_SELECT} ${where} ${MEETING_GROUP_BY}
     ORDER BY m.scheduled_date DESC, m.scheduled_time DESC`,
    params
  );

  res.json({ success: true, count: rows.length, meetings: rows.map(toMeeting) });
});

/** Re-read one meeting with its participants. */
async function loadMeeting(executor, meetingId) {
  const { rows } = await executor.query(
    `${MEETING_SELECT} WHERE m.id = $1 ${MEETING_GROUP_BY}`,
    [meetingId]
  );
  return rows[0] || null;
}

/* ══════════════════════════════════════
   POST /api/meetings   (supervisor, or admin)
   Body: title, date, time, duration, platform, link, notes, studentIds[]
══════════════════════════════════════ */
const createMeeting = catchAsync(async (req, res) => {
  const { title, date, time, duration, platform, notes } = req.body;
  const studentIds = [...new Set(req.body.studentIds || [])];

  if (studentIds.length === 0) {
    throw ApiError.badRequest("Please select at least one student for the meeting.");
  }

  const supervisorId = req.user.role === "supervisor" ? req.user.id : req.body.supervisorId || null;

  /* Validate before creating a Zoom room for a meeting that would then
     be rejected: an orphaned Zoom meeting is a real side effect. */
  const { rows: studentRows } = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, p.supervisor_id
       FROM users u
       LEFT JOIN projects p ON p.student_id = u.id
      WHERE u.id = ANY($1::uuid[]) AND u.role = 'student' AND u.status = 'active'`,
    [studentIds]
  );

  if (studentRows.length !== studentIds.length) {
    throw ApiError.badRequest("One or more of the selected students could not be found.");
  }

  if (req.user.role === "supervisor") {
    const notMine = studentRows.filter((s) => s.supervisor_id !== req.user.id);
    if (notMine.length > 0) {
      throw ApiError.forbidden("You can only schedule meetings with students you supervise.");
    }
  }

  const { link, meetingId: zoomId, warning } = await resolveMeetingLink({
    platform,
    providedLink: req.body.link || null,
    title,
    date,
    time,
    duration,
    notes,
  });

  const meeting = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO meetings
         (title, supervisor_id, organizer_id, scheduled_date, scheduled_time,
          duration, platform, link, notes, meeting_type, status, zoom_meeting_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Scheduled', 'Upcoming', $10)
       RETURNING id`,
      [
        title,
        supervisorId,
        req.user.id,
        date,
        time,
        duration || "1 hour",
        platform || "Zoom",
        link,
        notes || null,
        zoomId,
      ]
    );

    const newId = rows[0].id;

    await client.query(
      `INSERT INTO meeting_participants (meeting_id, user_id)
       SELECT $1, uid FROM unnest($2::uuid[]) AS uid
       ON CONFLICT DO NOTHING`,
      [newId, studentIds]
    );

    await notifications.notifyMany(client, studentIds, {
      type: "meeting",
      message: `A meeting has been scheduled: "${title}" on ${date} at ${time}.`,
      link: "meetings.html",
    });

    return loadMeeting(client, newId);
  });

  for (const student of studentRows) {
    email
      .activityAlert({
        to: student.email,
        name: student.first_name,
        subject: `Meeting scheduled: ${title}`,
        lines: [
          "Your supervisor has scheduled a meeting with you.",
          `${title} — ${date} at ${time} (${duration || "1 hour"}), via ${platform || "Zoom"}.`,
          link ? `Join link: ${link}` : "A joining link will follow.",
          notes ? `Agenda: ${notes}` : "",
        ].filter(Boolean),
        ctaLabel: "View meetings",
        ctaPath: "pages/Student/meetings.html",
      })
      .catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: warning
      ? `Meeting scheduled. ${warning}`
      : "Meeting scheduled. The student has been notified.",
    warning: warning || undefined,
    meeting: toMeeting(meeting),
  });
});

/* ══════════════════════════════════════
   POST /api/meetings/request   (student)
   Body: topic, date, time, platform, notes
══════════════════════════════════════ */
const requestMeeting = catchAsync(async (req, res) => {
  const { topic, date, time, platform, notes } = req.body;

  const result = await db.withTransaction(async (client) => {
    const { rows: projectRows } = await client.query(
      `SELECT p.supervisor_id,
              v.first_name AS supervisor_first_name,
              v.email      AS supervisor_email
         FROM projects p
         LEFT JOIN users v ON v.id = p.supervisor_id
        WHERE p.student_id = $1`,
      [req.user.id]
    );
    const project = projectRows[0];

    if (!project || !project.supervisor_id) {
      throw ApiError.badRequest(
        "You do not have a supervisor assigned yet, so there is nobody to send this request to."
      );
    }

    const { rows } = await client.query(
      `INSERT INTO meetings
         (title, supervisor_id, organizer_id, scheduled_date, scheduled_time,
          duration, platform, notes, meeting_type, status)
       VALUES ($1, $2, $3, $4, $5, '1 hour', $6, $7, 'Requested', 'Upcoming')
       RETURNING id`,
      [topic, project.supervisor_id, req.user.id, date, time, platform || "Zoom", notes || null]
    );

    const studentName = `${req.user.first_name} ${req.user.last_name}`;

    await client.query(
      "INSERT INTO meeting_participants (meeting_id, user_id) VALUES ($1, $2)",
      [rows[0].id, req.user.id]
    );

    await notifications.notify(client, {
      userId: project.supervisor_id,
      type: "meeting",
      message: `${studentName} requested a meeting: "${topic}" on ${date} at ${time}.`,
      link: "schedule.html",
    });

    return { meeting: await loadMeeting(client, rows[0].id), project, studentName };
  });

  if (result.project.supervisor_email) {
    email
      .activityAlert({
        to: result.project.supervisor_email,
        name: result.project.supervisor_first_name,
        subject: `Meeting request from ${result.studentName}`,
        lines: [
          `${result.studentName} has requested a meeting.`,
          `${topic} — proposed for ${date} at ${time}, via ${platform || "Zoom"}.`,
          notes ? `Notes: ${notes}` : "",
        ].filter(Boolean),
        ctaLabel: "Open schedule",
        ctaPath: "pages/supervisor/schedule.html",
      })
      .catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: "Meeting request sent to your supervisor.",
    meeting: toMeeting(result.meeting),
  });
});

/**
 * A meeting the caller may modify: its supervisor, its organiser,
 * or an admin.
 */
async function loadMeetingForEdit(client, meetingId, user) {
  const { rows } = await client.query(
    "SELECT id, title, supervisor_id, organizer_id, status, platform, link FROM meetings WHERE id = $1",
    [meetingId]
  );
  const meeting = rows[0];
  if (!meeting) throw ApiError.notFound("That meeting does not exist.");

  const mayEdit =
    user.role === "admin" ||
    meeting.supervisor_id === user.id ||
    meeting.organizer_id === user.id;

  if (!mayEdit) throw ApiError.forbidden("You cannot change that meeting.");
  return meeting;
}

/* ══════════════════════════════════════
   PUT /api/meetings/:id
   Confirm a requested meeting, move it, change the link or status.
══════════════════════════════════════ */
const updateMeeting = catchAsync(async (req, res) => {
  const meetingId = req.params.id;

  const meeting = await db.withTransaction(async (client) => {
    const existing = await loadMeetingForEdit(client, meetingId, req.user);

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.date !== undefined) updates.scheduled_date = req.body.date;
    if (req.body.time !== undefined) updates.scheduled_time = req.body.time;
    if (req.body.duration !== undefined) updates.duration = req.body.duration;
    if (req.body.platform !== undefined) updates.platform = req.body.platform;
    if (req.body.link !== undefined) updates.link = req.body.link || null;
    if (req.body.notes !== undefined) updates.notes = req.body.notes || null;
    if (req.body.status !== undefined) {
      if (!["Upcoming", "Completed", "Cancelled"].includes(req.body.status)) {
        throw ApiError.badRequest("Status must be Upcoming, Completed or Cancelled.");
      }
      updates.status = req.body.status;
    }
    /* Confirming a student's request turns it into a scheduled meeting. */
    if (req.body.confirm === true) updates.meeting_type = "Scheduled";

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest("There is nothing to update.");
    }

    const columns = Object.keys(updates);
    const assignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

    await client.query(`UPDATE meetings SET ${assignments} WHERE id = $1`, [
      meetingId,
      ...columns.map((c) => updates[c]),
    ]);

    const { rows: participants } = await client.query(
      "SELECT user_id FROM meeting_participants WHERE meeting_id = $1",
      [meetingId]
    );
    const recipients = participants.map((p) => p.user_id).filter((id) => id !== req.user.id);

    if (updates.status === "Cancelled") {
      await notifications.notifyMany(client, recipients, {
        type: "meeting",
        message: `The meeting "${updates.title || existing.title}" has been cancelled.`,
        link: "meetings.html",
      });
    } else if (req.body.confirm === true) {
      await notifications.notifyMany(client, recipients, {
        type: "meeting",
        message: `Your meeting request "${updates.title || existing.title}" has been confirmed.`,
        link: "meetings.html",
      });
    }

    return loadMeeting(client, meetingId);
  });

  res.json({ success: true, message: "Meeting updated.", meeting: toMeeting(meeting) });
});

/* ══════════════════════════════════════
   DELETE /api/meetings/:id
══════════════════════════════════════ */
const deleteMeeting = catchAsync(async (req, res) => {
  await db.withTransaction(async (client) => {
    const existing = await loadMeetingForEdit(client, req.params.id, req.user);

    const { rows: participants } = await client.query(
      "SELECT user_id FROM meeting_participants WHERE meeting_id = $1",
      [req.params.id]
    );

    await notifications.notifyMany(
      client,
      participants.map((p) => p.user_id).filter((id) => id !== req.user.id),
      {
        type: "meeting",
        message: `The meeting "${existing.title}" has been removed from your schedule.`,
        link: "meetings.html",
      }
    );

    await client.query("DELETE FROM meetings WHERE id = $1", [req.params.id]);
  });

  res.json({ success: true, message: "Meeting removed." });
});

module.exports = {
  listMeetings,
  createMeeting,
  requestMeeting,
  updateMeeting,
  deleteMeeting,
};
