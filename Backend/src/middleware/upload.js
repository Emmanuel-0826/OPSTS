/* ============================================================
   src/middleware/upload.js — Chapter file uploads

   Threat model for this endpoint, and what answers each part:

     * Path traversal   — the client's filename never touches the
                          filesystem. Files are stored under a random
                          name; the original is kept in the database
                          purely as a display label.
     * Malicious upload — extension AND declared MIME type must both
                          be on the allow-list, and the directory is
                          outside the web root with no static handler
                          pointed at it, so nothing here is ever
                          served or executed by URL.
     * Disk exhaustion  — hard byte limit, one file per request.
============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config/env");
const ApiError = require("../utils/ApiError");

/* Document formats a project chapter is realistically written in. */
const ALLOWED = new Map([
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword"]],
  [
    ".docx",
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ],
  [".odt", ["application/vnd.oasis.opendocument.text"]],
  [".rtf", ["application/rtf", "text/rtf"]],
]);

fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, config.uploads.dir);
  },
  filename(req, file, cb) {
    /* Random name + validated extension. Nothing user-controlled
       reaches the path, so "../../etc/passwd" is simply not expressible. */
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(20).toString("hex")}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED.get(ext);

  if (!allowedMimes) {
    return cb(
      ApiError.badRequest(
        "Only PDF, Word (.doc/.docx), OpenDocument (.odt) and RTF files can be submitted."
      )
    );
  }

  /* The browser-declared MIME type is not trustworthy on its own, but a
     mismatch with the extension is still a clear signal something is off. */
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(
      ApiError.badRequest(
        `That file claims to be "${file.mimetype}" but has a ${ext} extension. ` +
          "Please re-save it and try again."
      )
    );
  }

  cb(null, true);
}

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1,
    fields: 12,
    fieldSize: 8 * 1024, // notes are short; nothing here needs more
  },
});

/** Accept exactly one file under the field name the frontend uses. */
const uploadChapter = uploader.single("file");

/**
 * Best-effort cleanup for a file whose database write failed.
 * A leftover orphan is harmless; a thrown error here would mask
 * the real failure, so it is swallowed deliberately.
 */
function removeUploadedFile(file) {
  if (!file || !file.path) return;
  fs.promises.unlink(file.path).catch(() => {});
}

/** Absolute path for a stored file, guarded against escaping the upload dir. */
function resolveStoredPath(storedName) {
  const resolved = path.resolve(config.uploads.dir, storedName);
  const root = path.resolve(config.uploads.dir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw ApiError.badRequest("Invalid file reference.");
  }
  return resolved;
}

module.exports = { uploadChapter, removeUploadedFile, resolveStoredPath, ALLOWED };
