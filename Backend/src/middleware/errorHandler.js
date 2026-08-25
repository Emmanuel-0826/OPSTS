/* ============================================================
   src/middleware/errorHandler.js — Central error handling

   Contract with the frontend (js/api.js): every failure is JSON
   with `success: false` and a human-readable `message`, and the
   client shows that message verbatim. So messages here are written
   for a student or supervisor to read, not for a log file.

   Unexpected errors are logged in full server-side and reduced to
   a generic message on the wire — stack traces and driver text
   (table names, constraint names, SQL) never leave the process.
============================================================ */

"use strict";

const multer = require("multer");
const config = require("../config/env");
const ApiError = require("../utils/ApiError");

/* Postgres error codes worth translating into something a user can act on. */
const PG_CODES = {
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
  "23514": "check_violation",
  "22P02": "invalid_text_representation",
};

/** Turn a unique-index name into a message that names the real field. */
function uniqueViolationMessage(err) {
  const constraint = err.constraint || "";
  if (constraint.includes("email")) return "An account with that email address already exists.";
  if (constraint.includes("index_number")) return "That index number is already registered.";
  if (constraint.includes("staff_id")) return "That staff ID is already registered.";
  if (constraint.includes("projects_student_id")) return "That student already has a project.";
  if (constraint.includes("submissions_student_chapter_version"))
    return "That chapter version already exists. Please try submitting again.";
  return "That record already exists.";
}

function notFound(req, res, next) {
  next(ApiError.notFound(`No API route matches ${req.method} ${req.originalUrl}.`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  let status = 500;
  let message = "Something went wrong on our side. Please try again.";
  let details;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message =
      err.code === "LIMIT_FILE_SIZE"
        ? `That file is larger than the ${Math.round(config.uploads.maxBytes / 1048576)} MB limit.`
        : "The file upload could not be processed.";
  } else if (err.type === "entity.too.large") {
    status = 413;
    message = "That request is too large.";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "The request body was not valid JSON.";
  } else if (PG_CODES[err.code]) {
    switch (PG_CODES[err.code]) {
      case "unique_violation":
        status = 409;
        message = uniqueViolationMessage(err);
        break;
      case "foreign_key_violation":
        status = 400;
        message = "That action refers to a record that no longer exists.";
        break;
      case "check_violation":
        status = 400;
        message = "One of the submitted values is not allowed.";
        break;
      case "invalid_text_representation":
        status = 400;
        message = "One of the submitted values has the wrong format.";
        break;
      default:
        break;
    }
  }

  /* Log everything that is not a deliberate 4xx. A 500 here means a bug,
     and the stack is the only way to find it. */
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(
      `[error] ${req.method} ${req.originalUrl} — ${err.message}\n`,
      err.stack || err
    );
  }

  const payload = { success: false, message };
  if (details) payload.errors = details;
  /* Outside production, echo the real error to make debugging bearable. */
  if (!config.isProd && status >= 500) payload.debug = err.message;

  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
