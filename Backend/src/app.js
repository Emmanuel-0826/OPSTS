/* ============================================================
   src/app.js — Express application

   Middleware order matters and is deliberate:

     helmet → cors → body parsers → sanitiser → logging →
     rate limit → routes → 404 → error handler

   Security headers go on before anything can respond; CORS is
   answered before a body is parsed; the sanitiser runs after
   parsing but before any handler sees the data; and the error
   handler is last so every throw above it lands in one place.
============================================================ */

"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const config = require("./config/env");
const routes = require("./routes");
const ApiError = require("./utils/ApiError");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { apiLimiter } = require("./middleware/rateLimit");

const app = express();

/* This API is intended to sit behind a reverse proxy in production.
   Trusting exactly one hop lets rate limiting see the real client IP
   without letting a client spoof X-Forwarded-For for itself. */
app.set("trust proxy", config.isProd ? 1 : false);
app.disable("x-powered-by");

/* ══════════════════════════════════════
   SECURITY HEADERS
   This process serves JSON and file downloads only — never HTML —
   so the CSP can be as restrictive as it gets.
══════════════════════════════════════ */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // the frontend is a separate origin
    referrerPolicy: { policy: "no-referrer" },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

/* ══════════════════════════════════════
   CORS
   The frontend keeps its token in sessionStorage and sends it as an
   Authorization header, so credentials/cookies are not needed and
   are deliberately not enabled.

   With no CORS_ORIGINS configured (a fresh dev clone) any origin is
   allowed; in production an empty list is a misconfiguration and
   every cross-origin call is refused rather than silently opened up.
══════════════════════════════════════ */
const allowList = config.corsOrigins;

/* An ApiError so a blocked origin gets a 403 with a clear message,
   rather than a generic 500 from the error handler. */
function corsRejection(origin) {
  return ApiError.forbidden(
    `Requests from ${origin} are not allowed. Add it to CORS_ORIGINS to permit this origin.`
  );
}

app.use(
  cors({
    origin(origin, callback) {
      /* No Origin header: curl, Postman, same-origin, server-to-server. */
      if (!origin) return callback(null, true);

      if (allowList.length === 0) {
        if (!config.isProd) return callback(null, true);
        return callback(corsRejection(origin));
      }

      if (allowList.includes(origin)) return callback(null, true);
      return callback(corsRejection(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"], // so downloads keep their filename
    maxAge: 86400,
  })
);

/* ══════════════════════════════════════
   BODY PARSING
   Small caps on purpose: nothing in this API posts a large JSON
   body, and file uploads go through multer with its own limit.
══════════════════════════════════════ */
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

/* ══════════════════════════════════════
   PROTOTYPE-POLLUTION GUARD
   A JSON body containing "__proto__" or "constructor.prototype"
   can corrupt every object in the process once it is merged or
   spread. Nothing legitimate here uses those keys, so reject them.
══════════════════════════════════════ */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasForbiddenKey(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(value[key], depth + 1)) return true;
  }
  return false;
}

app.use((req, res, next) => {
  if (hasForbiddenKey(req.body) || hasForbiddenKey(req.query)) {
    return res.status(400).json({
      success: false,
      message: "The request contains a disallowed field name.",
    });
  }
  next();
});

/* ══════════════════════════════════════
   REQUEST LOGGING
   The Authorization header must never reach a log file, so the
   format is explicit rather than a preset that might include it.
══════════════════════════════════════ */
if (config.env !== "test") {
  app.use(
    morgan(config.isProd ? "combined" : ":method :url :status :response-time[0]ms", {
      skip: (req) => req.path === "/api/health",
    })
  );
}

app.use("/api", apiLimiter);
app.use("/api", routes);

/* A bare GET / is a common "is this thing on?" check. */
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "OPSTS API",
    documentation: "/api/health",
  });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
