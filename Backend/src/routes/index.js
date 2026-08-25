/* ============================================================
   src/routes/index.js — API router

   Mounts every resource under /api and exposes a health check
   that does not require authentication (load balancers and the
   frontend's "is the backend up?" probe both need it).
============================================================ */

"use strict";

const express = require("express");
const { pool } = require("../config/db");
const { isConfigured: emailConfigured } = require("../services/email");
const { isZoomConfigured } = require("../services/meetingLinkService");
const { CHAPTERS, TOTAL_CHAPTERS } = require("../utils/chapters");

const router = express.Router();

/* ── Health ──────────────────────────────────────────────── */
router.get("/health", async (req, res) => {
  let database = "up";
  try {
    await pool.query("SELECT 1");
  } catch {
    database = "down";
  }

  res.status(database === "up" ? 200 : 503).json({
    success: database === "up",
    service: "opsts-api",
    status: database === "up" ? "ok" : "degraded",
    database,
    integrations: { email: emailConfigured, zoom: isZoomConfigured },
    time: new Date().toISOString(),
  });
});

/* ── Reference data ──────────────────────────────────────────
   The chapter list the whole system counts progress against.
   Public so the frontend could stop hard-coding it. */
router.get("/chapters", (req, res) => {
  res.json({ success: true, total: TOTAL_CHAPTERS, chapters: CHAPTERS });
});

/* ── Resources ───────────────────────────────────────────── */
router.use("/auth", require("./auth"));
router.use("/users", require("./users"));
router.use("/projects", require("./projects"));
router.use("/submissions", require("./submissions"));
router.use("/feedback", require("./feedback"));
router.use("/meetings", require("./meetings"));
router.use("/notifications", require("./notifications"));
router.use("/reports", require("./reports"));

module.exports = router;
