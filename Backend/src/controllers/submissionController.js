/* ============================================================
   src/controllers/submissionController.js — Requirement 4

   Chapter uploads, version history and downloads.

   Downloads deliberately go through this controller rather than a
   static handler. The upload directory is not served by URL at all,
   so a file can only be reached by someone the query says is
   entitled to it: its author, their supervisor, or an admin.
============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../config/db");
const ApiError = require("../utils/ApiError");
const catchAsync = require("../utils/catchAsync");
const { toSubmission } = require("../utils/presenters");
const { isValidChapterId, chapterLabel } = require("../utils/chapters");
const { removeUploadedFile, resolveStoredPath } = require("../middleware/upload");
const notifications = require("../services/notificationService");
const email = require("../services/email");
const { recalculateProject } = require("../services/progressService");

const SUBMISSION_SELECT = `
  SELECT sub.id, sub.project_id, sub.student_id, sub.supervisor_id, sub.chapter_id,
         sub.version, sub.original_name, sub.stored_name, sub.file_size_bytes,
         sub.mime_type, sub.notes, sub.status, sub.submitted_at,
         st.first_name AS student_first_name,
         st.last_name  AS student_last_name
    FROM submissions sub
    JOIN users st ON st.id = sub.student_id`;

/** SHA-256 of a file on disk — lets a download prove it matches what was uploaded. */
function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/* ══════════════════════════════════════
   GET /api/submissions
   Student → own. Supervisor → their students'. Admin → all.
   Filters: ?status= &chapterId= &studentId= (admin/supervisor)
══════════════════════════════════════ */
const listSubmissions = catchAsync(async (req, res) => {
  const conditions = [];
  const params = [];

  if (req.user.role === "student") {
    params.push(req.user.id);
    conditions.push(`sub.student_id = $${params.length}`);
  } else if (req.user.role === "supervisor") {
    params.push(req.user.id);
    conditions.push(`sub.supervisor_id = $${params.length}`);
  }

  if (req.query.status) {
    params.push(req.query.status);
    conditions.push(`sub.status = $${params.length}`);
  }
  if (req.query.chapterId) {
    params.push(req.query.chapterId);
    conditions.push(`sub.chapter_id = $${params.length}`);
  }
  if (req.query.studentId && req.user.role !== "student") {
    params.push(req.query.studentId);
    conditions.push(`sub.student_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  /* Oldest first: the student's upload history reads top-to-bottom in
     chronological order, and the dashboard slices the last three. */
  const { rows } = await db.query(
    `${SUBMISSION_SELECT} ${where} ORDER BY sub.submitted_at ASC`,
    params
  );

  res.json({ success: true, count: rows.length, submissions: rows.map(toSubmission) });
});

/* ══════════════════════════════════════
   POST /api/submissions   (student, multipart)
   Fields: file, chapterId, notes
══════════════════════════════════════ */
const createSubmission = catchAsync(async (req, res) => {
  const file = req.file;

  /* Every failure past this point must clean up the file multer has
     already written, or a rejected upload leaks disk space. */
  try {
    if (!file) throw ApiError.badRequest("Please attach a file to submit.");

    const chapterId = (req.body.chapterId || "").trim();
    if (!isValidChapterId(chapterId)) {
      throw ApiError.badRequest("Please choose a valid chapter.");
    }

    const notes = (req.body.notes || "").trim().slice(0, 2000);
    const checksum = await checksumFile(file.path);

    const result = await db.withTransaction(async (client) => {
      /* FOR UPDATE serialises concurrent uploads by the same student,
         so the version number below cannot be handed out twice. */
      const { rows: projectRows } = await client.query(
        `SELECT p.id, p.supervisor_id, p.title,
                v.first_name AS supervisor_first_name,
                v.last_name  AS supervisor_last_name,
                v.email      AS supervisor_email
           FROM projects p
           LEFT JOIN users v ON v.id = p.supervisor_id
          WHERE p.student_id = $1
          FOR UPDATE OF p`,
        [req.user.id]
      );
      const project = projectRows[0];

      if (!project) {
        throw ApiError.badRequest(
          "You do not have a project record yet. Please contact your administrator."
        );
      }

      const { rows: versionRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM submissions
          WHERE student_id = $1 AND chapter_id = $2`,
        [req.user.id, chapterId]
      );
      const version = Number(versionRows[0].next_version);

      const { rows } = await client.query(
        `INSERT INTO submissions
           (project_id, student_id, supervisor_id, chapter_id, version,
            original_name, stored_name, file_size_bytes, mime_type,
            checksum_sha256, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          project.id,
          req.user.id,
          project.supervisor_id,
          chapterId,
          version,
          file.originalname,
          file.filename,
          file.size,
          file.mimetype,
          checksum,
          notes || null,
        ]
      );

      await recalculateProject(client, project.id);

      const label = chapterLabel(chapterId);
      const studentName = `${req.user.first_name} ${req.user.last_name}`;

      if (project.supervisor_id) {
        await notifications.notify(client, {
          userId: project.supervisor_id,
          type: "submission",
          message:
            `${studentName} submitted ${label}` +
            (version > 1 ? ` (revision v${version})` : "") +
            " for review.",
          link: "review.html",
        });
      }

      const { rows: full } = await client.query(`${SUBMISSION_SELECT} WHERE sub.id = $1`, [
        rows[0].id,
      ]);

      return { submission: full[0], project, version, label, studentName };
    });

    if (result.project.supervisor_email) {
      email
        .activityAlert({
          to: result.project.supervisor_email,
          name: result.project.supervisor_first_name,
          subject: `New submission from ${result.studentName}`,
          lines: [
            `${result.studentName} has submitted ${result.label} (version ${result.version}) for review.`,
            "Sign in to OPSTS to download the file and give feedback.",
          ],
          ctaLabel: "Review submission",
          ctaPath: "pages/supervisor/review.html",
        })
        .catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: `${result.label} submitted successfully as version ${result.version}.`,
      submission: toSubmission(result.submission),
    });
  } catch (err) {
    removeUploadedFile(file);
    throw err;
  }
});

/**
 * Load a submission the caller may see, or throw.
 * Access is decided in SQL: the row is only returned when the
 * caller's id already matches the student or the supervisor.
 */
async function loadSubmissionFor(submissionId, user) {
  const params = [submissionId];
  let scope = "";

  if (user.role === "student") {
    params.push(user.id);
    scope = "AND sub.student_id = $2";
  } else if (user.role === "supervisor") {
    params.push(user.id);
    scope = "AND sub.supervisor_id = $2";
  }

  const { rows } = await db.query(`${SUBMISSION_SELECT} WHERE sub.id = $1 ${scope}`, params);

  if (!rows[0]) {
    /* Same message whether the row is missing or merely forbidden, so
       an id cannot be probed for existence. */
    throw ApiError.notFound("That submission does not exist, or you do not have access to it.");
  }
  return rows[0];
}

/* ══════════════════════════════════════
   GET /api/submissions/:id
══════════════════════════════════════ */
const getSubmission = catchAsync(async (req, res) => {
  const submission = await loadSubmissionFor(req.params.id, req.user);
  res.json({ success: true, submission: toSubmission(submission) });
});

/* ══════════════════════════════════════
   GET /api/submissions/:id/download
   Requirement 4: "Download previous submissions".
══════════════════════════════════════ */
const downloadSubmission = catchAsync(async (req, res) => {
  const submission = await loadSubmissionFor(req.params.id, req.user);
  const absolutePath = resolveStoredPath(submission.stored_name);

  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound("That file is no longer available on the server.");
  }

  /* Force a download rather than inline rendering: a document that
     renders in the browser is a document that can run script in this
     origin. Quotes in the filename are stripped so they cannot break
     out of the header. */
  const safeName = path.basename(submission.original_name).replace(/["\\\r\n]/g, "");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", submission.file_size_bytes);

  const stream = fs.createReadStream(absolutePath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
});

/* ══════════════════════════════════════
   DELETE /api/submissions/:id
   A student may withdraw their own submission while it is still
   under review; an admin may remove any. Once a supervisor has
   ruled on it, the record stays as part of the review history.
══════════════════════════════════════ */
const deleteSubmission = catchAsync(async (req, res) => {
  const submission = await loadSubmissionFor(req.params.id, req.user);

  if (req.user.role === "supervisor") {
    throw ApiError.forbidden("Supervisors cannot delete submissions.");
  }
  if (req.user.role === "student" && submission.status !== "Under Review") {
    throw ApiError.badRequest(
      "This submission has already been reviewed and can no longer be withdrawn."
    );
  }

  await db.withTransaction(async (client) => {
    await client.query("DELETE FROM submissions WHERE id = $1", [submission.id]);
    await recalculateProject(client, submission.project_id);
  });

  /* Remove the file only after the row is gone: an orphaned file is
     recoverable, a row pointing at a deleted file is not. */
  removeUploadedFile({ path: resolveStoredPath(submission.stored_name) });

  res.json({ success: true, message: "Submission withdrawn." });
});

module.exports = {
  listSubmissions,
  createSubmission,
  getSubmission,
  downloadSubmission,
  deleteSubmission,
};
