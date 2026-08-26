/* ============================================================
   js/config.js — The one place a deployment is configured
   OPSTS — GCTU

   Loaded first on every page. Nothing here talks to the network.
============================================================ */

"use strict";

/* The API root. Change this, and only this, to point the frontend
   at another backend. The backend's CORS_ORIGINS must list the
   origin this page is served from, or every call comes back 403
   with a message saying exactly that. */
const API_BASE_URL = "http://localhost:5000/api";

const Config = {
  apiBaseUrl: API_BASE_URL,

  /* Where each role lands after signing in. Paths are relative to
     the frontend root, which is where the auth pages live. */
  home: {
    student: "pages/Student/dashboard.html",
    supervisor: "pages/supervisor/dashboard.html",
    admin: "pages/admin/dashboard.html",
  },

  /* The API requires a non-empty department on registration but
     exposes no list to choose from, so the list lives here. It
     matches the departments the project handbook covers. */
  departments: [
    "Computer Science",
    "Information Technology",
    "Computer Engineering",
    "Software Engineering",
    "Cybersecurity",
    "Telecommunications Engineering",
    "Business Administration",
  ],

  /* Mirrors rules.password() in Backend/src/middleware/validate.js.
     Validating the same number on the client catches it before the
     round trip; the server still decides. */
  password: { min: 8, max: 128 },
};
