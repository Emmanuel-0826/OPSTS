/* ============================================================
   src/middleware/validate.js — Request validation

   Every route declares its expected input with express-validator
   chains and ends them with `validate`. Two consequences worth
   stating: unknown fields never reach a controller, and the
   frontend always gets one readable `message` (its ApiError only
   surfaces `message`, not a field list — the list still ships as
   `errors` for API clients that want it).
============================================================ */

"use strict";

const { validationResult, body, param, query } = require("express-validator");
const ApiError = require("../utils/ApiError");

function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array({ onlyFirstError: true });
  const message = errors[0].msg;

  return next(
    ApiError.badRequest(
      message,
      errors.map((e) => ({ field: e.path, message: e.msg }))
    )
  );
}

/* ══════════════════════════════════════
   Reusable field rules
══════════════════════════════════════ */

const rules = {
  email: (field = "email") =>
    body(field)
      .trim()
      .notEmpty()
      .withMessage("Email address is required.")
      .isEmail()
      .withMessage("Please enter a valid email address.")
      .normalizeEmail({ gmail_remove_dots: false })
      .isLength({ max: 254 })
      .withMessage("That email address is too long."),

  /* 8 characters is the floor the API enforces, and the frontend
     validates the same number so a rejected password is caught
     before the round trip. */
  password: (field = "password") =>
    body(field)
      .isString()
      .withMessage("A password is required.")
      .isLength({ min: 8, max: 128 })
      .withMessage("Password must be between 8 and 128 characters."),

  name: (field) =>
    body(field)
      .trim()
      .notEmpty()
      .withMessage(`${field === "firstName" ? "First" : "Last"} name is required.`)
      .isLength({ max: 80 })
      .withMessage("That name is too long.")
      .matches(/^[\p{L}\p{M}'\-. ]+$/u)
      .withMessage("Names may only contain letters, spaces, hyphens and apostrophes."),

  uuidParam: (field = "id") =>
    param(field).isUUID().withMessage("That record id is not valid."),

  optionalText: (field, max = 2000) =>
    body(field).optional({ values: "falsy" }).trim().isLength({ max })
      .withMessage(`${field} must be ${max} characters or fewer.`),

  isoDate: (field, { optional = false } = {}) => {
    const chain = optional ? body(field).optional({ values: "falsy" }) : body(field);
    return chain
      .trim()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage(`${field} must be a date in YYYY-MM-DD format.`);
  },

  time: (field, { optional = false } = {}) => {
    const chain = optional ? body(field).optional({ values: "falsy" }) : body(field);
    return chain
      .trim()
      .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
      .withMessage(`${field} must be a time in HH:MM format.`);
  },
};

module.exports = { validate, rules, body, param, query };
