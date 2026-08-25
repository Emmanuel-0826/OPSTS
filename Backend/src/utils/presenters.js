/* ============================================================
   src/utils/presenters.js — Row → API shape

   One place decides what a database row looks like on the wire.
   Two things depend on that being centralised:

     * Safety — password_hash, reset tokens and token_version must
       never leave the server. A controller that forgets is a leak;
       a presenter that never selects them is not.
     * The frontend contract — the portal scripts read camelCase
       fields (project.completionPercent, submission.fileName,
       notification.date). Presenters are the translation layer,
       so SQL stays idiomatic snake_case.
============================================================ */

"use strict";

/** Mirrors Utils.formatFileSize in the frontend so sizes read identically. */
function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Timestamps go out as ISO strings; new Date(iso) parses them everywhere. */
function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** DATE columns are already "YYYY-MM-DD" (see the parser in config/db.js). */
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim();
}

/* ══════════════════════════════════════
   USER
══════════════════════════════════════ */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: fullName(row.first_name, row.last_name),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    status: row.status,
    department: row.department || null,
    indexNumber: row.index_number || null,
    staffId: row.staff_id || null,
    level: row.level || null,
    specialization: row.specialization || null,
    /* True while the account still uses a password someone else set
       (bootstrapped default admin, or an admin-created account). The
       portal uses it to prompt the owner to choose their own. */
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
  };
}

/* ══════════════════════════════════════
   PROJECT
   Supervisor details are flattened onto the project because the
   student dashboard renders a supervisor card straight from it.
══════════════════════════════════════ */
function toProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: fullName(row.student_first_name, row.student_last_name) || null,
    studentIndexNumber: row.student_index_number || null,
    studentDepartment: row.student_department || null,
    supervisorId: row.supervisor_id || null,
    supervisorName: fullName(row.supervisor_first_name, row.supervisor_last_name) || null,
    supervisorEmail: row.supervisor_email || null,
    supervisorDepartment: row.supervisor_department || null,
    supervisorSpecialization: row.supervisor_specialization || null,
    title: row.title,
    topic: row.topic || null,
    topicStatus: row.topic_status,
    status: row.status,
    completionPercent: Number(row.completion_percent) || 0,
    startDate: dateOnly(row.start_date),
    deadline: dateOnly(row.deadline),
    createdAt: iso(row.created_at),
  };
}

/* ══════════════════════════════════════
   MILESTONE
   due_date stays snake_case: the student progress page reads
   ms.due_date directly.
══════════════════════════════════════ */
function toMilestone(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id || null,
    label: row.label,
    due_date: dateOnly(row.due_date),
    dueDate: dateOnly(row.due_date),
    status: row.status,
    position: Number(row.position) || 0,
  };
}

/* ══════════════════════════════════════
   SUBMISSION
   fileSize is the pre-formatted string the tables print;
   fileSizeBytes is kept for clients that want to do their own maths.
══════════════════════════════════════ */
function toSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    studentId: row.student_id,
    studentName: fullName(row.student_first_name, row.student_last_name) || null,
    supervisorId: row.supervisor_id || null,
    chapterId: row.chapter_id,
    version: Number(row.version),
    fileName: row.original_name,
    fileSize: formatFileSize(row.file_size_bytes),
    fileSizeBytes: Number(row.file_size_bytes),
    mimeType: row.mime_type,
    notes: row.notes || null,
    status: row.status,
    submittedAt: iso(row.submitted_at),
  };
}

/* ══════════════════════════════════════
   FEEDBACK
══════════════════════════════════════ */
function toFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    submissionId: row.submission_id,
    projectId: row.project_id,
    studentId: row.student_id,
    studentName: fullName(row.student_first_name, row.student_last_name) || null,
    supervisorId: row.supervisor_id || null,
    supervisorName: fullName(row.supervisor_first_name, row.supervisor_last_name) || null,
    chapterId: row.chapter_id || null,
    chapterLabel: row.chapter_label || null,
    comment: row.comment,
    rating: row.rating,
    date: iso(row.created_at),
  };
}

/* ══════════════════════════════════════
   MEETING
   `participants` is an aggregated JSON array from the query;
   the supervisor schedule page maps over participant.name.
══════════════════════════════════════ */
function toMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    supervisorId: row.supervisor_id || null,
    supervisorName: fullName(row.supervisor_first_name, row.supervisor_last_name) || null,
    organizerId: row.organizer_id || null,
    date: dateOnly(row.scheduled_date),
    time: row.scheduled_time,
    duration: row.duration,
    type: row.meeting_type,
    platform: row.platform,
    link: row.link || null,
    notes: row.notes || null,
    status: row.status,
    participants: Array.isArray(row.participants)
      ? row.participants.filter(Boolean).map((p) => ({ id: p.id, name: p.name, role: p.role }))
      : [],
  };
}

/* ══════════════════════════════════════
   NOTIFICATION
══════════════════════════════════════ */
function toNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    message: row.message,
    link: row.link || null,
    read: Boolean(row.read),
    date: iso(row.created_at),
  };
}

module.exports = {
  formatFileSize,
  iso,
  dateOnly,
  fullName,
  toUser,
  toProject,
  toMilestone,
  toSubmission,
  toFeedback,
  toMeeting,
  toNotification,
};
