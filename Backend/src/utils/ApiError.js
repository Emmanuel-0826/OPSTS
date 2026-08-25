/* ============================================================
   src/utils/ApiError.js — Operational error type

   Errors the API raises on purpose (bad input, missing record,
   forbidden action) carry a status code and a message that is
   safe to show a user. Anything else that reaches the error
   handler is treated as a bug and reported as a generic 500.
============================================================ */

"use strict";

class ApiError extends Error {
  /**
   * @param {number} status   HTTP status code
   * @param {string} message  Safe to display to the caller
   * @param {object} [details] Optional field-level detail, e.g. validation errors
   */
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.expected = true; // marks this as deliberate, not a crash
    if (details) this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message = "Invalid request.", details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required.") {
    return new ApiError(401, message);
  }

  static forbidden(message = "You do not have permission to perform this action.") {
    return new ApiError(403, message);
  }

  static notFound(message = "The requested resource was not found.") {
    return new ApiError(404, message);
  }

  static conflict(message = "That conflicts with an existing record.") {
    return new ApiError(409, message);
  }

  static payloadTooLarge(message = "The uploaded file is too large.") {
    return new ApiError(413, message);
  }

  static tooManyRequests(message = "Too many requests. Please slow down.") {
    return new ApiError(429, message);
  }
}

module.exports = ApiError;
