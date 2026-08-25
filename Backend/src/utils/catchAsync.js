/* ============================================================
   src/utils/catchAsync.js

   Express 5 forwards rejected promises to the error handler on
   its own, but wrapping keeps the intent explicit and keeps the
   controllers portable if the express version ever moves.
============================================================ */

"use strict";

/**
 * @param {(req, res, next) => Promise<any>} handler
 * @returns {(req, res, next) => void}
 */
function catchAsync(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = catchAsync;
