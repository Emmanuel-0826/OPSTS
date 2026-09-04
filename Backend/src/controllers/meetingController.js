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
const { toMeeting, dateOnly } = require("../utils/presenters");
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

   studentIds is a list, not a single id, so one call covers both
   "meet this student" and "meet everyone I supervise" — the second
   is the same meeting with more participants, not a different kind
   of thing.
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

  /* One meeting can now cover a supervisor's whole cohort, so the
     confirmation says how many people it reached rather than
     assuming there was exactly one. */
  const invited =
    studentRows.length === 1
      ? "The student has been notified."
      : `All ${studentRows.length} students have been notified.`;

  res.status(201).json({
    success: true,
    message: warning ? `Meeting scheduled. ${warning}` : `Meeting scheduled. ${invited}`,
    warning: warning || undefined,
    meeting: toMeeting(meeting),
  });
});

/* ══════════════════════════════════════
   POST /api/meetings/request   (student)
   Body: topic, date, time, platform, link, notes
══════════════════════════════════════ */
const requestMeeting = catchAsync(async (req, res) => {
  const { topic, date, time, platform, notes } = req.body;
  /* The request form has always had a link field and the controller
     never read it, so a student who pasted their own room URL saw it
     silently dropped and the meeting arrived with no way to join. */
  const link = req.body.link || null;

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
          duration, platform, link, notes, meeting_type, status)
       VALUES ($1, $2, $3, $4, $5, '1 hour', $6, $7, $8, 'Requested', 'Upcoming')
       RETURNING id`,
      [topic, project.supervisor_id, req.user.id, date, time, platform || "Zoom", link, notes || null]
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
          link ? `They suggested this link: ${link}` : "",
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
 * or an admin. Takes an executor so it can be used both for the
 * pre-flight read (on the pool) and for the authoritative check
 * inside the transaction.
 */
async function loadMeetingForEdit(executor, meetingId, user) {
  const { rows } = await executor.query(
    `SELECT id, title, supervisor_id, organizer_id, status, platform, link,
            scheduled_date, scheduled_time, duration, notes, meeting_type
       FROM meetings WHERE id = $1`,
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

/** Everyone invited except the person making the change. */
async function loadRecipients(executor, meetingId, excludeUserId) {
  const { rows } = await executor.query(
    `SELECT u.id, u.first_name, u.email, u.role
       FROM meeting_participants mp
       JOIN users u ON u.id = mp.user_id
      WHERE mp.meeting_id = $1 AND u.id <> $2`,
    [meetingId, excludeUserId]
  );
  return rows;
}

/* ══════════════════════════════════════
   PUT /api/meetings/:id
   Confirm a requested meeting, move it, change the link or status.
══════════════════════════════════════ */
const updateMeeting = catchAsync(async (req, res) => {
  const meetingId = req.params.id;

  /* Read once before opening the transaction. Confirming a request
     can involve a Zoom round trip, and an outbound HTTP call has no
     business holding a database transaction open while it waits —
     the permission check is repeated inside, on the same row. */
  const before = await loadMeetingForEdit(db, meetingId, req.user);

  const nextPlatform = req.body.platform !== undefined ? req.body.platform : before.platform;

  /* Confirming a student's request is the moment the meeting becomes
     real, so it is also the moment it needs somewhere to happen.
     Only when nobody has supplied a link and the meeting is not
     in person; resolveMeetingLink never throws and returns a null
     link rather than inventing one that leads nowhere. */
  const shouldGenerateLink =
    req.body.confirm === true &&
    !req.body.link &&
    !before.link &&
    nextPlatform !== "In-Person";

  let generatedLink = null;
  let generatedZoomId = null;
  let linkWarning = null;

  if (shouldGenerateLink) {
    const resolved = await resolveMeetingLink({
      platform: nextPlatform,
      providedLink: null,
      title: req.body.title || before.title,
      date: req.body.date || dateOnly(before.scheduled_date),
      time: req.body.time || before.scheduled_time,
      duration: req.body.duration || before.duration,
      notes: req.body.notes !== undefined ? req.body.notes : before.notes,
    });
    generatedLink = resolved.link;
    generatedZoomId = resolved.meetingId;
    linkWarning = resolved.warning;
  }

  const outcome = await db.withTransaction(async (client) => {
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

    if (generatedLink) {
      updates.link = generatedLink;
      if (generatedZoomId) updates.zoom_meeting_id = generatedZoomId;
    }

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest("There is nothing to update.");
    }

    const columns = Object.keys(updates);
    const assignments = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");

    await client.query(`UPDATE meetings SET ${assignments} WHERE id = $1`, [
      meetingId,
      ...columns.map((c) => updates[c]),
    ]);

    const recipients = await loadRecipients(client, meetingId, req.user.id);
    const recipientIds = recipients.map((r) => r.id);

    const title = updates.title || existing.title;
    const linkAfter = updates.link !== undefined ? updates.link : existing.link;
    /* A link appearing on a meeting that had none is news in its own
       right — it is the difference between "we are meeting" and
       "here is where". */
    const linkAdded = Boolean(!existing.link && linkAfter);

    let event = null;

    if (updates.status === "Cancelled") {
      event = "cancelled";
      await notifications.notifyMany(client, recipientIds, {
        type: "meeting",
        message: `The meeting "${title}" has been cancelled.`,
        link: "meetings.html",
      });
    } else if (req.body.confirm === true) {
      event = "confirmed";
      await notifications.notifyMany(client, recipientIds, {
        type: "meeting",
        message: `Your meeting request "${title}" has been confirmed.`,
        link: "meetings.html",
      });
    } else if (linkAdded) {
      event = "link";
      await notifications.notifyMany(client, recipientIds, {
        type: "meeting",
        message: `A joining link has been added to "${title}".`,
        link: "meetings.html",
      });
    }

    return {
      meeting: await loadMeeting(client, meetingId),
      recipients,
      event,
      title,
      linkAfter,
      platform: updates.platform || existing.platform,
    };
  });

  /* Mail after the commit, never inside it: a mail server that is
     slow or down must not be able to roll back a confirmed meeting. */
  if (outcome.event) sendMeetingUpdateEmails(outcome);

  res.json({
    success: true,
    message: linkWarning ? `Meeting updated. ${linkWarning}` : "Meeting updated.",
    warning: linkWarning || undefined,
    meeting: toMeeting(outcome.meeting),
  });
});

/** Fire-and-forget mail for a confirmed, cancelled or newly-linked meeting. */
function sendMeetingUpdateEmails({ recipients, event, title, linkAfter, platform, meeting }) {
  const when = `${dateOnly(meeting.scheduled_date)} at ${meeting.scheduled_time}`;

  const copy = {
    confirmed: {
      subject: `Meeting confirmed: ${title}`,
      lines: [`Your meeting request has been confirmed.`, `${title} — ${when}, via ${platform}.`],
    },
    cancelled: {
      subject: `Meeting cancelled: ${title}`,
      lines: [`The meeting "${title}" scheduled for ${when} has been cancelled.`],
    },
    link: {
      subject: `Joining link added: ${title}`,
      lines: [`A joining link has been added to "${title}" (${when}).`],
    },
  }[event];

  if (!copy) return;

  for (const person of recipients) {
    if (!person.email) continue;
    email
      .activityAlert({
        to: person.email,
        name: person.first_name,
        subject: copy.subject,
        lines: copy.lines
          .concat(event !== "cancelled" && linkAfter ? [`Join link: ${linkAfter}`] : [])
          .filter(Boolean),
        ctaLabel: "View meetings",
        /* Supervisors can be on the receiving end too — a student
           may move or cancel their own request — and the two
           portals keep their meeting pages in different folders. */
        ctaPath: person.role === "supervisor"
          ? "pages/supervisor/schedule.html"
          : "pages/Student/meetings.html",
      })
      .catch(() => {});
  }
}

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
